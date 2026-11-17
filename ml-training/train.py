"""
Phase 3 step 2: trains the static hand-shape CNN classifier via transfer
learning on top of the data/<word>/*.jpg layout export_dataset.py produces.

Architecture (per the CNN roadmap):
    MobileNetV2 (imagenet weights, frozen conv base)
    -> GlobalAveragePooling2D
    -> Dense(128, relu)
    -> Dropout(0.3)
    -> Dense(num_static_words, softmax)

Softmax is appropriate here (unlike the DTW/landmark side, which never uses
it) because transfer learning drastically lowers the samples-needed
threshold: the pretrained filters already know edges/textures/shapes, so the
head only has to learn the final word mapping.

Heavy augmentation (rotation, brightness, zoom) synthetically stretches the
small per-word image counts real data collection is likely to produce.

Usage:
    python train.py [--epochs 20] [--batch-size 16] [--data-dir ./data]
                     [--output-dir ./models/hand-shape-cnn]

Outputs (to --output-dir):
    saved_model/       TF SavedModel — input to the Phase 4 tensorflowjs
                        conversion step
    label_map.json      {class_index: word} — the backend CNN branch
                        (Phase 5) needs this to turn a softmax index back
                        into a word; keep it alongside the converted model
    training_report.json  per-class sample counts, final train/val accuracy,
                        and which classes fell below the recommended
                        15-20-crops/word threshold from export_dataset.py
"""
import argparse
import json
from pathlib import Path

import tensorflow as tf

IMG_SIZE = (224, 224)  # matches the Phase 1 hand-crop capture size
SEED = 42
RECOMMENDED_MIN_PER_WORD = 15


def build_datasets(data_dir: Path, batch_size: int):
    train_ds = tf.keras.utils.image_dataset_from_directory(
        data_dir,
        validation_split=0.2,
        subset="training",
        seed=SEED,
        image_size=IMG_SIZE,
        batch_size=batch_size,
        label_mode="int",
    )
    val_ds = tf.keras.utils.image_dataset_from_directory(
        data_dir,
        validation_split=0.2,
        subset="validation",
        seed=SEED,
        image_size=IMG_SIZE,
        batch_size=batch_size,
        label_mode="int",
    )
    class_names = train_ds.class_names

    autotune = tf.data.AUTOTUNE
    train_ds = train_ds.cache().prefetch(buffer_size=autotune)
    val_ds = val_ds.cache().prefetch(buffer_size=autotune)
    return train_ds, val_ds, class_names


def build_model(num_classes: int) -> tf.keras.Model:
    # Heavy augmentation, applied only during training (Keras preprocessing
    # layers are identity at inference) — rotation/brightness/zoom, since a
    # single held handshape photographed from slightly different angles is
    # exactly the kind of variance real recordings will have.
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomRotation(0.08),
            tf.keras.layers.RandomBrightness(0.15),
            tf.keras.layers.RandomZoom(0.15),
        ],
        name="augmentation",
    )

    base_model = tf.keras.applications.MobileNetV2(
        input_shape=IMG_SIZE + (3,),
        include_top=False,
        weights="imagenet",
    )
    base_model.trainable = False

    inputs = tf.keras.Input(shape=IMG_SIZE + (3,))
    x = augmentation(inputs)
    x = tf.keras.applications.mobilenet_v2.preprocess_input(x)
    x = base_model(x, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    outputs = tf.keras.layers.Dense(num_classes, activation="softmax")(x)

    model = tf.keras.Model(inputs, outputs, name="hand_shape_cnn")
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def count_images_per_class(data_dir: Path) -> dict[str, int]:
    counts = {}
    for word_dir in sorted(p for p in data_dir.iterdir() if p.is_dir()):
        counts[word_dir.name] = sum(
            1 for f in word_dir.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png")
        )
    return counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).parent / "data")
    parser.add_argument(
        "--output-dir", type=Path,
        default=Path(__file__).parent / "models" / "hand-shape-cnn",
    )
    args = parser.parse_args()

    if not args.data_dir.exists():
        raise SystemExit(
            f"{args.data_dir} does not exist — run export_dataset.py first."
        )

    counts = count_images_per_class(args.data_dir)
    if len(counts) < 2:
        raise SystemExit(
            f"Only {len(counts)} class(es) found in {args.data_dir} — need "
            "at least 2 static words to train a classifier."
        )
    below_recommended = {
        w: c for w, c in counts.items() if c < RECOMMENDED_MIN_PER_WORD
    }
    if below_recommended:
        print(
            f"NOTE: {len(below_recommended)} word(s) are below the "
            f"recommended {RECOMMENDED_MIN_PER_WORD} crops/word: "
            f"{below_recommended} — expect the CNN branch to be an unreliable "
            "primary signal for these words even after training; treat as a "
            "tiebreaker only (see recognitionConfig fusion weights)."
        )

    print(f"Loading images from {args.data_dir} ({len(counts)} classes) ...")
    train_ds, val_ds, class_names = build_datasets(args.data_dir, args.batch_size)

    print(f"Building model for {len(class_names)} classes ...")
    model = build_model(len(class_names))
    model.summary()

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_accuracy", patience=5, restore_best_weights=True
        ),
    ]

    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=args.epochs,
        callbacks=callbacks,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    saved_model_path = args.output_dir / "saved_model"
    model.export(saved_model_path)
    print(f"Saved model to {saved_model_path}")

    label_map = {str(i): name for i, name in enumerate(class_names)}
    (args.output_dir / "label_map.json").write_text(json.dumps(label_map, indent=2))
    print(f"Saved label map ({len(label_map)} classes) to "
          f"{args.output_dir / 'label_map.json'}")

    final_train_acc = float(history.history["accuracy"][-1])
    final_val_acc = float(history.history["val_accuracy"][-1])
    report = {
        "classes": counts,
        "below_recommended_threshold": below_recommended,
        "epochs_trained": len(history.history["accuracy"]),
        "final_train_accuracy": final_train_acc,
        "final_val_accuracy": final_val_acc,
    }
    (args.output_dir / "training_report.json").write_text(json.dumps(report, indent=2))
    print(f"\nFinal train accuracy: {final_train_acc:.3f}")
    print(f"Final val accuracy:   {final_val_acc:.3f}")
    print(f"Report written to {args.output_dir / 'training_report.json'}")


if __name__ == "__main__":
    main()

"""
Phase 4: converts the Phase 3 TF SavedModel (models/hand-shape-cnn/saved_model)
into a TFJS graph model, so the Node backend can load it with
@tensorflow/tfjs-node in Phase 5.

Why "graph model" and not "layers model":
    train.py's model has a Keras preprocessing/augmentation Sequential baked
    into the functional graph (RandomRotation/RandomBrightness/RandomZoom).
    Those layers are identity at inference but some of them don't have a
    clean layers-model JSON representation. Converting from the SavedModel
    as a graph model sidesteps that entirely and is also the faster/smaller
    option for inference-only serving, which is all Phase 5 needs.

What this does, concretely:
    1. Validates the Phase 3 output exists (saved_model/, label_map.json)
    2. Runs the TFJS SavedModel -> TFJS graph model conversion
    3. Copies label_map.json alongside the converted model — Phase 5's
       handShapeCNN.ts needs it to turn a softmax class index back into a
       word, and keeping it in the same folder means one path to load both

Usage:
    python convert_to_tfjs.py
    python convert_to_tfjs.py --quantize float16   # ~half the model size,
                                                     # negligible accuracy
                                                     # loss, recommended for
                                                     # a browser/server
                                                     # deploy target
    python convert_to_tfjs.py \
        --saved-model-dir ./models/hand-shape-cnn/saved_model \
        --output-dir ../sign-language-server/models/hand-shape-cnn

Requires the extra `tensorflowjs` package (not in the Phase 3 requirements.txt
since Phase 3 doesn't need it) — see requirements.txt.
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

# tensorflowjs pulls in its own copy of the conversion machinery; import
# lazily so `python convert_to_tfjs.py --help` works even before `pip
# install -r requirements.txt` has been run.
def _stub_tensorflow_decision_forests():
    """tensorflowjs's converter unconditionally imports tensorflow_decision_forests
    (see tf_saved_model_conversion_v2.py) purely to support loading TFDF
    decision-forest SavedModels. It is never referenced anywhere else in that
    file. Our model is a plain Keras CNN, not TFDF, so the import is dead
    weight for us — but tensorflow_decision_forests is a notoriously fragile
    install (no Windows wheels, protobuf gencode/runtime version clashes on
    some platforms). Rather than fight that dependency, satisfy the import
    with an empty stand-in before tensorflowjs loads, so Python never tries
    to import the real package. Safe only because nothing downstream reads
    attributes off it — if a future tensorflowjs version starts using it for
    real, this stub would need to go.
    """
    import sys
    import types
    if "tensorflow_decision_forests" not in sys.modules:
        sys.modules["tensorflow_decision_forests"] = types.ModuleType(
            "tensorflow_decision_forests"
        )


def _import_tfjs():
    try:
        _stub_tensorflow_decision_forests()
        import tensorflowjs as tfjs
    except ImportError:
        raise SystemExit(
            "tensorflowjs is not installed. Run:\n"
            "    pip install -r requirements.txt\n"
            "(tensorflowjs was added there for Phase 4 — re-run pip install "
            "if you set up your venv before this step existed.)"
        )
    return tfjs


def convert(saved_model_dir: Path, output_dir: Path, quantize: str | None) -> None:
    if not saved_model_dir.exists():
        raise SystemExit(
            f"{saved_model_dir} does not exist — run train.py first "
            "(Phase 3) to produce it."
        )

    label_map_path = saved_model_dir.parent / "label_map.json"
    if not label_map_path.exists():
        raise SystemExit(
            f"{label_map_path} does not exist — expected it next to "
            f"{saved_model_dir.name}/ as a train.py output. Re-run train.py "
            "if it's missing."
        )

    tfjs = _import_tfjs()
    output_dir.mkdir(parents=True, exist_ok=True)

    quantization_kwargs = {}
    if quantize == "float16":
        quantization_kwargs["quantization_dtype_map"] = {"float16": "*"}
    elif quantize == "uint8":
        # More aggressive size reduction; only use this if float16 quality
        # is confirmed acceptable in Phase 7 evaluation first, since uint8
        # quantization has a real chance of hurting the CNN's contribution
        # to the fused score for words already near the 15-20 crop minimum.
        quantization_kwargs["quantization_dtype_map"] = {"uint8": "*"}

    print(f"Converting {saved_model_dir} -> {output_dir} "
          f"(quantize={quantize or 'none'}) ...")
    tfjs.converters.convert_tf_saved_model(
        str(saved_model_dir),
        str(output_dir),
        **quantization_kwargs,
    )

    shutil.copy(label_map_path, output_dir / "label_map.json")

    model_json_path = output_dir / "model.json"
    shard_paths = sorted(output_dir.glob("*.bin"))
    total_shard_bytes = sum(p.stat().st_size for p in shard_paths)

    print(f"\nDone. Wrote to {output_dir}:")
    print(f"  {model_json_path.name}")
    for p in shard_paths:
        print(f"  {p.name}")
    print(f"  label_map.json  (copied from {label_map_path})")
    print(f"\nTotal weight-shard size: {total_shard_bytes / 1_048_576:.2f} MB")

    if not model_json_path.exists():
        # Shouldn't happen if convert_tf_saved_model succeeded silently, but
        # fail loudly rather than let Phase 5 discover a missing file later.
        raise SystemExit(
            "Conversion reported success but model.json is missing from "
            f"{output_dir} — something went wrong. Check the output above "
            "for warnings from the TFJS converter."
        )


def main():
    default_saved_model = (
        Path(__file__).parent / "models" / "hand-shape-cnn" / "saved_model"
    )
    default_output = (
        Path(__file__).parent.parent
        / "sign-language-server" / "models" / "hand-shape-cnn"
    )

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--saved-model-dir", type=Path, default=default_saved_model,
        help=f"train.py output to convert (default: {default_saved_model})",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=default_output,
        help=f"Where to write the TFJS model (default: {default_output})",
    )
    parser.add_argument(
        "--quantize", choices=["float16", "uint8"], default=None,
        help="Optional weight quantization to shrink the model. Omit for "
             "full float32 precision (largest, safest default).",
    )
    args = parser.parse_args()

    convert(args.saved_model_dir, args.output_dir, args.quantize)


if __name__ == "__main__":
    main()
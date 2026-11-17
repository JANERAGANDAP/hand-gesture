"""
yolo-training/train.py

Fine-tunes a YOLOv8n (nano) single-class "hand" detector, starting from
Ultralytics' COCO-pretrained checkpoint. This is a *detection* model
(where is the hand in the frame), not a classifier — it feeds
handCrop.ts's bounding box, upstream of the existing hand-shape CNN
(ml-training/), which still does the "which word is this" classification
on the resulting crop. The two are independent models with independent
training data; this script does not touch ml-training/ or its dataset.

Dataset note (read this before running):
This app's existing captured data (ml-training/data/<word>/*.jpg, via
export_dataset.py) is *already cropped and centered* on the hand — that's
correct input for a classifier, but useless for training a detector, which
needs full, uncropped frames with a bounding box label for where the hand
is (including frames where the hand is off-center or only partially in
view). There's no such dataset in this app currently. Two practical ways
to get one:

  1. Fine-tune on a public hand-detection dataset (recommended starting
     point) — e.g. EgoHands, HaGRID, or Oxford Hands, converted to YOLO
     format (data.yaml + images/ + labels/, one .txt per image with
     `class cx cy w h` normalized 0-1 per line). Several of these already
     have YOLO-format exports available via Roboflow Universe.
  2. Once (1) gives a working baseline, optionally collect a small
     app-specific fine-tuning set: a few hundred full (uncropped) webcam
     frames across different users/lighting/backgrounds, hand-annotated
     with a tool like makesense.ai or CVAT (both export YOLO-format
     labels directly). This app doesn't currently store full frames
     anywhere (only the centered crops), so this would be a new, separate
     capture step if you want it — not something this script can bootstrap
     from existing data.

Either way, point DATA_YAML below at a standard Ultralytics-format
data.yaml (names: [hand], train:/val: image directories).
"""

import argparse
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data",
        type=str,
        default="data/hand-detection/data.yaml",
        help="Path to a YOLO-format data.yaml (single class: hand).",
    )
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument(
        "--base-model",
        type=str,
        default="yolov8n.pt",
        help="Starting checkpoint. yolov8n.pt auto-downloads COCO-"
        "pretrained nano weights from Ultralytics on first run.",
    )
    parser.add_argument("--output-dir", type=str, default="runs/hand-detect")
    args = parser.parse_args()

    data_path = Path(args.data)
    if not data_path.exists():
        raise SystemExit(
            f"No data.yaml at {data_path} — see the dataset note at the "
            "top of this file before running training."
        )

    model = YOLO(args.base_model)
    model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.output_dir,
        name="hand-detect",
        # Single class, so no class-imbalance handling needed here — the
        # imbalance that matters (crowded vs. empty frames) is a dataset-
        # composition question, not a training-flag one.
    )

    print(
        f"\nDone. Best weights: {args.output_dir}/hand-detect/weights/best.pt\n"
        "Next: python export_tfjs.py --weights "
        f"{args.output_dir}/hand-detect/weights/best.pt"
    )


if __name__ == "__main__":
    main()

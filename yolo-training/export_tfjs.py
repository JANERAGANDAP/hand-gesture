"""
yolo-training/export_tfjs.py

Converts a trained YOLO checkpoint (best.pt from train.py) into the TFJS
graph model that src/utils/yoloHandDetector.ts loads in the browser, and
copies it to public/models/yolo-hand/ — the exact path
YOLO_HAND_DETECTOR_CONFIG.MODEL_URL in src/config/recognitionConfig.ts
expects (mirrors how ml-training/convert_to_tfjs.py writes straight to
sign-language-server/models/hand-shape-cnn/).

Output contract this must satisfy (see yoloHandDetector.ts's
parseYoloOutput() for the consuming side): a single output tensor shaped
[1, 4+numClasses, numAnchors] (or the transposed
[1, numAnchors, 4+numClasses] — both are handled), box coords in the
model's own INPUT_SIZE x INPUT_SIZE input space, class scores already
sigmoid-applied. This is Ultralytics' standard `format="tfjs"` export
output — do not hand-roll a different export path without also updating
parseYoloOutput() to match.

Must be run with `ultralytics` installed (same env as train.py is fine —
unlike ml-training's tensorflowjs step, Ultralytics' own TFJS exporter
handles the TF/TFJS conversion internally, no separate WSL step needed
for this particular export path). If you hit the same
tensorflow-decision-forests Windows-wheel issue ml-training/README.md
describes, run this one step from WSL same as that one.
"""

import argparse
import shutil
from pathlib import Path

from ultralytics import YOLO

DEST_DIR = Path(__file__).resolve().parent.parent / "public" / "models" / "yolo-hand"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--weights",
        type=str,
        required=True,
        help="Path to best.pt from train.py, e.g. "
        "runs/hand-detect/hand-detect/weights/best.pt",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Must match YOLO_HAND_DETECTOR_CONFIG.INPUT_SIZE in "
        "src/config/recognitionConfig.ts.",
    )
    parser.add_argument(
        "--quantize",
        action="store_true",
        help="uint8 quantization — smaller download, some accuracy cost. "
        "Omit for a first pass, same recommendation as "
        "ml-training/convert_to_tfjs.py.",
    )
    args = parser.parse_args()

    weights_path = Path(args.weights)
    if not weights_path.exists():
        raise SystemExit(f"No weights file at {weights_path}")

    model = YOLO(str(weights_path))
    export_path = model.export(
        format="tfjs",
        imgsz=args.imgsz,
        int8=args.quantize,
    )
    # Ultralytics writes a `<name>_web_model/` directory next to the
    # weights, containing model.json + shard files.
    web_model_dir = Path(export_path)
    if not web_model_dir.is_dir():
        web_model_dir = weights_path.with_suffix("").parent / (
            weights_path.stem + "_web_model"
        )
    if not web_model_dir.is_dir():
        raise SystemExit(
            f"Expected exported web model directory, got: {export_path}"
        )

    DEST_DIR.mkdir(parents=True, exist_ok=True)
    for item in web_model_dir.iterdir():
        shutil.copy2(item, DEST_DIR / item.name)

    print(f"\nExported to {DEST_DIR}")
    print(
        "Set YOLO_HAND_DETECTOR_CONFIG.ENABLED = true in "
        "src/config/recognitionConfig.ts to start using it."
    )


if __name__ == "__main__":
    main()

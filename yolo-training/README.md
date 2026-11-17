# yolo-training

Fine-tunes a YOLOv8n single-class "hand" detector and exports it to the
TFJS graph model the frontend loads (`src/utils/yoloHandDetector.ts`), to
replace the landmark-derived bounding box in `handCrop.ts` with a box
regressed directly from pixels. See the comment block at the top of
`src/utils/yoloHandDetector.ts` for why this can improve crop stability
over landmarks alone.

This is independent of `ml-training/` (the hand-shape CNN) — different
model, different job (detection vs. classification), different dataset.
Nothing here touches that pipeline or its output.

**Off by default.** `YOLO_HAND_DETECTOR_CONFIG.ENABLED` in
`src/config/recognitionConfig.ts` starts `false`. Until you've actually
run this and set it to `true`, the app behaves exactly as it did before —
`resolveHandBox()` in `yoloHandDetector.ts` just falls straight through to
the existing landmark-based box.

## Setup

```bash
cd yolo-training
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

## 1. Get a dataset

**Read the dataset note at the top of `train.py` first** — this app's
existing captured images (`ml-training/data/`) are already cropped to the
hand, which is wrong for training a detector. You need full, uncropped
frames with bounding-box labels. Practical starting point: a public
hand-detection dataset (EgoHands, HaGRID, Oxford Hands — several have
ready-made YOLO-format exports on Roboflow Universe) converted to
Ultralytics' format:

```
data/hand-detection/
├── data.yaml           # names: [hand], train:/val: paths below
├── images/train/*.jpg
├── images/val/*.jpg
├── labels/train/*.txt  # one line per hand: "0 cx cy w h" (normalized 0-1)
└── labels/val/*.txt
```

## 2. Train

```bash
python train.py --data data/hand-detection/data.yaml
```

Starts from Ultralytics' COCO-pretrained `yolov8n.pt` (auto-downloaded on
first run) and fine-tunes just the one class. Useful flags: `--epochs`,
`--batch`, `--imgsz`. Outputs `runs/hand-detect/hand-detect/weights/best.pt`.

## 3. Export to TFJS

```bash
python export_tfjs.py --weights runs/hand-detect/hand-detect/weights/best.pt
```

Writes `model.json` + weight shards straight to
`../public/models/yolo-hand/` — the exact path
`YOLO_HAND_DETECTOR_CONFIG.MODEL_URL` expects. `--quantize` shrinks the
download (uint8) at some accuracy cost; omit it for a first pass, same
guidance as `ml-training/convert_to_tfjs.py` gives for the CNN.

If `tensorflowjs`'s dependency chain gives you the same
`tensorflow-decision-forests` Windows-wheel problem
`ml-training/README.md` describes for the CNN export, run this step from
WSL the same way.

## 4. Turn it on

Set `YOLO_HAND_DETECTOR_CONFIG.ENABLED = true` in
`src/config/recognitionConfig.ts`, `npm run build` / `npm run dev` as
usual. `resolveHandBox()` will now try the YOLO box first on every hand
crop (recording, admin video-upload, and live recognition), falling back
to the landmark-derived box automatically if a frame's detection score
doesn't clear `SCORE_THRESHOLD`.

## Known limitations

- **Not run end-to-end in this environment** — no GPU and no network
  access to model/dataset hubs (Roboflow, COCO weight mirrors, etc.) from
  the sandbox this was written in. `train.py`/`export_tfjs.py` are
  written directly against Ultralytics' documented API and
  `yoloHandDetector.ts`'s parsing matches Ultralytics' documented
  `format="tfjs"` output layout, but neither has been executed against a
  real dataset — run a short training pass and sanity-check a few
  detections visually before trusting it in the live app.
- No dataset is bundled here, for the same reason none is bundled for the
  CNN — see step 1.
- `INPUT_SIZE` in `recognitionConfig.ts` and `--imgsz` here must match;
  they default to 640 (Ultralytics' standard) on both sides but there's no
  runtime check that catches a mismatch, so keep them in sync by hand
  if you change one.

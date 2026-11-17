# ml-training

**Retired.** This folder used to hold the CNN training pipeline
(`export_dataset.py` → `train.py` → `convert_to_tfjs.py`) for a
transfer-learned static-hand-shape classifier.

Static-word recognition now uses `frameScore` (per-word landmark
z-score distance, see `sign-language-server/src/lib/gestureStats.ts` and
`recognition.routes.ts`) instead of an image-based CNN — it fits this
app's few-shot, teacher-adds-a-word-and-it's-live workflow far better
than a CNN that needed 15-20+ training images per word before it was
usable at all.

The CNN scripts and `sign-language-server/src/lib/handShapeCNN.ts` were
removed. If a CNN approach is ever revisited, treat it as a fresh
design rather than resuming this code — see `git log` on this folder
for the original implementation and rationale if useful as reference.

`requirements.txt` and `data/` are left in place in case any of the
data still has value for a future attempt; nothing here currently runs.

"""
Phase 3 step 1: pulls (word, hand-crop image) pairs for every active
gestureType="static" gesture from the backend's export endpoint and lays
them out as data/<word>/<id>.jpg — the folder-per-class layout
tf.keras.utils.image_dataset_from_directory expects.

This deliberately goes through the REST API (GET
/api/gestures/dataset/export/hand-crops) rather than connecting to Postgres
directly, keeping the Python training environment isolated from DB
credentials the same way the rest of the ML tooling is.

Usage:
    cp .env.example .env   # fill in API_BASE_URL and API_TOKEN
    python export_dataset.py

Prints per-word sample counts and flags any word below the recommended
15-20 crops/word threshold from the CNN roadmap (Phase 3) — those words will
still train, but their CNN score should be treated as a tiebreaker signal,
not a primary vote (see recognitionConfig fusion weights in Phase 5).
"""
import json
import os
import sys
from pathlib import Path

import requests

RECOMMENDED_MIN_PER_WORD = 15
# Below this, a class genuinely can't be learned (no train/val split is even
# possible with 1 sample) — excluded from the dataset entirely rather than
# silently trained on garbage, and reported so the person doing data
# collection knows exactly which words still need recording.
HARD_MIN_PER_WORD = 4

DATA_DIR = Path(__file__).parent / "data"
MANIFEST_PATH = Path(__file__).parent / "manifest.json"


def load_env():
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def fetch_dataset(base_url: str, token: str) -> list[dict]:
    resp = requests.get(
        f"{base_url}/gestures/dataset/export/hand-crops",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    resp.raise_for_status()
    body = resp.json()
    if not body.get("success"):
        raise RuntimeError(f"Export endpoint returned success=false: {body}")
    return body["dataset"]


def download_image(url: str, dest: Path) -> bool:
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        return True
    except requests.RequestException as err:
        print(f"  WARNING: failed to download {url}: {err}", file=sys.stderr)
        return False


def main():
    load_env()
    base_url = os.environ.get("API_BASE_URL")
    token = os.environ.get("API_TOKEN")
    if not base_url or not token:
        print(
            "API_BASE_URL and API_TOKEN must be set (copy .env.example to .env "
            "and fill them in).",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Fetching hand-crop dataset from {base_url} ...")
    rows = fetch_dataset(base_url, token)
    print(f"Backend returned {len(rows)} static-word hand-crop row(s).")

    by_word: dict[str, list[dict]] = {}
    for row in rows:
        by_word.setdefault(row["word"], []).append(row)

    if DATA_DIR.exists():
        print(f"Note: {DATA_DIR} already exists — new images will be added "
              f"alongside existing ones. Delete it first for a clean rebuild.")
    DATA_DIR.mkdir(exist_ok=True)

    manifest = {"words": {}, "excluded_words": {}}
    total_downloaded = 0

    for word, items in sorted(by_word.items()):
        if len(items) < HARD_MIN_PER_WORD:
            manifest["excluded_words"][word] = {
                "count": len(items),
                "reason": f"fewer than {HARD_MIN_PER_WORD} crops — cannot train/val split",
            }
            print(f"  SKIPPING '{word}': only {len(items)} crop(s), "
                  f"needs at least {HARD_MIN_PER_WORD}")
            continue

        word_dir = DATA_DIR / word
        word_dir.mkdir(exist_ok=True)
        downloaded = 0
        for row in items:
            dest = word_dir / f"{row['id']}.jpg"
            if dest.exists():
                downloaded += 1
                continue
            if download_image(row["handCropUrl"], dest):
                downloaded += 1

        manifest["words"][word] = {"count": downloaded}
        total_downloaded += downloaded
        flag = "" if downloaded >= RECOMMENDED_MIN_PER_WORD else \
            f"  (below recommended {RECOMMENDED_MIN_PER_WORD} — CNN output for " \
            f"this word should be treated as a tiebreaker, not primary)"
        print(f"  '{word}': {downloaded} image(s){flag}")

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2))

    print(f"\nDone. {total_downloaded} image(s) across "
          f"{len(manifest['words'])} word(s) written to {DATA_DIR}")
    if manifest["excluded_words"]:
        print(f"{len(manifest['excluded_words'])} word(s) excluded entirely "
              f"(see manifest.json 'excluded_words') — need more recordings "
              f"before they can be part of the CNN branch.")
    if len(manifest["words"]) < 2:
        print(
            "\nERROR: fewer than 2 trainable classes — train.py needs at "
            "least 2 words to build a classifier. Record more static words "
            "first.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()

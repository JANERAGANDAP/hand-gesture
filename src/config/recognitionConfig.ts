export const RECOGNITION_UI_CONFIG = {
  // Requires 2 consecutive agreeing frames before locking in a sign word.
  // This prevents transitional hand motion (e.g. Moving from "I" to "hungry")
  // from falsely locking in a random sign.
  CONSECUTIVE_MATCH_THRESHOLD: 2,
  // Recognition API returns confidence as 0-100 and accepts matches at 45%.
  // Keep the client gate aligned with that server threshold, otherwise valid
  // backend matches in the 45-79% range are discarded before they reach text.
  CONFIDENCE_THRESHOLD: 0.45,
  DETECTION_STABILITY_MS: 500,
  SPEECH_COOLDOWN_MS: 2500,
  REPEAT_DEBOUNCE_MS: 700,
  WORD_TRANSITION_DEBOUNCE_MS: 250,
  MOVEMENT_ENTRY_STREAK: 2,
  // How long (ms) recognition stays active after the last detected
  // movement, instead of shutting off after a couple of still frames.
  // Gives a held static handshape a real window to be scored instead of
  // only ever being scored during the transitional motion into it.
  MOTION_HOLD_MS: 1200,
  MOVEMENT_THRESHOLD: 0.015,
  FEATURE_SMOOTHING_ALPHA: 0.35,
  MIN_RECOGNIZE_INTERVAL_MS: 150,

  // Phase 6 (UNKNOWN path): how many consecutive "low_confidence" /
  // "low_match" recognition responses in a row before we tell the user we
  // genuinely don't know this sign, rather than just staying quiet. Mirrors
  // CONSECUTIVE_MATCH_THRESHOLD's role for successful matches — a single
  // bad frame is noise, a streak of them means the model has an opinion
  // and it's "no idea".
  UNKNOWN_STREAK_THRESHOLD: 4,
} as const;

// Optional hand-detection enhancement (see yoloHandDetector.ts): a YOLO
// model that regresses a hand box directly from pixels, used in place of
// the landmark-derived box in handCrop.ts when available. Off by default
// until a converted model actually exists at MODEL_URL — resolveHandBox()
// falls back to the landmark-only path either way, so flipping ENABLED on
// with no model present is harmless (just an extra failed-fetch check,
// cached after the first attempt).
export const YOLO_HAND_DETECTOR_CONFIG = {
  ENABLED: false,
  // Served from public/models/yolo-hand/ — see yolo-training/README.md
  // for how to produce model.json + weight shards.
  MODEL_URL: "/models/yolo-hand/model.json",
  // Ultralytics default export input resolution for the *n (nano) size
  // this is meant to run as — matches yolo-training's export command.
  INPUT_SIZE: 640,
  // Single class: "hand". A future left/right-specific model would bump
  // this — parseYoloOutput() in yoloHandDetector.ts already maxes over
  // all classes rather than assuming index 0.
  NUM_CLASSES: 1,
  SCORE_THRESHOLD: 0.5,
  IOU_THRESHOLD: 0.45,
} as const;
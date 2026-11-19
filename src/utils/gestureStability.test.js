import test from "node:test";
import assert from "node:assert/strict";
import {
  GestureStabilityTracker,
  shouldSpeakGesture,
} from "./gestureStability.js";

test("gesture needs confidence, consecutive frames, and 500ms stability", () => {
  const tracker = new GestureStabilityTracker(0.8, 500, 2);
  assert.equal(tracker.accepts("hello", 0.79, 0), false);
  assert.equal(tracker.accepts("hello", 0.9, 100), false);
  assert.equal(tracker.accepts("hello", 0.9, 599), false);
  assert.equal(tracker.accepts("hello", 0.9, 600), true);
  assert.equal(tracker.accepts("hello", 0.95, 900), false);
});

test("accepts backend-recognized gestures at its 45 percent minimum confidence", () => {
  const tracker = new GestureStabilityTracker(0.45, 500, 2);
  assert.equal(tracker.accepts("hello", 0.45, 0), false);
  assert.equal(tracker.accepts("hello", 0.45, 500), true);
});

test("stability timer restarts when the predicted gesture changes", () => {
  const tracker = new GestureStabilityTracker(0.8, 500, 2);
  assert.equal(tracker.accepts("hello", 0.9, 0), false);
  assert.equal(tracker.accepts("red", 0.9, 400), false);
  assert.equal(tracker.accepts("red", 0.9, 899), false);
  assert.equal(tracker.accepts("red", 0.9, 900), true);
});

test("same spoken output observes cooldown while a changed output speaks immediately", () => {
  const previous = { text: "hello", targetLanguage: "Tagalog", spokenAt: 1000 };
  assert.equal(
    shouldSpeakGesture("hello", "Tagalog", 2000, previous, 2500),
    false,
  );
  assert.equal(
    shouldSpeakGesture("red", "Tagalog", 2000, previous, 2500),
    true,
  );
  assert.equal(
    shouldSpeakGesture("hello", "Tagalog", 3500, previous, 2500),
    true,
  );
});

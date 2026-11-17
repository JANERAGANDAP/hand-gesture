import test from "node:test";
import assert from "node:assert/strict";
import { shouldThrottleRecognition } from "./recognitionThrottle.js";
test("throttles when the last request is still within the minimum interval", () => {
  assert.equal(shouldThrottleRecognition(250, 200, 100), true);
});
test("allows a new request after the minimum interval has elapsed", () => {
  assert.equal(shouldThrottleRecognition(300, 200, 100), false);
});

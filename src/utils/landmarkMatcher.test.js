import test from "node:test";
import assert from "node:assert/strict";
import { matchLandmarkTemplate } from "./landmarkMatcher.js";

const hand = Array.from({ length: 21 }, (_, index) => ({
  x: index % 5,
  y: Math.floor(index / 5),
  z: index / 100,
}));

test("matches a translated and scaled copy of a hand template", () => {
  const shifted = hand.map(({ x, y, z }) => ({
    x: x * 2 + 5,
    y: y * 2 - 3,
    z: z * 2 + 1,
  }));
  const result = matchLandmarkTemplate(shifted, [
    { word: "hello", landmarks: hand },
  ]);
  assert.equal(result?.word, "hello");
  assert.ok((result?.confidence ?? 0) >= 0.82);
});

test("rejects malformed or dissimilar landmarks", () => {
  assert.equal(matchLandmarkTemplate([], [{ word: "hello", landmarks: hand }]), null);
  const different = hand.map((point, index) => ({
    ...point,
    x: point.x + (index % 2 ? 2 : -2),
  }));
  assert.equal(
    matchLandmarkTemplate(different, [{ word: "hello", landmarks: hand }]),
    null,
  );
});

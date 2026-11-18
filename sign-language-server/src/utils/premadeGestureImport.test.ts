import test from "node:test";
import assert from "node:assert/strict";
import { parsePremadeGestureImport } from "./premadeGestureImport";

const landmarks = Array.from({ length: 21 }, (_, index) => ({
  x: index / 21,
  y: index / 21,
  z: 0,
}));

test("parses a JSON array with 21 point landmarks", () => {
  const entries = parsePremadeGestureImport(
    "dataset.json",
    JSON.stringify([
      {
        gestureLabel: "hello",
        englishWord: "hello",
        tagalogWord: "kumusta",
        cebuanoWord: "kumusta",
        landmarks,
      },
    ]),
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].landmarks.length, 21);
});

test("parses quoted CSV cells and JSON landmarks", () => {
  const csv = [
    "gestureLabel,englishWord,tagalogWord,cebuanoWord,landmarks,imageUrl",
    `"good morning","good, morning",magandang umaga,maayong buntag,"${JSON.stringify(landmarks).replace(/"/g, '""')}",`,
  ].join("\n");
  const [entry] = parsePremadeGestureImport("dataset.csv", csv);
  assert.equal(entry.englishWord, "good, morning");
  assert.equal(entry.landmarks.length, 21);
});

test("rejects malformed or oversized point arrays", () => {
  assert.throws(
    () =>
      parsePremadeGestureImport(
        "bad.json",
        JSON.stringify([
          {
            gestureLabel: "hello",
            englishWord: "hello",
            tagalogWord: "",
            cebuanoWord: "",
            landmarks: [],
          },
        ]),
      ),
    /exactly 21/,
  );
});

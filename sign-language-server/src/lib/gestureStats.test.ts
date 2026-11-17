import test from "node:test";
import assert from "node:assert/strict";
import {
  dtwDistance,
  frameToFrameDistance,
  distanceToConfidence,
  buildWordStats,
  buildGlobalStats,
  buildAllWordStats,
  NUMERIC_FEATURE_KEYS,
  type WordStats,
  type GlobalStats,
} from "./gestureStats";
import { computeEffectiveLimit } from "../config/recognitionConfig";
function frame(overrides: Record<string, any> = {}) {
  const base: Record<string, any> = {};
  for (const key of NUMERIC_FEATURE_KEYS) base[key] = 0;
  base.left_hand_open = true;
  base.right_hand_open = true;
  base.left_hand_above_shoulder = false;
  base.right_hand_above_shoulder = false;
  base.left_fingers = [true, true, true, true, true];
  base.right_fingers = [true, true, true, true, true];
  return {
    ...base,
    ...overrides,
  };
}
function neutralGlobalStats(): GlobalStats {
  const numericStd: Record<string, number> = {};
  for (const key of NUMERIC_FEATURE_KEYS) numericStd[key] = 1;
  return {
    numericStd,
  };
}
function neutralWordStats(sequences: any[][] = []): WordStats {
  const numericMean: Record<string, number> = {};
  const numericStd: Record<string, number> = {};
  for (const key of NUMERIC_FEATURE_KEYS) {
    numericMean[key] = 0;
    numericStd[key] = 1;
  }
  return {
    word: "test",
    gestureType: "dynamic",
    sampleCount: sequences.flat().length,
    numericMean,
    numericStd,
    booleanTrueRate: {
      left_hand_open: 0.5,
      right_hand_open: 0.5,
      left_hand_above_shoulder: 0.5,
      right_hand_above_shoulder: 0.5,
    },
    fingerTrueRate: {
      left: [0.5, 0.5, 0.5, 0.5, 0.5],
      right: [0.5, 0.5, 0.5, 0.5, 0.5],
    },
    sequences,
    maxInternalDistance: 0,
  };
}
test("frameToFrameDistance: identical frames score 0", () => {
  const stats = neutralWordStats();
  const globalStats = neutralGlobalStats();
  const a = frame();
  assert.equal(
    frameToFrameDistance(
      a,
      {
        ...a,
      },
      stats,
      globalStats,
    ),
    0,
  );
});
test("frameToFrameDistance: a numeric difference increases the score", () => {
  const stats = neutralWordStats();
  const globalStats = neutralGlobalStats();
  const a = frame({
    left_elbow_angle: 0,
  });
  const b = frame({
    left_elbow_angle: 5,
  });
  assert.ok(frameToFrameDistance(a, b, stats, globalStats) > 0);
});
test("frameToFrameDistance: a boolean flag mismatch adds a fixed penalty", () => {
  const stats = neutralWordStats();
  const globalStats = neutralGlobalStats();
  const a = frame({
    left_hand_open: true,
  });
  const b = frame({
    left_hand_open: false,
  });
  assert.equal(frameToFrameDistance(a, b, stats, globalStats), 9);
});
test("dtwDistance: empty sequences on either side return Infinity", () => {
  const stats = neutralWordStats();
  const globalStats = neutralGlobalStats();
  assert.equal(dtwDistance([], [frame()], stats, globalStats), Infinity);
  assert.equal(dtwDistance([frame()], [], stats, globalStats), Infinity);
  assert.equal(dtwDistance([], [], stats, globalStats), Infinity);
});
test("dtwDistance: identical sequences score 0", () => {
  const stats = neutralWordStats();
  const globalStats = neutralGlobalStats();
  const seq = [
    frame(),
    frame({
      left_elbow_angle: 1,
    }),
    frame({
      left_elbow_angle: 2,
    }),
  ];
  const seqCopy = seq.map((f) => ({
    ...f,
  }));
  assert.equal(dtwDistance(seq, seqCopy, stats, globalStats), 0);
});
test("dtwDistance: a clearly different sequence scores higher than an identical one", () => {
  const stats = neutralWordStats();
  const globalStats = neutralGlobalStats();
  const seqA = [
    frame({
      left_elbow_angle: 0,
    }),
    frame({
      left_elbow_angle: 1,
    }),
    frame({
      left_elbow_angle: 2,
    }),
  ];
  const seqB = seqA.map((f) => ({
    ...f,
  }));
  const seqC = [
    frame({
      left_elbow_angle: 50,
    }),
    frame({
      left_elbow_angle: 51,
    }),
    frame({
      left_elbow_angle: 52,
    }),
  ];
  const sameDistance = dtwDistance(seqA, seqB, stats, globalStats);
  const diffDistance = dtwDistance(seqA, seqC, stats, globalStats);
  assert.ok(diffDistance > sameDistance);
});
test("dtwDistance: is tolerant of different sequence lengths (time warping)", () => {
  const stats = neutralWordStats();
  const globalStats = neutralGlobalStats();
  const fast = [
    frame({
      left_elbow_angle: 0,
    }),
    frame({
      left_elbow_angle: 10,
    }),
    frame({
      left_elbow_angle: 20,
    }),
  ];
  const slow = [
    frame({
      left_elbow_angle: 0,
    }),
    frame({
      left_elbow_angle: 0,
    }),
    frame({
      left_elbow_angle: 10,
    }),
    frame({
      left_elbow_angle: 10,
    }),
    frame({
      left_elbow_angle: 20,
    }),
    frame({
      left_elbow_angle: 20,
    }),
  ];
  const unrelated = [
    frame({
      left_elbow_angle: 90,
    }),
    frame({
      left_elbow_angle: 95,
    }),
    frame({
      left_elbow_angle: 100,
    }),
  ];
  const warpedDistance = dtwDistance(fast, slow, stats, globalStats);
  const unrelatedDistance = dtwDistance(fast, unrelated, stats, globalStats);
  assert.ok(
    warpedDistance < unrelatedDistance,
    "time-warped same motion should score much closer than an unrelated one",
  );
});
test("dtwDistance: an early-exit bound below the true distance returns Infinity", () => {
  const stats = neutralWordStats();
  const globalStats = neutralGlobalStats();
  const seqA = [
    frame({
      left_elbow_angle: 0,
    }),
  ];
  const seqB = [
    frame({
      left_elbow_angle: 100,
    }),
  ];
  assert.equal(dtwDistance(seqA, seqB, stats, globalStats, 0.0001), Infinity);
});
test("computeEffectiveLimit: fewer than 2 sequences falls back to the generous default", () => {
  assert.equal(computeEffectiveLimit(null), 35);
  assert.equal(computeEffectiveLimit(undefined), 35);
  assert.equal(
    computeEffectiveLimit({
      sequences: [],
    }),
    35,
  );
  assert.equal(
    computeEffectiveLimit({
      sequences: [[frame()]],
    }),
    35,
  );
});
test("computeEffectiveLimit: scales maxInternalDistance and clamps to [28, 60]", () => {
  assert.equal(
    computeEffectiveLimit({
      maxInternalDistance: 10,
      sequences: [[frame()], [frame()]],
    }),
    28,
  );
  assert.equal(
    computeEffectiveLimit({
      maxInternalDistance: 20,
      sequences: [[frame()], [frame()]],
    }),
    44,
  );
  assert.equal(
    computeEffectiveLimit({
      maxInternalDistance: 50,
      sequences: [[frame()], [frame()]],
    }),
    60,
  );
});
test("distanceToConfidence: distance 0 is 100% confidence", () => {
  assert.equal(distanceToConfidence(0), 100);
});
test("distanceToConfidence: Infinity/NaN distance is 0% confidence, never NaN", () => {
  assert.equal(distanceToConfidence(Infinity), 0);
  assert.equal(distanceToConfidence(NaN), 0);
});
test("distanceToConfidence: larger distance always yields lower confidence", () => {
  const near = distanceToConfidence(5);
  const far = distanceToConfidence(50);
  assert.ok(near > far);
  assert.ok(near <= 100 && far >= 0);
});
test("buildWordStats: a word with 0-2 recordings does not crash and reports sampleCount", () => {
  const globalStats = buildGlobalStats([]);
  const stats = buildWordStats("hello", [], globalStats);
  assert.equal(stats.sampleCount, 0);
  assert.equal(stats.maxInternalDistance, 0);
});
test("buildWordStats: maxInternalDistance is 0 with fewer than 2 sequences (no pairwise signal yet)", () => {
  const rows = [
    {
      word: "hello",
      sequence: [
        {
          features: frame(),
        },
        {
          features: frame(),
        },
      ],
    },
  ];
  const globalStats = buildGlobalStats(rows);
  const stats = buildWordStats("hello", rows, globalStats);
  assert.equal(
    stats.maxInternalDistance,
    0,
    "a single recording has no pairwise distance to measure",
  );
});
test("buildAllWordStats: groups rows by word and skips rows with no word", () => {
  const rows = [
    {
      word: "hello",
      sequence: [
        {
          features: frame(),
        },
      ],
    },
    {
      word: "hello",
      sequence: [
        {
          features: frame(),
        },
      ],
    },
    {
      word: "thanks",
      sequence: [
        {
          features: frame(),
        },
      ],
    },
    {
      sequence: [
        {
          features: frame(),
        },
      ],
    },
  ];
  const all = buildAllWordStats(rows);
  assert.equal(all.size, 2);
  assert.ok(all.has("hello"));
  assert.ok(all.has("thanks"));
  assert.equal(all.get("hello")!.sampleCount, 2);
});
test("buildWordStats: gestureType defaults to dynamic when rows have none", () => {
  const rows = [{ word: "hello", sequence: [{ features: frame() }] }];
  const globalStats = buildGlobalStats(rows);
  const stats = buildWordStats("hello", rows, globalStats);
  assert.equal(stats.gestureType, "dynamic");
});
test("buildWordStats: gestureType picks up an explicit static value", () => {
  const rows = [
    { word: "a", gestureType: "static", sequence: [{ features: frame() }] },
  ];
  const globalStats = buildGlobalStats(rows);
  const stats = buildWordStats("a", rows, globalStats);
  assert.equal(stats.gestureType, "static");
});
test("buildWordStats: gestureType is case-insensitive (tolerates legacy mixed-case rows)", () => {
  const rows = [
    { word: "a", gestureType: "STATIC", sequence: [{ features: frame() }] },
  ];
  const globalStats = buildGlobalStats(rows);
  const stats = buildWordStats("a", rows, globalStats);
  assert.equal(
    stats.gestureType,
    "static",
    "an uppercase legacy value should still normalize to static",
  );
});
test("buildAllWordStats: each word's gestureType is independent of other words'", () => {
  const rows = [
    { word: "hello", gestureType: "dynamic", sequence: [{ features: frame() }] },
    { word: "a", gestureType: "static", sequence: [{ features: frame() }] },
  ];
  const all = buildAllWordStats(rows);
  assert.equal(all.get("hello")!.gestureType, "dynamic");
  assert.equal(all.get("a")!.gestureType, "static");
});
import prisma from "../config/prisma";
import {
  buildAllWordStats,
  buildGlobalStats,
  dtwDistance,
  frameDistance,
  WordStats,
  GlobalStats,
} from "../lib/gestureStats";

import { sequenceSummaryDistance } from "../lib/gestureSimilarity";
import {
  computeEffectiveLimit,
  RECOGNITION_CONFIG,
} from "../config/recognitionConfig";
import { distanceToConfidence } from "../lib/gestureStats";

interface Row {
  word: string;
  sequence: any[];
  // Phase 7: needed so buildAllWordStats/buildWordStats tag each word's
  // WordStats.gestureType correctly. Without this every row silently
  // defaulted to "dynamic" (see gestureStats.ts's `?? "dynamic"` fallback)
  // and the fusion gate in classify() below would never fire for static
  // words — a real bug the DTW-only-only version of this script had.
  gestureType: string;
}

// One recording as grouped by word for leave-one-out — kept separate from
// Row (the shape buildAllWordStats/buildGlobalStats expect).
interface Recording {
  frames: any[];
}

interface EvalResult {
  word: string;
  correct: boolean;
  predictedWord: string | null;
  distance: number;
  rawBestWord: string | null;
  rawBestDistance: number;
  effectiveLimit: number | null;
  confidence: number | null;
  rejectionReason: "none" | "over_limit" | "low_confidence" | "no_candidates";
  gestureType: "static" | "dynamic";
  // Which recording (within this word's list) was held out.
  holdoutIdx: number;
}

// Classifies a frame sequence against trained per-word stats: best DTW match
// (dynamic words) or best frame-distance match (static words), gated by
// that word's effective distance limit. Also reports *why* a rejection
// happened, so a bad result can be traced to a threshold vs data.
function classify(
  liveFrames: any[],
  allStats: Map<string, WordStats>,
  globalStats: GlobalStats,
): {
  word: string | null;
  distance: number;
  rawBestWord: string | null;
  rawBestDistance: number;
  effectiveLimit: number | null;
  confidence: number | null;
  rejectionReason: EvalResult["rejectionReason"];
} {
  let best: {
    word: string;
    distance: number;
  } | null = null;

  for (const [word, stats] of allStats) {
    if (!stats.sequences.length) continue;

    // Static candidates skip DTW entirely — a held hand-shape has no
    // motion for DTW to align — and score on frameDistance, the per-word
    // z-score distance over MediaPipe landmark features (same as
    // recognition.routes.ts).
    let candidateDistance: number;
    if (stats.gestureType === "static") {
      candidateDistance = frameDistance(
        liveFrames[liveFrames.length - 1],
        stats,
        globalStats,
      );
    } else {
      let dtwScore = Infinity;
      for (const stored of stats.sequences) {
        const d = dtwDistance(
          liveFrames,
          stored,
          stats,
          globalStats,
          dtwScore,
        );
        if (d < dtwScore) dtwScore = d;
      }
      candidateDistance = dtwScore;
    }

    if (!best || candidateDistance < best.distance) {
      best = { word, distance: candidateDistance };
    }
  }

  if (!best) {
    return {
      word: null,
      distance: Infinity,
      rawBestWord: null,
      rawBestDistance: Infinity,
      effectiveLimit: null,
      confidence: null,
      rejectionReason: "no_candidates",
    };
  }

  const stats = allStats.get(best.word);
  const limit = computeEffectiveLimit(stats);
  const confidence = distanceToConfidence(
    best.distance,
    RECOGNITION_CONFIG.CONFIDENCE_SCALE,
  );

  if (best.distance > limit) {
    return {
      word: null,
      distance: best.distance,
      rawBestWord: best.word,
      rawBestDistance: best.distance,
      effectiveLimit: limit,
      confidence,
      rejectionReason: "over_limit",
    };
  }

  if (confidence < RECOGNITION_CONFIG.DYNAMIC_MIN_CONFIDENCE) {
    return {
      word: null,
      distance: best.distance,
      rawBestWord: best.word,
      rawBestDistance: best.distance,
      effectiveLimit: limit,
      confidence,
      rejectionReason: "low_confidence",
    };
  }

  return {
    word: best.word,
    distance: best.distance,
    rawBestWord: best.word,
    rawBestDistance: best.distance,
    effectiveLimit: limit,
    confidence,
    rejectionReason: "none",
  };
}

async function main() {
  console.log("Loading gesture recordings...");
  const rows = (await prisma.signGesture.findMany({
    where: { isActive: true },
    select: {
      word: true,
      sequence: true,
      features: true,
      gestureType: true,
    },
  })) as any[];

  const grouped = new Map<string, Recording[]>();
  // First-seen gestureType per word, normalized the same way
  // gestureStats.ts does — kept alongside `grouped` rather than re-derived
  // per training fold, since it doesn't change across leave-one-out runs.
  const wordGestureType = new Map<string, "static" | "dynamic">();
  for (const row of rows) {
    const seq =
      Array.isArray(row.sequence) && row.sequence.length
        ? row.sequence
        : row.features
          ? [row.features]
          : [];
    if (!seq.length) continue;
    const frames = seq.map((f: any) => f.features ?? f);
    const list = grouped.get(row.word) ?? [];
    list.push({ frames });
    grouped.set(row.word, list);
    if (!wordGestureType.has(row.word)) {
      wordGestureType.set(
        row.word,
        String(row.gestureType ?? "dynamic").toLowerCase() === "static"
          ? "static"
          : "dynamic",
      );
    }
  }

  const evaluableWords = [...grouped.entries()].filter(
    ([, recs]) => recs.length >= 2,
  );
  const skippedWords = [...grouped.entries()]
    .filter(([, recs]) => recs.length < 2)
    .map(([w]) => w);

  if (skippedWords.length) {
    console.log(
      `\n⚠ Skipping ${skippedWords.length} word(s) with < 2 recordings (can't cross-validate): ${skippedWords.join(", ")}`,
    );
  }

  if (evaluableWords.length === 0) {
    console.log(
      "\nNo words have 2+ recordings yet — nothing to evaluate. Record more samples per word first.",
    );
    return;
  }

  const results: EvalResult[] = [];
  const confusions: Record<string, Record<string, number>> = {};

  console.log(
    `\nRunning leave-one-out validation on ${evaluableWords.length} word(s)...\n`,
  );

  for (const [word, recordings] of evaluableWords) {
    for (let holdoutIdx = 0; holdoutIdx < recordings.length; holdoutIdx++) {
      // Leave-one-out: hide this recording, train on everything else, ask
      // the classifier to guess it, then check if it guessed right.
      const trainingRows: Row[] = [];
      for (const [w, recs] of grouped) {
        recs.forEach((rec, i) => {
          if (w === word && i === holdoutIdx) return;
          trainingRows.push({
            word: w,
            sequence: rec.frames,
            gestureType: wordGestureType.get(w) ?? "dynamic",
          });
        });
      }

      const globalStats = buildGlobalStats(trainingRows);
      const wordStats = buildAllWordStats(trainingRows);

      const heldOutFrames = recordings[holdoutIdx].frames.slice(
        -RECOGNITION_CONFIG.MAX_LIVE_FRAMES,
      );
      const classification = classify(heldOutFrames, wordStats, globalStats);
      const { word: predicted, distance } = classification;

      const correct = predicted === word;
      results.push({
        word,
        correct,
        predictedWord: predicted,
        distance,
        rawBestWord: classification.rawBestWord,
        rawBestDistance: classification.rawBestDistance,
        effectiveLimit: classification.effectiveLimit,
        confidence: classification.confidence,
        rejectionReason: classification.rejectionReason,
        gestureType: wordGestureType.get(word) ?? "dynamic",
        holdoutIdx,
      });

      if (!correct) {
        const key = predicted ?? "(no match / rejected)";
        confusions[word] = confusions[word] ?? {};
        confusions[word][key] = (confusions[word][key] ?? 0) + 1;
      }
    }
  }

  const overallCorrect = results.filter((r) => r.correct).length;
  const overallAccuracy = ((overallCorrect / results.length) * 100).toFixed(1);

  console.log("═".repeat(60));
  console.log(
    `OVERALL ACCURACY: ${overallAccuracy}%  (${overallCorrect}/${results.length} held-out samples correctly identified)`,
  );
  console.log("═".repeat(60));

  // Split by gestureType. Dynamic words are DTW-based; static words are
  // frame-distance-based (per-word z-score over MediaPipe landmarks) —
  // neither uses the other's method.
  for (const gt of ["dynamic", "static"] as const) {
    const gtResults = results.filter((r) => r.gestureType === gt);
    if (!gtResults.length) continue;
    const gtCorrect = gtResults.filter((r) => r.correct).length;
    const gtPct = ((gtCorrect / gtResults.length) * 100).toFixed(1);
    console.log(
      `  ${gt === "static" ? "Static (frame-distance)" : "Dynamic (DTW)"}: ${gtPct}%  (${gtCorrect}/${gtResults.length})`,
    );
  }

  console.log("\nPer-word accuracy:");
  for (const gt of ["dynamic", "static"] as const) {
    const gtWords = evaluableWords.filter(
      ([w]) => (wordGestureType.get(w) ?? "dynamic") === gt,
    );
    if (!gtWords.length) continue;
    console.log(`  ${gt === "static" ? "-- Static --" : "-- Dynamic --"}`);
    for (const [word, recs] of gtWords) {
      const wordResults = results.filter((r) => r.word === word);
      const correct = wordResults.filter((r) => r.correct).length;
      const pct = ((correct / wordResults.length) * 100).toFixed(0);
      console.log(
        `    ${word.padEnd(20)} ${correct}/${wordResults.length} (${pct}%)  [${recs.length} total recordings]`,
      );
    }
  }

  const confusedWords = Object.keys(confusions);
  if (confusedWords.length) {
    console.log("\nConfusions (word → what it got mistaken for):");
    for (const word of confusedWords) {
      const entries = Object.entries(confusions[word]).sort(
        (a, b) => b[1] - a[1],
      );
      const summary = entries
        .map(([w, count]) => `${w} (${count}x)`)
        .join(", ");
      console.log(`  ${word} → ${summary}`);
    }
    console.log(
      "\nTip: if two words consistently confuse each other, either they're recorded too" +
        " similarly (re-record with more distinct motion) or RECOGNITION_CONFIG's" +
        " INTERNAL_DISTANCE_MULTIPLIER/limits need tightening for those specific words.",
    );
  } else {
    console.log(
      "\nNo confusions — every mismatch (if any) was a rejection, not a wrong-word match.",
    );
  }

  // Split every wrong/rejected result: was the raw nearest match actually the
  // right word (a threshold blocked it — tuning issue), or was it not even
  // the closest candidate (the recording itself doesn't resemble its peers).
  const rejectedButRight = results.filter(
    (r) => !r.correct && r.rawBestWord === r.word,
  );
  if (rejectedButRight.length) {
    console.log(
      "\nRejected-but-would-have-been-correct (tuning issue, not a data issue):",
    );
    for (const r of rejectedButRight) {
      const limitStr =
        r.effectiveLimit !== null ? r.effectiveLimit.toFixed(1) : "n/a";
      const confStr = r.confidence !== null ? r.confidence.toFixed(0) : "n/a";
      console.log(
        `  ${r.word.padEnd(15)} reason=${r.rejectionReason.padEnd(14)} ` +
          `distance=${r.rawBestDistance.toFixed(1)} vs limit=${limitStr}  ` +
          `confidence=${confStr} vs min=${RECOGNITION_CONFIG.DYNAMIC_MIN_CONFIDENCE}`,
      );
    }
  }

  const genuinelyWrong = results.filter(
    (r) => !r.correct && r.rawBestWord !== r.word,
  );
  if (genuinelyWrong.length) {
    console.log(
      "\nGenuinely off (nearest match wasn't the right word — a data issue):",
    );
    for (const r of genuinelyWrong) {
      const nearest = r.rawBestWord ?? "(none)";
      console.log(
        `  ${r.word.padEnd(15)} nearest_candidate=${nearest.padEnd(15)} distance=${r.rawBestDistance.toFixed(1)}`,
      );
    }
  }

  console.log(
    "\nDone. Re-run this after adding more recordings or changing recognitionConfig.ts to track progress.",
  );
}

main()
  .catch((err) => {
    console.error("Evaluation failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
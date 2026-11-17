// sign-language-server/src/routes/recognition.routes.ts
import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import prisma from "../config/prisma";
import {
  buildAllWordStats,
  buildGlobalStats,
  frameDistance,
  dtwDistance,
  distanceToConfidence,
  WordStats,
  GlobalStats,
} from "../lib/gestureStats";
import { sequenceSummaryDistance } from "../lib/gestureSimilarity";
import {
  RECOGNITION_CONFIG,
  computeEffectiveLimit,
  applyAmbiguityPenalty,
} from "../config/recognitionConfig";
import { recognitionLimiter, generalLimiter } from "../middleware/rateLimiters";
interface DynamicCandidate {
  word: string;
  distance: number;
  dtwDistance: number;
  frameDistance: number;
  sampleCount: number;
  confidence?: number;
}
const router = Router();
let statsCache: {
  builtAt: number;
  stats: Map<string, WordStats>;
  globalStats: GlobalStats;
} | null = null;

// Coalesce concurrent cold-cache requests so only one full gesture query runs
// per process. The generation prevents a query started before an invalidation
// from repopulating the cache with stale data.
let statsBuildPromise: Promise<{
  stats: Map<string, WordStats>;
  globalStats: GlobalStats;
}> | null = null;
let statsCacheGeneration = 0;

export function clearStatsCache() {
  statsCacheGeneration += 1;
  statsCache = null;
  // Detach the in-flight build. A subsequent request may start a fresh build;
  // the older build is not allowed to populate the cache.
  statsBuildPromise = null;
}

async function getWordStats(): Promise<{
  stats: Map<string, WordStats>;
  globalStats: GlobalStats;
  cacheHit: boolean;
  statsMs: number;
}> {
  const statsStart = Date.now();
  const cacheIsFresh =
    statsCache !== null &&
    Date.now() - statsCache.builtAt < RECOGNITION_CONFIG.STATS_CACHE_MS;

  if (cacheIsFresh && statsCache) {
    return {
      stats: statsCache.stats,
      globalStats: statsCache.globalStats,
      cacheHit: true,
      statsMs: Date.now() - statsStart,
    };
  }

  const generationAtStart = statsCacheGeneration;

  if (!statsBuildPromise) {
    const buildPromise = (async () => {
      const rows = await prisma.signGesture.findMany({
        where: { isActive: true },
        select: {
          word: true,
          features: true,
          sequence: true,
          gestureType: true,
          isActive: true,
        },
      });

      const stats = buildAllWordStats(rows);
      const globalStats = buildGlobalStats(rows);

      if (generationAtStart === statsCacheGeneration) {
        statsCache = {
          builtAt: Date.now(),
          stats,
          globalStats,
        };
      }

      return { stats, globalStats };
    })();

    statsBuildPromise = buildPromise;
    void buildPromise.finally(() => {
      // Do not clear a newer build started after cache invalidation.
      if (statsBuildPromise === buildPromise) {
        statsBuildPromise = null;
      }
    }).catch(() => {
      // The original await below propagates the query/build error.
    });
  }

  const result = await statsBuildPromise;

  // If a write invalidated the cache while this request was waiting, discard
  // the potentially stale result and rebuild against the latest DB state.
  if (generationAtStart !== statsCacheGeneration) {
    return getWordStats();
  }

  return {
    ...result,
    cacheHit: false,
    statsMs: Date.now() - statsStart,
  };
}
router.post("/", authenticate, recognitionLimiter, async (req, res) => {
  const requestStart = Date.now();
  function sendResult(
    payload: Record<string, any>,
    statsTiming?: {
      cacheHit: boolean;
      statsMs: number;
    },
    scoringMs = 0,
  ) {
    return res.json({
      ...payload,
      timing: {
        totalServerMs: Date.now() - requestStart,
        statsMs: statsTiming?.statsMs ?? 0,
        cacheHit: statsTiming?.cacheHit ?? null,
        scoringMs,
      },
    });
  }
  try {
    // handCropImage: still sent by the frontend on every frame, but no
    // longer consumed here now that static scoring is frameScore-only —
    // left destructured-and-unused rather than changing the request
    // contract; dropping it from the frontend payload is a separate,
    // low-priority cleanup (smaller request body), not a correctness fix.
    const { features, sequence, handCropImage: _handCropImage } = req.body;
    if (!features) {
      return sendResult({
        recognized: false,
        word: null,
        reason: "no_features",
      });
    }
    const {
      stats: wordStats,
      globalStats,
      cacheHit,
      statsMs,
    } = await getWordStats();
    if (wordStats.size === 0) {
      return sendResult(
        {
          recognized: false,
          word: null,
          reason: "no_training_data",
        },
        {
          cacheHit,
          statsMs,
        },
      );
    }
    const scoringStart = Date.now();
    const liveFrames =
      Array.isArray(sequence) && sequence.length >= 4
        ? sequence
            .map((f: any) => f.features ?? f)
            .slice(-RECOGNITION_CONFIG.MAX_LIVE_FRAMES)
        : null;
    const scoredWords: Array<{
      word: string;
      frameScore: number;
      stats: WordStats;
    }> = [];
    for (const [word, stats] of wordStats) {
      const frameScore = frameDistance(features, stats, globalStats);
      scoredWords.push({
        word,
        frameScore,
        stats,
      });
    }
    scoredWords.sort((a, b) => a.frameScore - b.frameScore);
    const qualifiedWords = scoredWords.filter(
      (s) =>
        s.stats.sampleCount >= RECOGNITION_CONFIG.MIN_SAMPLES_FOR_RECOGNITION,
    );
    // The closest match overall, regardless of training status. If this is
    // an under-trained word (below MIN_SAMPLES_FOR_RECOGNITION) and it's at
    // least as close a match as the best *qualified* candidate, don't let a
    // trained-but-wrong word silently win just because the right word isn't
    // trained enough yet — report "still_training" for the real candidate
    // instead of a confident wrong answer. Without this, an under-trained
    // word is invisibly dropped from candidacy (see qualifiedWords filter
    // above) and any geometrically-close trained word wins by default, with
    // no signal to the user that the word they actually signed was excluded.
    const overallClosest = scoredWords[0];
    const bestQualifiedFrameScore = qualifiedWords[0]?.frameScore;
    const closestIsUndertrainedAndCompetitive =
      !!overallClosest &&
      overallClosest.stats.sampleCount <
        RECOGNITION_CONFIG.MIN_SAMPLES_FOR_RECOGNITION &&
      (bestQualifiedFrameScore === undefined ||
        overallClosest.frameScore <= bestQualifiedFrameScore);
    if (qualifiedWords.length === 0 || closestIsUndertrainedAndCompetitive) {
      const closest = overallClosest;
      return sendResult(
        {
          recognized: false,
          word: null,
          confidence: 0,
          reason: "still_training",
          trainingWord: closest?.word ?? null,
          samplesNeeded: closest
            ? Math.max(
                0,
                RECOGNITION_CONFIG.MIN_SAMPLES_FOR_RECOGNITION -
                  closest.stats.sampleCount,
              )
            : null,
        },
        {
          cacheHit,
          statsMs,
        },
        Date.now() - scoringStart,
      );
    }
    const topCandidates = qualifiedWords.slice(
      0,
      RECOGNITION_CONFIG.RECOGNITION_TOP_K,
    );
    const ranked: DynamicCandidate[] = [];
    for (const { word, frameScore, stats } of topCandidates) {
      let finalScore: number;
      let dtwScore = Infinity;
      // Static words: no motion to align, so DTW never runs for them —
      // frameScore (the per-word z-score distance over MediaPipe hand/
      // pose landmarks — wrist/elbow/palm-normal/finger-state features,
      // see gestureStats.ts's frameDistance) is the whole score. This
      // replaced the image-based hand-shape CNN, which needed far more
      // per-word training samples than this app's few-shot,
      // teacher-adds-a-word-and-it's-live workflow ever produces —
      // frameScore already does per-word template matching the same way
      // DTW does for dynamic words, just on a single frame instead of a
      // sequence, so it fits this app's actual data profile instead of
      // fighting it.
      if (stats.gestureType === "static") {
        finalScore = frameScore;
      } else if (liveFrames && stats.sequences.length) {
        let summaryScore = Infinity;
        const rankedSequences = stats.sequences
          .map((stored: any) => ({
            stored,
            summary: sequenceSummaryDistance(liveFrames, stored),
          }))
          .sort((a, b) => a.summary - b.summary)
          .slice(0, RECOGNITION_CONFIG.MAX_SEQUENCES_PER_WORD);
        for (const { stored, summary } of rankedSequences) {
          const d = dtwDistance(
            liveFrames,
            stored,
            stats,
            globalStats,
            dtwScore,
          );
          if (d < dtwScore) dtwScore = d;
          if (summary < summaryScore) summaryScore = summary;
        }
        finalScore = dtwScore * 0.7 + summaryScore * 0.2 + frameScore * 0.1;
      } else {
        finalScore = frameScore;
      }
      ranked.push({
        word,
        distance: finalScore,
        dtwDistance: dtwScore,
        frameDistance: frameScore,
        sampleCount: stats.sampleCount,
      });
    }
    ranked.sort((a, b) => a.distance - b.distance);
    const best = ranked[0];
    if (!best) {
      return sendResult(
        {
          recognized: false,
          word: null,
          confidence: 0,
          reason: "no_candidates",
        },
        {
          cacheHit,
          statsMs,
        },
        Date.now() - scoringStart,
      );
    }
    const bestStats = wordStats.get(best.word);
    const effectiveLimit = computeEffectiveLimit(bestStats);
    if (best.distance > effectiveLimit) {
      return sendResult(
        {
          recognized: false,
          word: null,
          confidence: 0,
          score: best.distance,
          reason: "low_match",
        },
        {
          cacheHit,
          statsMs,
        },
        Date.now() - scoringStart,
      );
    }
    const second = ranked[1];
    const gap = second ? second.distance - best.distance : null;
    let confidence = distanceToConfidence(
      best.distance,
      RECOGNITION_CONFIG.CONFIDENCE_SCALE,
    );
    confidence = applyAmbiguityPenalty(confidence, gap);
    if (confidence < RECOGNITION_CONFIG.DYNAMIC_MIN_CONFIDENCE) {
      return sendResult(
        {
          recognized: false,
          word: best.word,
          confidence,
          score: best.distance,
          reason: "low_confidence",
        },
        {
          cacheHit,
          statsMs,
        },
        Date.now() - scoringStart,
      );
    }
    return sendResult(
      {
        recognized: true,
        word: best.word,
        confidence,
        score: best.distance,
        alternatives: ranked.slice(1, 4).map((c) => ({
          word: c.word,
          confidence: distanceToConfidence(
            c.distance,
            RECOGNITION_CONFIG.CONFIDENCE_SCALE,
          ),
        })),
      },
      {
        cacheHit,
        statsMs,
      },
      Date.now() - scoringStart,
    );
  } catch (err) {
    console.error("Recognition error:", err);
    return res.status(500).json({
      recognized: false,
      word: null,
      error: "Server error during recognition",
      timing: {
        totalServerMs: Date.now() - requestStart,
        statsMs: 0,
        cacheHit: null,
        scoringMs: 0,
      },
    });
  }
});
router.get("/coverage", generalLimiter, async (_, res) => {
  try {
    const grouped = await prisma.signGesture.groupBy({
      by: ["word"],
      where: {
        isActive: true,
      },
      _count: {
        word: true,
      },
      _sum: {
        frameCount: true,
      },
    });
    const RECOMMENDED_RECORDINGS = 10;
    const words = grouped
      .map((g) => {
        const recordings = g._count.word;
        const status: "stable" | "needs_more_samples" | "untrained" =
          recordings === 0
            ? "untrained"
            : recordings >= RECOMMENDED_RECORDINGS
              ? "stable"
              : "needs_more_samples";
        return {
          word: g.word,
          recordings,
          totalFrames: g._sum.frameCount ?? 0,
          status,
        };
      })
      .sort((a, b) => a.word.localeCompare(b.word));
    res.json({
      success: true,
      words,
    });
  } catch (err) {
    console.error("Coverage error:", err);
    res.status(500).json({
      success: false,
      words: [],
      error: "Failed to compute coverage",
    });
  }
});
router.get("/health", generalLimiter, async (_, res) => {
  try {
    const { stats } = await getWordStats();
    res.json({
      online: true,
      wordsKnown: stats.size,
      status: "healthy",
    });
  } catch (err) {
    res.status(500).json({
      online: false,
    });
  }
});
// Builds the gesture-stats cache ahead of the first real recognition call.
// Authenticated so it cannot be used anonymously to trigger database reads.
router.get("/warm", authenticate, async (_req, res) => {
  try {
    const { cacheHit, statsMs } = await getWordStats();
    return res.json({ ok: true, cacheHit, statsMs });
  } catch (error) {
    console.error("[recognize/warm] failed:", error);
    return res.status(500).json({ ok: false });
  }
});
export default router;
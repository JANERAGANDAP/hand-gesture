// One-time backfill: fixes mixed-case gestureType values left over from the
// frontend bug where gestureApi.ts sent gestureType.toUpperCase() ("DYNAMIC")
// while the Prisma schema default and bulk-ingest script both used lowercase
// ("dynamic"). Phase 2 of the CNN roadmap (score-fusion CNN + DTW) enforces
// that every word's recordings share one gestureType, and reads/writes now
// normalize casing in-memory — but rows already sitting in the DB with mixed
// casing should be fixed at the source rather than relied on being tolerated
// forever by every reader.
//
// Run with: npx ts-node src/scripts/normalizeGestureTypes.ts
// Add --dry-run to preview changes without writing anything.
import prisma from "../config/prisma";

function normalize(value: string | null | undefined): "static" | "dynamic" {
  return String(value ?? "").toLowerCase() === "static" ? "static" : "dynamic";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Step 1: find every distinct raw gestureType string currently in the DB.
  // Anything that isn't exactly "static" or "dynamic" (lowercase) needs
  // normalizing — this catches "DYNAMIC", "Static", " dynamic", etc., and
  // also any unexpected garbage value (falls back to "dynamic").
  const distinctValues = await prisma.signGesture.groupBy({
    by: ["gestureType"],
    _count: { gestureType: true },
  });

  const toFix = distinctValues.filter(
    (row) => row.gestureType !== normalize(row.gestureType),
  );

  if (toFix.length === 0) {
    console.log("No mixed-case or invalid gestureType values found. Nothing to do.");
  } else {
    console.log(`Found ${toFix.length} raw gestureType value(s) needing normalization:`);
    for (const row of toFix) {
      console.log(
        `  "${row.gestureType}" -> "${normalize(row.gestureType)}" (${row._count.gestureType} row(s))`,
      );
    }
    if (dryRun) {
      console.log("\n--dry-run: no changes written.");
    } else {
      for (const row of toFix) {
        const result = await prisma.signGesture.updateMany({
          where: { gestureType: row.gestureType },
          data: { gestureType: normalize(row.gestureType) },
        });
        console.log(
          `  Updated ${result.count} row(s): "${row.gestureType}" -> "${normalize(row.gestureType)}"`,
        );
      }
    }
  }

  // Step 2: after normalization, check whether any single word still ends up
  // with BOTH static and dynamic recordings. That's not a casing bug — it's
  // a genuine data conflict (e.g. two different people recorded the same
  // word with different intents before the Phase 2 write-time guard
  // existed), and there's no safe automatic fix for it: picking either type
  // silently would discard real training data for a live word. Flag it for
  // manual review (via PUT /api/gestures/:id) instead of auto-resolving.
  const rows = await prisma.signGesture.findMany({
    where: { isActive: true },
    select: { word: true, gestureType: true },
  });
  const byWord = new Map<string, Set<string>>();
  for (const row of rows) {
    const types = byWord.get(row.word) ?? new Set<string>();
    types.add(normalize(row.gestureType));
    byWord.set(row.word, types);
  }
  const conflicts = [...byWord.entries()].filter(([, types]) => types.size > 1);
  if (conflicts.length === 0) {
    console.log("\nNo words have conflicting static/dynamic recordings.");
  } else {
    console.log(
      `\nWARNING: ${conflicts.length} word(s) have BOTH static and dynamic active recordings — needs manual review, not auto-fixed:`,
    );
    for (const [word] of conflicts) {
      console.log(`  "${word}"`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("normalizeGestureTypes failed:", err);
  process.exit(1);
});

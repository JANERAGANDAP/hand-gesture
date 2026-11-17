// Read-only diagnostic: DELETE /api/gestures/by-word/:word soft-deletes
// (isActive: false) rather than removing rows, and never touches the
// associated hand-crop image in object storage — so every word deleted
// or re-recorded over the project's history is still sitting in the
// table and, if it had a hand-shape crop, still sitting in the
// hand-crops bucket too. This script only reads and reports; it makes
// no writes to the DB and no changes to storage.
//
// Run with: npx ts-node --transpile-only src/scripts/auditInactiveGestures.ts
// (--transpile-only avoids a false "Cannot find name 'process'" type-check
// error that shows up when ts-node full-type-checks a file that lives
// under src/scripts/, which tsconfig.json excludes from the main project)
/// <reference types="node" />
import prisma from "../config/prisma";
import { PRIVATE_BUCKET, listObjectSizes, toHandCropKey } from "../config/storage";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

async function main() {
  const [totalCount, activeCount, inactiveCount] = await Promise.all([
    prisma.signGesture.count(),
    prisma.signGesture.count({ where: { isActive: true } }),
    prisma.signGesture.count({ where: { isActive: false } }),
  ]);

  console.log(`Total SignGesture rows:    ${totalCount}`);
  console.log(`Active (isActive: true):  ${activeCount}`);
  console.log(`Inactive (soft-deleted):  ${inactiveCount}`);

  if (inactiveCount === 0) {
    console.log("\nNo soft-deleted rows found. Nothing to report.");
    await prisma.$disconnect();
    return;
  }

  const inactiveRows = await prisma.signGesture.findMany({
    where: { isActive: false },
    select: { word: true, handCropUrl: true, createdAt: true },
  });

  // Breakdown by word, so it's clear whether this is a few words with many
  // dead retakes or many words tried once and abandoned.
  const byWord = new Map<string, number>();
  for (const row of inactiveRows) {
    byWord.set(row.word, (byWord.get(row.word) ?? 0) + 1);
  }
  const sortedWords = [...byWord.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`\nInactive rows span ${byWord.size} distinct word(s). Top 15 by count:`);
  for (const [word, count] of sortedWords.slice(0, 15)) {
    console.log(`  ${word.padEnd(20)} ${count}`);
  }
  if (sortedWords.length > 15) {
    console.log(`  ...and ${sortedWords.length - 15} more word(s).`);
  }

  const inactiveWithCrop = inactiveRows.filter((r) => r.handCropUrl);
  console.log(
    `\nInactive rows with a hand-crop image: ${inactiveWithCrop.length} of ${inactiveRows.length}`,
  );

  if (inactiveWithCrop.length === 0) {
    console.log("No orphaned crops to size up.");
    await prisma.$disconnect();
    return;
  }

  console.log(`Listing ${PRIVATE_BUCKET} bucket contents to estimate orphaned storage...`);
  const bucketSizes = await listObjectSizes(PRIVATE_BUCKET);

  let orphanedBytes = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;
  for (const row of inactiveWithCrop) {
    const objectPath = row.handCropUrl ? toHandCropKey(row.handCropUrl) : null;
    if (!objectPath) {
      unmatchedCount += 1;
      continue;
    }
    const size = bucketSizes.get(objectPath);
    if (size === undefined) {
      // Object no longer in the bucket (already removed by other means) —
      // not counted, since it isn't actually costing storage anymore.
      continue;
    }
    orphanedBytes += size;
    matchedCount += 1;
  }

  console.log(`\nOrphaned crop images still in storage: ${matchedCount}`);
  console.log(`Estimated storage they're using: ${formatBytes(orphanedBytes)}`);
  if (unmatchedCount > 0) {
    console.log(
      `(${unmatchedCount} inactive row(s) had a handCropUrl that didn't parse as a ${PRIVATE_BUCKET} object path — skipped, not counted above.)`,
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("auditInactiveGestures failed:", err);
  process.exit(1);
});
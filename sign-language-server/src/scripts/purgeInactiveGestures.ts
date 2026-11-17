// Hard-deletes every soft-deleted (isActive: false) SignGesture row, plus
// any hand-crop image still sitting in storage for those rows. This is
// the destructive follow-up to auditInactiveGestures.ts — run that one
// first and review the numbers before running this.
//
// IRREVERSIBLE: once run with --confirm, these rows and images are gone.
// Only touches isActive: false rows — active gestures (and therefore
// recognition, stats, and CNN training data) are completely unaffected,
// so there's no need to restart the live server after running this.
//
// Defaults to a DRY RUN: prints exactly what would be deleted and does
// not touch the DB or storage. Pass --confirm to actually delete.
//
// Run with: npx ts-node --transpile-only src/scripts/purgeInactiveGestures.ts
//           npx ts-node --transpile-only src/scripts/purgeInactiveGestures.ts --confirm
/// <reference types="node" />
import prisma from "../config/prisma";
import { PRIVATE_BUCKET, deleteObjects, toHandCropKey } from "../config/storage";

async function main() {
  const confirm = process.argv.includes("--confirm");

  const inactiveRows = await prisma.signGesture.findMany({
    where: { isActive: false },
    select: { id: true, word: true, handCropUrl: true },
  });

  if (inactiveRows.length === 0) {
    console.log("No inactive rows found. Nothing to purge.");
    await prisma.$disconnect();
    return;
  }

  const objectPaths = inactiveRows
    .map((r) => (r.handCropUrl ? toHandCropKey(r.handCropUrl) : null))
    .filter((p): p is string => p !== null);

  console.log(`Found ${inactiveRows.length} inactive row(s) to delete.`);
  console.log(`${objectPaths.length} of them have a hand-crop image to remove from storage.`);

  if (!confirm) {
    console.log(
      "\nDRY RUN — nothing was deleted. Re-run with --confirm to actually purge these rows and images.",
    );
    await prisma.$disconnect();
    return;
  }

  console.log("\n--confirm passed. Purging...");

  if (objectPaths.length > 0) {
    const { removed, failed } = await deleteObjects(PRIVATE_BUCKET, objectPaths);
    console.log(`Storage: removed ${removed} image(s), ${failed} failed.`);
    if (failed > 0) {
      console.log(
        "  (Failed removals are logged above but do not block the DB delete below — " +
          "the DB row is still gone even if its old image lingers in storage.)",
      );
    }
  }

  const result = await prisma.signGesture.deleteMany({
    where: { isActive: false },
  });
  console.log(`Database: deleted ${result.count} row(s).`);

  console.log("\nDone.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("purgeInactiveGestures failed:", err);
  process.exit(1);
});
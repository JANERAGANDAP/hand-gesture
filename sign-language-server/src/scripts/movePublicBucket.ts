// sign-language-server/src/scripts/movePublicBucket.ts
// Purpose: the original "assets" bucket was created private and its access
// level can't be changed afterwards. This copies every object from it into
// the public bucket (STORAGE_PUBLIC_BUCKET, e.g. "public-assets") and
// repoints SpeechSign.file URLs at the new bucket. Nothing is deleted.
//
// Defaults to a DRY RUN (reports only). Run:
//   npx ts-node --transpile-only src/scripts/movePublicBucket.ts
//   npx ts-node --transpile-only src/scripts/movePublicBucket.ts --confirm
// Optional: --from=<source bucket>   (default: assets)
/// <reference types="node" />
import "dotenv/config";
import path from "node:path";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import prisma from "../config/prisma";
import {
  PUBLIC_BUCKET,
  getS3Client,
  putObject,
  listObjectSizes,
  publicObjectUrl,
  keyFromUrl,
} from "../config/storage";

const DEFAULT_SOURCE_BUCKET = "assets";

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

// Picks a Content-Type from the file extension (safe default: binary).
function guessContentType(fileName: string): string {
  return CONTENT_TYPES[path.extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

// Downloads one object fully into memory (files are <= 25MB by upload rules).
async function downloadObject(bucket: string, key: string): Promise<Buffer> {
  const response = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) throw new Error(`Empty body for ${bucket}/${key}`);
  return Buffer.from(await response.Body.transformToByteArray());
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const fromArg = process.argv.find((a) => a.startsWith("--from="));
  const sourceBucket = fromArg ? fromArg.slice(7) : DEFAULT_SOURCE_BUCKET;

  // Guard: copying a bucket onto itself would do nothing useful.
  if (sourceBucket === PUBLIC_BUCKET) {
    throw new Error(
      `Source and destination are both "${PUBLIC_BUCKET}". ` +
        `Set STORAGE_PUBLIC_BUCKET=public-assets in .env first.`,
    );
  }

  const sourceKeys = await listObjectSizes(sourceBucket);
  const rows = await prisma.speechSign.findMany({ select: { id: true, file: true } });
  const rowsToRepoint: { id: number; key: string }[] = [];
  const skippedRows: string[] = [];
  for (const row of rows) {
    const key = keyFromUrl(row.file, sourceBucket);
    if (key === null || !sourceKeys.has(key)) skippedRows.push(`id ${row.id}: ${row.file}`);
    else rowsToRepoint.push({ id: row.id, key });
  }

  console.log(`Source "${sourceBucket}": ${sourceKeys.size} object(s). Destination: "${PUBLIC_BUCKET}".`);
  console.log(`SpeechSign rows: ${rows.length} total, ${rowsToRepoint.length} to repoint, ${skippedRows.length} skipped.`);
  skippedRows.forEach((line) => console.log(`  skipped ${line}`));

  if (!confirm) {
    console.log("\nDRY RUN — nothing copied or changed. Re-run with --confirm to migrate.");
    await prisma.$disconnect();
    return;
  }

  // Copy every object, then verify against the destination bucket itself.
  const copyFailures: string[] = [];
  for (const key of sourceKeys.keys()) {
    try {
      const body = await downloadObject(sourceBucket, key);
      await putObject(PUBLIC_BUCKET, key, body, guessContentType(key));
    } catch (err) {
      console.error(`  FAILED copy ${key}:`, err);
      copyFailures.push(key);
    }
  }
  const destKeys = await listObjectSizes(PUBLIC_BUCKET);
  console.log(`\nVerified: "${PUBLIC_BUCKET}" has ${destKeys.size} object(s).`);

  let updated = 0;
  const notVerified: number[] = [];
  for (const item of rowsToRepoint) {
    if (!destKeys.has(item.key)) {
      notVerified.push(item.id);
      continue;
    }
    await prisma.speechSign.update({
      where: { id: item.id },
      data: { file: publicObjectUrl(PUBLIC_BUCKET, item.key) },
    });
    updated += 1;
  }

  console.log(`SpeechSign rows updated: ${updated}`);
  console.log(`Copy failures: ${copyFailures.length}, not verified (left unchanged): ${notVerified.length}`);
  notVerified.forEach((id) => console.log(`  id ${id} not found in destination after copy`));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("movePublicBucket failed:", err);
  process.exit(1);
});
// sign-language-server/src/scripts/migrateStorageToNeon.ts
// Purpose: one-time move of Supabase Storage files (already downloaded to
// ../supabase-files) into Neon Object Storage, then rewrite the URLs stored
// in the database so they point at the new location.
//
// Defaults to a DRY RUN (reports only, changes nothing).
// Run:  npx ts-node --transpile-only src/scripts/migrateStorageToNeon.ts
//       npx ts-node --transpile-only src/scripts/migrateStorageToNeon.ts --confirm
// Optional: --dir=<path to supabase-files>   (default: ../supabase-files)
/// <reference types="node" />
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import prisma from "../config/prisma";
import {
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  SIGNS_PREFIX,
  putObject,
  listObjectSizes,
  publicObjectUrl,
  keyFromUrl,
  toHandCropKey,
} from "../config/storage";

// Old Supabase bucket names = folder names produced by the download script.
const OLD_SIGNS_BUCKET = "signs";
const OLD_HAND_CROPS_BUCKET = "hand-crops";

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

// Returns every file under a folder as paths relative to it ("/" separated).
async function listLocalFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listLocalFiles(root, rel)));
    else files.push(rel);
  }
  return files;
}

// Uploads every local file to bucket/prefix+relativePath; returns failures.
async function uploadFolder(
  localRoot: string,
  bucket: string,
  prefix: string,
  files: string[],
): Promise<string[]> {
  const failures: string[] = [];
  for (const rel of files) {
    try {
      const body = await readFile(path.join(localRoot, rel));
      await putObject(bucket, `${prefix}${rel}`, body, guessContentType(rel));
    } catch (err) {
      console.error(`  FAILED ${bucket}/${prefix}${rel}:`, err);
      failures.push(rel);
    }
  }
  return failures;
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const dirArg = process.argv.find((a) => a.startsWith("--dir="));
  const backupDir = path.resolve(dirArg ? dirArg.slice(6) : "../supabase-files");
  const signsDir = path.join(backupDir, OLD_SIGNS_BUCKET);
  const cropsDir = path.join(backupDir, OLD_HAND_CROPS_BUCKET);

  const signFiles = await listLocalFiles(signsDir);
  const cropFiles = await listLocalFiles(cropsDir);
  console.log(`Local backup: ${signFiles.length} sign file(s), ${cropFiles.length} hand-crop file(s).`);

  const speechSigns = await prisma.signAsset.findMany({ select: { id: true, file: true } });
  const gestures = await prisma.signGesture.findMany({
    where: { handCropUrl: { not: null } },
    select: { id: true, handCropUrl: true },
  });
  console.log(`Database: ${speechSigns.length} SpeechSign row(s), ${gestures.length} gesture(s) with a hand-crop.`);

  if (!confirm) {
    console.log("\nDRY RUN — nothing uploaded or changed. Re-run with --confirm to migrate.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nUploading signs ->", `${PUBLIC_BUCKET}/${SIGNS_PREFIX}`);
  const signFailures = await uploadFolder(signsDir, PUBLIC_BUCKET, SIGNS_PREFIX, signFiles);
  console.log("Uploading hand-crops ->", PRIVATE_BUCKET);
  const cropFailures = await uploadFolder(cropsDir, PRIVATE_BUCKET, "", cropFiles);

  // Verify against the bucket itself, not our own upload loop.
  const publicKeys = await listObjectSizes(PUBLIC_BUCKET);
  const privateKeys = await listObjectSizes(PRIVATE_BUCKET);
  console.log(`Verified in Neon: ${PUBLIC_BUCKET} has ${publicKeys.size} object(s), ${PRIVATE_BUCKET} has ${privateKeys.size}.`);

  // Rewrite DB values only when the target object really exists in Neon.
  let signsUpdated = 0;
  const signsSkipped: string[] = [];
  for (const row of speechSigns) {
    const oldKey = keyFromUrl(row.file, OLD_SIGNS_BUCKET);
    if (oldKey === null || !publicKeys.has(`${SIGNS_PREFIX}${oldKey}`)) {
      signsSkipped.push(`id ${row.id}: ${row.file}`);
      continue;
    }
    await prisma.signAsset.update({
      where: { id: row.id },
      data: { file: publicObjectUrl(PUBLIC_BUCKET, `${SIGNS_PREFIX}${oldKey}`) },
    });
    signsUpdated += 1;
  }

  let cropsUpdated = 0;
  const cropsSkipped: string[] = [];
  for (const row of gestures) {
    const key = toHandCropKey(row.handCropUrl);
    if (key === null || !privateKeys.has(key)) {
      cropsSkipped.push(`id ${row.id}: ${row.handCropUrl}`);
      continue;
    }
    if (key !== row.handCropUrl) {
      await prisma.signGesture.update({ where: { id: row.id }, data: { handCropUrl: key } });
      cropsUpdated += 1;
    }
  }

  console.log(`\nSpeechSign rows updated: ${signsUpdated}, skipped: ${signsSkipped.length}`);
  signsSkipped.forEach((line) => console.log(`  skipped ${line}`));
  console.log(`Gesture hand-crop rows updated: ${cropsUpdated}, skipped: ${cropsSkipped.length}`);
  cropsSkipped.forEach((line) => console.log(`  skipped ${line}`));
  console.log(`Upload failures: signs ${signFailures.length}, hand-crops ${cropFailures.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("migrateStorageToNeon failed:", err);
  process.exit(1);
});
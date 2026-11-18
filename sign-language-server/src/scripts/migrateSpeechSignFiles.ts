// sign-language-server/src/scripts/migrateSpeechSignFiles.ts
// Purpose: SpeechSign.file URLs point at whichever Supabase bucket the old
// SUPABASE_BUCKET setting named (in this project: "hand-crops"). This copies
// each referenced file from the local backup into the PUBLIC Neon bucket
// (assets/signs/) and rewrites the row's URL. Rows already on Neon are skipped.
//
// Defaults to a DRY RUN (reports only). Run:
//   npx ts-node --transpile-only src/scripts/migrateSpeechSignFiles.ts
//   npx ts-node --transpile-only src/scripts/migrateSpeechSignFiles.ts --confirm
// Optional: --dir=<path to supabase-files>   (default: ../supabase-files)
/// <reference types="node" />
import "dotenv/config";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import prisma from "../config/prisma";
import {
  PUBLIC_BUCKET,
  SIGNS_PREFIX,
  putObject,
  listObjectSizes,
  publicObjectUrl,
} from "../config/storage";
import { parseSupabaseUrl } from "../utils/supabaseUrl";

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

// True when the file exists on disk.
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const dirArg = process.argv.find((a) => a.startsWith("--dir="));
  const backupDir = path.resolve(dirArg ? dirArg.slice(6) : "../supabase-files");

  const rows = await prisma.signAsset.findMany({ select: { id: true, file: true } });
  const ready: { id: number; key: string; localPath: string }[] = [];
  const notSupabase: string[] = [];
  const missingLocally: string[] = [];

  for (const row of rows) {
    const parsed = parseSupabaseUrl(row.file);
    if (!parsed) {
      notSupabase.push(`id ${row.id}: ${row.file}`);
      continue;
    }
    const localPath = path.join(backupDir, parsed.bucket, parsed.key);
    if (!(await fileExists(localPath))) {
      missingLocally.push(`id ${row.id}: ${parsed.bucket}/${parsed.key}`);
      continue;
    }
    ready.push({ id: row.id, key: parsed.key, localPath });
  }

  console.log(`SpeechSign rows: ${rows.length}`);
  console.log(`  ready to migrate:        ${ready.length}`);
  console.log(`  not a Supabase URL:      ${notSupabase.length} (left unchanged)`);
  console.log(`  missing in local backup: ${missingLocally.length} (left unchanged)`);
  notSupabase.forEach((line) => console.log(`    ${line}`));
  missingLocally.forEach((line) => console.log(`    ${line}`));

  if (!confirm) {
    console.log("\nDRY RUN — nothing uploaded or changed. Re-run with --confirm to migrate.");
    await prisma.$disconnect();
    return;
  }

  // Upload first, then verify against the bucket itself before touching the DB.
  const uploadFailures: number[] = [];
  for (const item of ready) {
    try {
      const body = await readFile(item.localPath);
      await putObject(PUBLIC_BUCKET, `${SIGNS_PREFIX}${item.key}`, body, guessContentType(item.key));
    } catch (err) {
      console.error(`  FAILED upload for id ${item.id}:`, err);
      uploadFailures.push(item.id);
    }
  }

  const publicKeys = await listObjectSizes(PUBLIC_BUCKET);
  console.log(`\nVerified in Neon: ${PUBLIC_BUCKET} has ${publicKeys.size} object(s).`);

  let updated = 0;
  const notVerified: number[] = [];
  for (const item of ready) {
    const fullKey = `${SIGNS_PREFIX}${item.key}`;
    if (!publicKeys.has(fullKey)) {
      notVerified.push(item.id);
      continue;
    }
    await prisma.signAsset.update({
      where: { id: item.id },
      data: { file: publicObjectUrl(PUBLIC_BUCKET, fullKey) },
    });
    updated += 1;
  }

  console.log(`SpeechSign rows updated: ${updated}`);
  console.log(`Upload failures: ${uploadFailures.length}, not verified (left unchanged): ${notVerified.length}`);
  notVerified.forEach((id) => console.log(`  id ${id} not found in bucket after upload`));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("migrateSpeechSignFiles failed:", err);
  process.exit(1);
});
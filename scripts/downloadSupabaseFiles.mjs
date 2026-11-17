// scripts/downloadSupabaseFiles.mjs
// Purpose: back up every file from all Supabase Storage buckets to ./supabase-files
// so they can be re-uploaded to Neon object storage.
import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // keep server-side only, never commit
);

const OUTPUT_DIR = "supabase-files";

// Recursively list files in a bucket folder (folders have id === null)
async function listAllFiles(bucket, prefix = "") {
  const files = [];
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (error) throw error;

  for (const item of data) {
    const itemPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) files.push(...(await listAllFiles(bucket, itemPath)));
    else files.push(itemPath);
  }
  return files;
}

async function main() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;

  for (const bucket of buckets) {
    const files = await listAllFiles(bucket.name);
    console.log(`${bucket.name}: ${files.length} files`);

    for (const filePath of files) {
      const { data: blob, error: dlError } = await supabase.storage
        .from(bucket.name)
        .download(filePath);
      if (dlError) {
        console.error(`FAILED ${bucket.name}/${filePath}:`, dlError.message);
        continue;
      }
      const target = path.join(OUTPUT_DIR, bucket.name, filePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(await blob.arrayBuffer()));
    }
  }
  console.log("Done.");
}

main();
// sign-language-server/src/config/storage.ts
// Local filesystem storage for development (no S3/R2 required).

import fs from "fs";
import path from "path";

export const PUBLIC_BUCKET = process.env.STORAGE_PUBLIC_BUCKET || "public-assets";
export const PRIVATE_BUCKET = process.env.STORAGE_PRIVATE_BUCKET || "hand-crops";
export const SIGNS_PREFIX = "signs/";
export const SIGNED_URL_TTL_SECONDS = 3600;

// Local storage directory — files served from /public by the server
const UPLOAD_DIR = path.resolve(process.cwd(), "public");

function bucketDir(bucket: string): string {
  return path.join(UPLOAD_DIR, bucket);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Upload a file to local storage
export async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  _contentType: string,
): Promise<void> {
  const dir = path.join(bucketDir(bucket), path.dirname(key));
  ensureDir(dir);
  fs.writeFileSync(path.join(bucketDir(bucket), key), body);
}

// Delete files from local storage
export async function deleteObjects(
  bucket: string,
  keys: string[],
): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (const key of keys) {
    try {
      const filePath = path.join(bucketDir(bucket), key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      removed += 1;
    } catch (err) {
      console.error(`Storage delete failed for ${bucket}/${key}:`, err);
      failed += 1;
    }
  }
  return { removed, failed };
}

// List objects
export async function listObjectSizes(bucket: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  const dir = bucketDir(bucket);
  if (!fs.existsSync(dir)) return sizes;

  function walk(currentDir: string, prefix: string) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, key);
      } else {
        sizes.set(key, fs.statSync(fullPath).size);
      }
    }
  }
  walk(dir, "");
  return sizes;
}

// Build a public URL for a stored file
export function publicObjectUrl(_bucket: string, key: string): string {
  // Served from http://localhost:3001/public/<key>
  return `/public/${key}`;
}

// Extract key from URL
export function keyFromUrl(url: string, _bucket: string): string | null {
  if (!url) return null;
  if (url.startsWith("/public/")) return url.slice("/public/".length);
  return null;
}

export function toHandCropKey(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const fromUrl = keyFromUrl(stored, PRIVATE_BUCKET);
  if (fromUrl !== null) return fromUrl;
  return /^https?:\/\//i.test(stored) ? null : stored;
}

// For local dev: just return the relative URL directly (no presigning needed)
export async function signHandCropUrl(
  stored: string | null | undefined,
): Promise<string | null> {
  const key = toHandCropKey(stored);
  if (!key) return null;
  return `/public/${PRIVATE_BUCKET}/${key}`;
}

// No S3Client needed for local storage
export function getS3Client(): never {
  throw new Error("S3Client not available in local storage mode");
}

// sign-language-server/src/config/storage.ts
// Local filesystem storage for development (no S3/R2 required).

import fs from "fs";
import path from "path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const PUBLIC_BUCKET = process.env.STORAGE_PUBLIC_BUCKET || "public-assets";
export const PRIVATE_BUCKET = process.env.STORAGE_PRIVATE_BUCKET || "hand-crops";
export const SIGNS_PREFIX = "signs/";
export const SIGNED_URL_TTL_SECONDS = 3600;
let s3Client: S3Client | null = null;

function hasS3Configuration(): boolean {
  return Boolean(
    process.env.AWS_ENDPOINT_URL_S3 ||
      process.env.AWS_ACCESS_KEY_ID ||
      process.env.AWS_SECRET_ACCESS_KEY,
  );
}

export function usesObjectStorage(): boolean {
  return process.env.VERCEL === "1" || hasS3Configuration();
}

function requiredS3Setting(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required object storage setting: ${name}`);
  }
  return value;
}

export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: requiredS3Setting("AWS_ENDPOINT_URL_S3"),
      region: requiredS3Setting("AWS_REGION"),
      forcePathStyle: true,
      credentials: {
        accessKeyId: requiredS3Setting("AWS_ACCESS_KEY_ID"),
        secretAccessKey: requiredS3Setting("AWS_SECRET_ACCESS_KEY"),
      },
    });
  }
  return s3Client;
}

// Local storage directory — files served from /public by the server.
export const UPLOAD_DIR = path.resolve(
  process.env.UPLOAD_DIR || path.join(process.cwd(), "public"),
);

function bucketDir(bucket: string): string {
  return path.join(UPLOAD_DIR, bucket);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Upload to object storage when configured, otherwise use local storage.
export async function putObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (usesObjectStorage()) {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl:
          bucket === PUBLIC_BUCKET
            ? "public, max-age=31536000, immutable"
            : "private, no-store",
      }),
    );
    return;
  }

  const dir = path.join(bucketDir(bucket), path.dirname(key));
  ensureDir(dir);
  fs.writeFileSync(path.join(bucketDir(bucket), key), body);
}

export async function getObject(
  bucket: string,
  key: string,
): Promise<Buffer> {
  if (usesObjectStorage()) {
    const result = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (!result.Body) throw new Error(`Object not found: ${bucket}/${key}`);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  return fs.readFileSync(path.join(bucketDir(bucket), key));
}

// Delete files from object or local storage.
export async function deleteObjects(
  bucket: string,
  keys: string[],
): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (const key of keys) {
    try {
      if (usesObjectStorage()) {
        await getS3Client().send(
          new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        );
        removed += 1;
        continue;
      }

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

// List objects from object or local storage.
export async function listObjectSizes(bucket: string): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  if (usesObjectStorage()) {
    let continuationToken: string | undefined;
    do {
      const result = await getS3Client().send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of result.Contents ?? []) {
        if (object.Key && object.Size !== undefined) {
          sizes.set(object.Key, object.Size);
        }
      }
      continuationToken = result.NextContinuationToken;
    } while (continuationToken);
    return sizes;
  }

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
export function publicObjectUrl(bucket: string, key: string): string {
  const publicAssetsBaseUrl =
    bucket === PUBLIC_BUCKET
      ? (
      process.env.PUBLIC_ASSETS_BASE_URL ||
      (usesObjectStorage()
        ? `${requiredS3Setting("AWS_ENDPOINT_URL_S3")}/${bucket}`
        : "")
        ).replace(/\/+$/, "")
      : undefined;
  return publicAssetsBaseUrl
    ? `${publicAssetsBaseUrl}/${key}`
    : `/public/${bucket}/${key}`;
}

// Extract key from URL
export function keyFromUrl(url: string, bucket: string): string | null {
  if (!url) return null;

  const cleanUrl = url.split(/[?#]/, 1)[0];
  const publicAssetsBaseUrl =
    bucket === PUBLIC_BUCKET
      ? process.env.PUBLIC_ASSETS_BASE_URL?.replace(/\/+$/, "")
      : undefined;

  if (publicAssetsBaseUrl && cleanUrl.startsWith(`${publicAssetsBaseUrl}/`)) {
    return cleanUrl.slice(publicAssetsBaseUrl.length + 1);
  }

  const s3Endpoint = process.env.AWS_ENDPOINT_URL_S3?.replace(/\/+$/, "");
  const s3BucketPrefix = s3Endpoint ? `${s3Endpoint}/${bucket}/` : null;
  if (s3BucketPrefix && cleanUrl.startsWith(s3BucketPrefix)) {
    return cleanUrl.slice(s3BucketPrefix.length);
  }

  if (cleanUrl.startsWith("/public/")) {
    const localPath = cleanUrl.slice("/public/".length);
    const bucketPrefix = `${bucket}/`;
    return localPath.startsWith(bucketPrefix)
      ? localPath.slice(bucketPrefix.length)
      : localPath;
  }

  const supabasePrefix = `/storage/v1/object/public/${bucket}/`;
  const supabaseIndex = cleanUrl.indexOf(supabasePrefix);
  if (supabaseIndex !== -1) {
    return cleanUrl.slice(supabaseIndex + supabasePrefix.length);
  }

  const neonPrefix = `/${bucket}/`;
  const neonIndex = cleanUrl.indexOf(neonPrefix);
  if (cleanUrl.includes(".storage.neon.tech/") && neonIndex !== -1) {
    return cleanUrl.slice(neonIndex + neonPrefix.length);
  }

  return null;
}

export function toHandCropKey(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const fromUrl = keyFromUrl(stored, PRIVATE_BUCKET);
  if (fromUrl !== null) return fromUrl;
  return /^https?:\/\//i.test(stored) ? null : stored;
}

// Private object storage URLs are short-lived; local paths are returned in development.
export async function signHandCropUrl(
  stored: string | null | undefined,
): Promise<string | null> {
  const key = toHandCropKey(stored);
  if (!key) return null;
  if (usesObjectStorage()) {
    return getSignedUrl(
      getS3Client(),
      new GetObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  }
  return `/public/${PRIVATE_BUCKET}/${key}`;
}

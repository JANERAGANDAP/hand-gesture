
// sign-language-server/src/config/storage.test.ts
// Purpose: tests R2 public URL handling and legacy storage compatibility.

import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  keyFromUrl,
  toHandCropKey,
  publicObjectUrl,
} from "./storage";

const workerBaseUrl = "https://fsl-public-assets.judeburnea20.workers.dev";

test("publicObjectUrl builds a Cloudflare Worker URL for public assets", () => {
  process.env.PUBLIC_ASSETS_BASE_URL = `${workerBaseUrl}/`;

  assert.equal(
    publicObjectUrl(PUBLIC_BUCKET, "signs/1.mp4"),
    `${workerBaseUrl}/signs/1.mp4`,
  );
});

test("publicObjectUrl builds a bucket-prefixed local URL without a CDN base", () => {
  delete process.env.PUBLIC_ASSETS_BASE_URL;

  assert.equal(
    publicObjectUrl(PUBLIC_BUCKET, "signs/1.mp4"),
    `/public/${PUBLIC_BUCKET}/signs/1.mp4`,
  );
});

test("local public URLs resolve to keys without the bucket prefix", () => {
  delete process.env.PUBLIC_ASSETS_BASE_URL;

  assert.equal(
    keyFromUrl(`/public/${PUBLIC_BUCKET}/signs/1.mp4`, PUBLIC_BUCKET),
    "signs/1.mp4",
  );
  assert.equal(
    keyFromUrl("/public/hand-crops/abc.jpg", PRIVATE_BUCKET),
    "abc.jpg",
  );
  assert.equal(
    keyFromUrl("/public/signs/legacy.mp4", PUBLIC_BUCKET),
    "signs/legacy.mp4",
  );
});

test("keyFromUrl extracts a sign key from the configured Worker URL", () => {
  process.env.PUBLIC_ASSETS_BASE_URL = workerBaseUrl;

  assert.equal(
    keyFromUrl(`${workerBaseUrl}/signs/123.mp4`, PUBLIC_BUCKET),
    "signs/123.mp4",
  );
});

test("keyFromUrl extracts keys from the configured S3 endpoint", () => {
  const previousEndpoint = process.env.AWS_ENDPOINT_URL_S3;
  const previousPublicBaseUrl = process.env.PUBLIC_ASSETS_BASE_URL;
  process.env.AWS_ENDPOINT_URL_S3 = "https://objects.example.test";
  delete process.env.PUBLIC_ASSETS_BASE_URL;

  try {
    assert.equal(
      keyFromUrl(
        `https://objects.example.test/${PUBLIC_BUCKET}/signs/123.png?download=1`,
        PUBLIC_BUCKET,
      ),
      "signs/123.png",
    );
  } finally {
    if (previousEndpoint === undefined) {
      delete process.env.AWS_ENDPOINT_URL_S3;
    } else {
      process.env.AWS_ENDPOINT_URL_S3 = previousEndpoint;
    }
    if (previousPublicBaseUrl === undefined) {
      delete process.env.PUBLIC_ASSETS_BASE_URL;
    } else {
      process.env.PUBLIC_ASSETS_BASE_URL = previousPublicBaseUrl;
    }
  }
});

test("keyFromUrl rejects an unrelated Worker URL", () => {
  process.env.PUBLIC_ASSETS_BASE_URL = workerBaseUrl;

  assert.equal(
    keyFromUrl("https://unknown.workers.dev/signs/123.mp4", PUBLIC_BUCKET),
    null,
  );
});

test("keyFromUrl extracts keys from legacy Supabase public URLs", () => {
  const url =
    "https://x.supabase.co/storage/v1/object/public/signs/123.mp4";

  assert.equal(keyFromUrl(url, "signs"), "123.mp4");
});

test("keyFromUrl returns null when the bucket is absent", () => {
  assert.equal(
    keyFromUrl("https://other.host/file.mp4", PUBLIC_BUCKET),
    null,
  );
});

test("keyFromUrl removes query strings and fragments", () => {
  process.env.PUBLIC_ASSETS_BASE_URL = workerBaseUrl;

  assert.equal(
    keyFromUrl(
      `${workerBaseUrl}/signs/123.mp4?version=1#preview`,
      PUBLIC_BUCKET,
    ),
    "signs/123.mp4",
  );
});

test("toHandCropKey accepts bare keys, legacy Supabase URLs and Neon URLs", () => {
  assert.equal(toHandCropKey("abc.jpg"), "abc.jpg");

  assert.equal(
    toHandCropKey(
      "https://x.supabase.co/storage/v1/object/public/hand-crops/abc.jpg",
    ),
    "abc.jpg",
  );

  assert.equal(
    toHandCropKey("https://b.storage.neon.tech/hand-crops/abc.jpg"),
    "abc.jpg",
  );
});

test("toHandCropKey rejects empty and foreign URLs", () => {
  assert.equal(toHandCropKey(null), null);
  assert.equal(toHandCropKey(undefined), null);
  assert.equal(toHandCropKey(""), null);
  assert.equal(toHandCropKey("https://unknown.host/pic.jpg"), null);
});

test("private hand-crop URLs extract keys using the configured bucket", () => {
  assert.equal(
    keyFromUrl(
      "https://b.storage.neon.tech/hand-crops/abc.jpg",
      PRIVATE_BUCKET,
    ),
    "abc.jpg",
  );
});

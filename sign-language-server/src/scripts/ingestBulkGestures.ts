import fs from "fs";
import path from "path";
import prisma from "../config/prisma";
import {
  extractFeatures,
  GestureFeatures,
} from "../utils/featureExtractor.shared";
import { syncGestureRegistry } from "../utils/gestureRegistry";
const RAW_LANDMARKS_DIR = path.join(process.cwd(), "raw_landmarks");
interface RawLandmarkFile {
  word: string;
  sourceVideo: string;
  frameCount: number;
  frames: RawFrame[];
}
interface RawFrame {
  pose:
    | {
        x: number;
        y: number;
      }[]
    | null;
  leftHand:
    | {
        x: number;
        y: number;
      }[]
    | null;
  rightHand:
    | {
        x: number;
        y: number;
      }[]
    | null;
}
function buildSourceDescription(sourceVideo: string): string {
  return `Bulk-imported from video: ${sourceVideo}`;
}
function averageFeatureFrames(frames: GestureFeatures[]): any {
  if (!frames.length) return {};
  const result: any = {
    ...frames[0],
  };
  const keys = Object.keys(frames[0]);
  for (const key of keys) {
    const vals = (frames as any[]).map((f) => f[key]);
    if (typeof vals[0] === "number") {
      result[key] =
        vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
    } else if (typeof vals[0] === "boolean") {
      const trueCount = vals.filter(Boolean).length;
      result[key] = trueCount > vals.length / 2;
    } else if (Array.isArray(vals[0])) {
      result[key] = vals[0].map((_: any, i: number) => {
        const elements = vals.map((v) => v[i]);
        if (typeof elements[0] === "boolean") {
          return elements.filter(Boolean).length > vals.length / 2;
        }
        return (
          elements.reduce((a: number, b: number) => a + b, 0) / vals.length
        );
      });
    }
  }
  return result;
}
function processFrame(frame: RawFrame): GestureFeatures | null {
  return extractFeatures(
    frame.pose ?? [],
    frame.leftHand ?? [],
    frame.rightHand ?? [],
  );
}
async function alreadyIngested(sourceVideo: string): Promise<boolean> {
  const existing = await prisma.signGesture.findFirst({
    where: {
      description: buildSourceDescription(sourceVideo),
    },
    select: {
      id: true,
    },
  });
  return existing !== null;
}
async function ingestGestureFile(filePath: string) {
  const raw: RawLandmarkFile = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  if (await alreadyIngested(raw.sourceVideo)) {
    console.log(
      `Skipping "${raw.word}" (${raw.sourceVideo}): already ingested.\n`,
    );
    return {
      word: raw.word,
      status: "duplicate" as const,
    };
  }
  console.log(`Ingesting "${raw.word}" (${raw.frames.length} raw frames)...`);
  const sequence: GestureFeatures[] = [];
  for (const frame of raw.frames) {
    const features = processFrame(frame);
    if (features) {
      sequence.push(features);
    }
  }
  if (sequence.length === 0) {
    console.warn(
      `  Skipped "${raw.word}": no usable frames after feature extraction.\n`,
    );
    return {
      word: raw.word,
      status: "skipped" as const,
    };
  }
  const aggregatedFeatures = averageFeatureFrames(sequence);
  await prisma.$transaction(async (tx) => {
    const registryEntry = await syncGestureRegistry(tx, {
      word: raw.word,
      language: "FSL",
    });
    await tx.signGesture.create({
      data: {
        word: raw.word,
        language: "FSL",
        gestureType: "dynamic",
        features: aggregatedFeatures,
        sequence: sequence as any,
        frameCount: sequence.length,
        description: buildSourceDescription(raw.sourceVideo),
        gestureId: registryEntry.id,
      },
    });
  });
  console.log(`  Saved "${raw.word}" with ${sequence.length} usable frames.\n`);
  return {
    word: raw.word,
    status: "saved" as const,
  };
}
async function main() {
  if (!fs.existsSync(RAW_LANDMARKS_DIR)) {
    console.error(`Directory not found: ${RAW_LANDMARKS_DIR}`);
    console.error(`Run extract_landmarks.py first.`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(RAW_LANDMARKS_DIR)
    .filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log(`No JSON files found in ${RAW_LANDMARKS_DIR}`);
    return;
  }
  console.log(`Found ${files.length} gesture file(s) to check.\n`);
  const results = {
    saved: 0,
    skipped: 0,
    duplicate: 0,
  };
  for (const file of files) {
    const filePath = path.join(RAW_LANDMARKS_DIR, file);
    try {
      const result = await ingestGestureFile(filePath);
      results[result.status]++;
    } catch (err) {
      console.error(`  Failed to ingest ${file}:`, err);
      results.skipped++;
    }
  }
  console.log("=".repeat(40));
  console.log(
    `Ingestion complete: ${results.saved} saved, ${results.duplicate} already existed, ${results.skipped} skipped (errors/no usable frames).`,
  );
  console.log(
    `Note: live recognition stats cache refreshes automatically within 12s of the next request -- no server restart needed.`,
  );
  await prisma.$disconnect();
}
main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

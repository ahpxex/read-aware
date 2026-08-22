import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizeHumanReviewInput,
  type HumanReview,
  type HumanReviewInput,
  type ManualReviewSession,
} from "../src/reviews";

interface HumanReviewFile {
  schemaVersion: 1;
  reviews: Record<string, HumanReview>;
}

interface ManualSessionFile {
  schemaVersion: 1;
  sessions: ManualReviewSession[];
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function readHumanReviews(directory: string): Promise<Record<string, HumanReview>> {
  const file = await readJson<HumanReviewFile>(join(directory, "human-reviews.json"), {
    schemaVersion: 1,
    reviews: {},
  });
  return file.schemaVersion === 1 && file.reviews ? file.reviews : {};
}

export async function saveHumanReview(
  directory: string,
  input: HumanReviewInput,
): Promise<HumanReview> {
  const normalized = normalizeHumanReviewInput(input);
  const review: HumanReview = { ...normalized, updatedAt: new Date().toISOString() };
  const reviews = await readHumanReviews(directory);
  reviews[review.targetId] = review;
  await atomicWrite(join(directory, "human-reviews.json"), {
    schemaVersion: 1,
    reviews,
  } satisfies HumanReviewFile);
  return review;
}

export async function readManualSessions(directory: string): Promise<ManualReviewSession[]> {
  const file = await readJson<ManualSessionFile>(join(directory, "manual-sessions.json"), {
    schemaVersion: 1,
    sessions: [],
  });
  return file.schemaVersion === 1 && Array.isArray(file.sessions) ? file.sessions : [];
}

export async function reviewTargetExists(directory: string, targetId: string): Promise<boolean> {
  if (targetId.startsWith("run:")) {
    const target = targetId.slice(4);
    try {
      const contents = await readFile(join(directory, "runs.jsonl"), "utf8");
      return contents.split("\n").some((line) => {
        if (!line) return false;
        try {
          return (JSON.parse(line) as { id?: unknown }).id === target;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }
  if (targetId.startsWith("manual:")) {
    const target = targetId.slice(7);
    const sessions = await readManualSessions(directory);
    return sessions.some((session) => session.turns.some((turn) => turn.id === target));
  }
  return false;
}

export async function saveManualSession(
  directory: string,
  session: ManualReviewSession,
): Promise<void> {
  const sessions = await readManualSessions(directory);
  const index = sessions.findIndex((entry) => entry.id === session.id);
  if (index >= 0) sessions[index] = session;
  else sessions.unshift(session);
  await atomicWrite(join(directory, "manual-sessions.json"), {
    schemaVersion: 1,
    sessions,
  } satisfies ManualSessionFile);
}

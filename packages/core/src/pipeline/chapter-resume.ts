import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { ChapterIntent, ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { ChapterContextTraceSummary, TokenUsageSummary } from "./runner.js";

export interface ChapterResumeControlInput {
  readonly chapterIntent: string;
  readonly chapterMemo?: ChapterMemo;
  readonly chapterIntentData?: ChapterIntent;
  readonly contextPackage: ContextPackage;
  readonly ruleStack: RuleStack;
  readonly externalContext?: string;
  readonly contextTrace?: ChapterContextTraceSummary;
}

export interface ChapterResumeCheckpoint {
  readonly version: 1;
  readonly chapterNumber: number;
  readonly writeOutput: WriteChapterOutput;
  readonly controlInput: ChapterResumeControlInput;
  readonly lengthSpec: LengthSpec;
  readonly tokenUsage: TokenUsageSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChapterResumePayload {
  readonly output: WriteChapterOutput;
  readonly controlInput: ChapterResumeControlInput;
  readonly lengthSpec: LengthSpec;
  readonly tokenUsage: TokenUsageSummary;
}

const CHECKPOINT_VERSION = 1 as const;

export function chapterCheckpointPath(bookDir: string, chapterNumber: number): string {
  const padded = String(chapterNumber).padStart(4, "0");
  return join(bookDir, "story", "runtime", `chapter-${padded}.checkpoint.json`);
}

export async function loadChapterResumeCheckpoint(
  bookDir: string,
  chapterNumber: number,
): Promise<ChapterResumePayload | undefined> {
  const checkpointPath = chapterCheckpointPath(bookDir, chapterNumber);
  try {
    await access(checkpointPath);
  } catch {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(checkpointPath, "utf-8"));
  } catch {
    return undefined;
  }
  const checkpoint = raw as ChapterResumeCheckpoint;
  if (checkpoint?.version !== CHECKPOINT_VERSION || checkpoint.chapterNumber !== chapterNumber) {
    return undefined;
  }
  if (!checkpoint.writeOutput || !checkpoint.controlInput || !checkpoint.lengthSpec) {
    return undefined;
  }
  return {
    output: checkpoint.writeOutput,
    controlInput: checkpoint.controlInput,
    lengthSpec: checkpoint.lengthSpec,
    tokenUsage: checkpoint.tokenUsage ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  };
}

export async function saveChapterResumeCheckpoint(
  bookDir: string,
  chapterNumber: number,
  payload: ChapterResumePayload,
): Promise<void> {
  const checkpointPath = chapterCheckpointPath(bookDir, chapterNumber);
  await mkdir(dirname(checkpointPath), { recursive: true });
  const now = new Date().toISOString();
  const checkpoint: ChapterResumeCheckpoint = {
    version: CHECKPOINT_VERSION,
    chapterNumber,
    writeOutput: payload.output,
    controlInput: payload.controlInput,
    lengthSpec: payload.lengthSpec,
    tokenUsage: payload.tokenUsage,
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf-8");
}

export async function clearChapterResumeCheckpoint(
  bookDir: string,
  chapterNumber: number,
): Promise<void> {
  await rm(chapterCheckpointPath(bookDir, chapterNumber), { force: true }).catch(() => undefined);
}
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { LengthSpec } from "../models/length-governance.js";
import {
  chapterCheckpointPath,
  clearChapterResumeCheckpoint,
  loadChapterResumeCheckpoint,
  saveChapterResumeCheckpoint,
  type ChapterResumePayload,
} from "../pipeline/chapter-resume.js";

const LENGTH_SPEC: LengthSpec = {
  target: 3000,
  softMin: 2700,
  softMax: 3300,
  hardMin: 2400,
  hardMax: 3600,
  countingMode: "zh_chars",
};

function writeOutput(chapterNumber: number, title = "Chapter"): WriteChapterOutput {
  return {
    chapterNumber,
    title,
    content: `# ${title}\n\n正文内容 ${chapterNumber}`,
    wordCount: 100,
    preWriteCheck: "",
    postSettlement: "",
    updatedState: "state",
    updatedLedger: "ledger",
    updatedHooks: "hooks",
    chapterSummary: "summary",
    updatedSubplots: "subplots",
    updatedEmotionalArcs: "arcs",
    updatedCharacterMatrix: "matrix",
    postWriteErrors: [],
    postWriteWarnings: [],
  };
}

function payload(chapterNumber: number, overrides?: Partial<ChapterResumePayload>): ChapterResumePayload {
  return {
    output: writeOutput(chapterNumber),
    controlInput: {
      chapterIntent: "intent",
      chapterMemo: {
        chapter: chapterNumber,
        goal: "goal",
        isGoldenOpening: false,
        body: "memo body",
        threadRefs: [],
      },
      chapterIntentData: {
        chapter: chapterNumber,
        goal: "intent goal",
        mustKeep: [],
        mustAvoid: [],
        styleEmphasis: [],
      },
      contextPackage: { chapter: chapterNumber, selectedContext: [] },
      ruleStack: {
        layers: [{ id: "l1", name: "layer", precedence: 1, scope: "book" }],
        sections: { hard: [], soft: [], diagnostic: [] },
        overrideEdges: [],
        activeOverrides: [],
      },
      externalContext: "context",
    },
    lengthSpec: LENGTH_SPEC,
    tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    ...overrides,
  };
}

describe("chapter resume checkpoint", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("round-trips a checkpoint through save/load", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-resume-"));
    roots.push(root);
    const bookDir = join(root, "books", "demo");
    const expected = payload(7);
    await saveChapterResumeCheckpoint(bookDir, 7, expected);

    const loaded = await loadChapterResumeCheckpoint(bookDir, 7);
    expect(loaded).toEqual(expected);
    expect(loaded?.output.content).toContain("正文内容 7");
    expect(loaded?.controlInput.chapterMemo?.goal).toBe("goal");
    expect(loaded?.tokenUsage.totalTokens).toBe(30);
  });

  it("persists the checkpoint file at story/runtime/chapter-<padded>.checkpoint.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-resume-"));
    roots.push(root);
    const bookDir = join(root, "books", "demo");
    await saveChapterResumeCheckpoint(bookDir, 12, payload(12));

    const path = chapterCheckpointPath(bookDir, 12);
    const raw = JSON.parse(await readFile(path, "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.chapterNumber).toBe(12);
    expect(raw.writeOutput.content).toContain("正文内容 12");
    expect(path.endsWith("chapter-0012.checkpoint.json")).toBe(true);
  });

  it("returns undefined when no checkpoint exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-resume-"));
    roots.push(root);
    await expect(loadChapterResumeCheckpoint(join(root, "books", "demo"), 1)).resolves.toBeUndefined();
  });

  it("ignores a checkpoint whose chapter number does not match", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-resume-"));
    roots.push(root);
    const bookDir = join(root, "books", "demo");
    await saveChapterResumeCheckpoint(bookDir, 3, payload(3));
    await expect(loadChapterResumeCheckpoint(bookDir, 4)).resolves.toBeUndefined();
  });

  it("ignores a corrupt checkpoint file", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-resume-"));
    roots.push(root);
    const bookDir = join(root, "books", "demo");
    const path = chapterCheckpointPath(bookDir, 1);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "{ not valid json", "utf-8");
    await expect(loadChapterResumeCheckpoint(bookDir, 1)).resolves.toBeUndefined();
  });

  it("clears an existing checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-resume-"));
    roots.push(root);
    const bookDir = join(root, "books", "demo");
    await saveChapterResumeCheckpoint(bookDir, 5, payload(5));
    await clearChapterResumeCheckpoint(bookDir, 5);
    await expect(loadChapterResumeCheckpoint(bookDir, 5)).resolves.toBeUndefined();
  });
});
import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BookConfig } from "../models/book.js";
import { PartialResponseError } from "../llm/provider.js";

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

function createStateCard(params: {
  readonly chapter: number;
  readonly location: string;
  readonly protagonistState: string;
  readonly goal: string;
  readonly conflict: string;
}): string {
  return [
    "# Current State",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Current Chapter | ${params.chapter} |`,
    `| Current Location | ${params.location} |`,
    `| Protagonist State | ${params.protagonistState} |`,
    `| Current Goal | ${params.goal} |`,
    "| Current Constraint | The city gates are watched. |",
    "| Current Alliances | Mentor allies are scattered. |",
    `| Current Conflict | ${params.conflict} |`,
    "",
  ].join("\n");
}

function writeChapterOutputMock(chapterNumber: number): Record<string, unknown> {
  return {
    chapterNumber,
    title: "Resumed Chapter",
    content: "Lin Yue follows the debt into the watchtower archive.",
    wordCount: 12,
    preWriteCheck: "check",
    postSettlement: "settled",
    updatedState: "unused legacy state",
    updatedLedger: "unused legacy ledger",
    updatedHooks: "unused legacy hooks",
    chapterSummary: `| ${chapterNumber} | unused summary |`,
    updatedSubplots: "",
    updatedEmotionalArcs: "",
    updatedCharacterMatrix: "",
    postWriteErrors: [],
    postWriteWarnings: [],
    tokenUsage: ZERO_USAGE,
  };
}

describe("PipelineRunner chapter resume checkpoint", () => {
  let root = "";

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("../state/memory-db.js");
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  async function setupBook(): Promise<{ runner: { writeNextChapter: (id: string) => Promise<unknown> }; bookDir: string }> {
    const { PipelineRunner } = await import("../pipeline/runner.js");
    const { StateManager } = await import("../state/manager.js");
    const { WriterAgent } = await import("../agents/writer.js");
    const { ContinuityAuditor } = await import("../agents/continuity.js");
    const { StateValidatorAgent } = await import("../agents/state-validator.js");
    const { PlannerAgent } = await import("../agents/planner.js");
    const { ComposerAgent } = await import("../agents/composer.js");

    root = await mkdtemp(join(tmpdir(), "inkos-runner-resume-"));
    const state = new StateManager(root);
    const bookId = "resume-book";
    const now = "2026-03-25T00:00:00.000Z";
    const book: BookConfig = {
      id: bookId,
      title: "Resume Book",
      platform: "tomato",
      genre: "xuanhuan",
      status: "active",
      language: "en",
      targetChapters: 10,
      chapterWordCount: 12,
      createdAt: now,
      updatedAt: now,
    };

    vi.spyOn(PlannerAgent.prototype, "planChapter").mockImplementation(async (input) => ({
      intent: {
        chapter: input.chapterNumber,
        goal: "Trace the debt through the watchtower archive.",
        mustKeep: [],
        mustAvoid: [],
        styleEmphasis: [],
      },
      memo: {
        chapter: input.chapterNumber,
        goal: "Trace the debt through the archive",
        isGoldenOpening: false,
        body: "## Current task\nTrace the debt through the watchtower archive.",
        threadRefs: [],
      },
      intentMarkdown: "# Chapter Intent\n\n## Goal\nTrace the debt through the watchtower archive.",
      plannerInputs: [],
      runtimePath: join(input.bookDir, "story", "runtime", "chapter-0001.intent.md"),
    }));
    vi.spyOn(ComposerAgent.prototype, "selectMemoryCandidates").mockImplementation(async (request) =>
      request.candidates.map((candidate) => candidate.id));
    vi.spyOn(ComposerAgent.prototype, "selectOutlineSections").mockImplementation(async (request) =>
      request.candidates.map((candidate) => candidate.source));
    vi.spyOn(ComposerAgent.prototype, "selectReferenceSections").mockImplementation(async (request) =>
      request.candidates.map((candidate) => candidate.source));
    vi.spyOn(ComposerAgent.prototype, "compileCompressibleContext").mockResolvedValue("## Compiled context\n- test");

    await state.saveBookConfig(bookId, book);
    const bookDir = state.bookDir(bookId);
    const storyDir = join(bookDir, "story");
    await mkdir(storyDir, { recursive: true });
    await mkdir(join(bookDir, "chapters"), { recursive: true });
    await Promise.all([
      writeFile(join(storyDir, "current_state.md"), createStateCard({
        chapter: 0,
        location: "Shrine outskirts",
        protagonistState: "Lin Yue begins with the oath token hidden.",
        goal: "Reach the trial city.",
        conflict: "The trial deadline is closing in.",
      }), "utf-8"),
      writeFile(join(storyDir, "pending_hooks.md"), "# Pending Hooks\n", "utf-8"),
      writeFile(join(storyDir, "chapter_summaries.md"), "# Chapter Summaries\n", "utf-8"),
    ]);

    const originalSaveChapter = WriterAgent.prototype.saveChapter;
    vi.spyOn(WriterAgent.prototype, "writeChapter").mockResolvedValue(
      writeChapterOutputMock(1) as never,
    );
    vi.spyOn(WriterAgent.prototype, "saveChapter").mockImplementation(async function (
      this: InstanceType<typeof WriterAgent>,
      bookDirArg,
      output,
      numericalSystem,
      language,
    ) {
      await originalSaveChapter.call(this, bookDirArg, output, numericalSystem, language);
    });
    vi.spyOn(StateValidatorAgent.prototype, "validate").mockResolvedValue({
      warnings: [],
      passed: true,
    });

    const runner = new PipelineRunner({
      client: {
        provider: "openai",
        apiFormat: "chat",
        stream: false,
        defaults: {
          temperature: 0.7,
          maxTokens: 4096,
          thinkingBudget: 0,
        },
      } as never,
      model: "test-model",
      projectRoot: root,
    });

    return { runner, bookDir };
  }

  async function checkpointPath(bookDir: string, chapterNumber: number): Promise<string> {
    const padded = String(chapterNumber).padStart(4, "0");
    return join(bookDir, "story", "runtime", `chapter-${padded}.checkpoint.json`);
  }

  it("writes a checkpoint after prose generation and resumes audit/persist on retry without rewriting", async () => {
    const { runner, bookDir } = await setupBook();
    const { ContinuityAuditor } = await import("../agents/continuity.js");
    const { WriterAgent } = await import("../agents/writer.js");

    // First run: audit throws a stream-interruption error, simulating a broken
    // connection during the repair/audit stage after prose was generated.
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockRejectedValueOnce(
      new PartialResponseError("partial audit", new Error("stream closed without [DONE]/finish_reason")),
    );

    await expect(runner.writeNextChapter("resume-book")).rejects.toThrow(/interrupted/i);

    const cpPath = await checkpointPath(bookDir, 1);
    await expect(access(cpPath)).resolves.toBeUndefined();
    const raw = JSON.parse(await readFile(cpPath, "utf-8"));
    expect(raw.chapterNumber).toBe(1);
    expect(raw.writeOutput.content).toContain("watchtower archive");

    const writeChapterSpy = vi.mocked(WriterAgent.prototype.writeChapter);
    expect(writeChapterSpy).toHaveBeenCalledTimes(1);

    // Second run: audit now succeeds. The pipeline must reuse the checkpoint,
    // skip the prose write, complete audit + persist, then clear the checkpoint.
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
      passed: true,
      issues: [],
      summary: "clean",
      overallScore: 90,
      tokenUsage: ZERO_USAGE,
    });

    await runner.writeNextChapter("resume-book");

    expect(writeChapterSpy).toHaveBeenCalledTimes(1); // still 1 — no rewrite
    await expect(access(cpPath)).rejects.toMatchObject({ code: "ENOENT" });

    const chaptersDir = join(bookDir, "chapters");
    const files = (await import("node:fs/promises")).readdir(chaptersDir);
    expect((await files).some((file) => file.endsWith(".md"))).toBe(true);
  }, 20000);

  it("clears the checkpoint when the first run completes without interruption", async () => {
    const { runner, bookDir } = await setupBook();
    const { ContinuityAuditor } = await import("../agents/continuity.js");
    vi.spyOn(ContinuityAuditor.prototype, "auditChapter").mockResolvedValue({
      passed: true,
      issues: [],
      summary: "clean",
      overallScore: 90,
      tokenUsage: ZERO_USAGE,
    });

    await runner.writeNextChapter("resume-book");

    await expect(access(await checkpointPath(bookDir, 1))).rejects.toMatchObject({ code: "ENOENT" });
  }, 20000);
});
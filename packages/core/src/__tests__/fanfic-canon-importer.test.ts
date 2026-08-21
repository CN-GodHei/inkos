import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FanficCanonImporter } from "../agents/fanfic-canon-importer.js";
import type { LLMClient } from "../llm/provider.js";

const TEST_CLIENT: LLMClient = {
  provider: "openai",
  apiFormat: "chat",
  stream: false,
} as unknown as LLMClient;

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
} as const;

const SECTIONS_RESPONSE = [
  "=== SECTION: world_rules ===",
  "规则 A。",
  "=== SECTION: character_profiles ===",
  "（素材中未提取到角色信息）",
  "=== SECTION: key_events ===",
  "（素材中未提取到关键事件）",
  "=== SECTION: power_system ===",
  "（原作无明确力量体系）",
  "=== SECTION: writing_style ===",
  "克制。",
].join("\n");

describe("FanficCanonImporter", () => {
  it("semantically compiles long source chunks instead of truncating the tail", async () => {
    const agent = new FanficCanonImporter({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    )
      .mockResolvedValueOnce({
        content: "片段1资料：主角甲第一次登场。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: "片段2资料：TAIL_CANON_MARKER 是尾部关键正典。",
        usage: ZERO_USAGE,
      })
      .mockResolvedValueOnce({
        content: [
          "=== SECTION: world_rules ===",
          "尾部世界规则：TAIL_CANON_MARKER。",
          "=== SECTION: character_profiles ===",
          "| 角色 | 身份 | 性格底色 | 语癖/口头禅 | 说话风格 | 行为模式 | 关键关系 | 信息边界 |",
          "|------|------|----------|-------------|----------|----------|----------|----------|",
          "| 甲 | 主角 | 克制 | （素材未提及） | 冷静 | 查证 | 无 | 只知道片段信息 |",
          "=== SECTION: key_events ===",
          "| 序号 | 事件 | 涉及角色 | 对同人写作的约束 |",
          "|------|------|----------|------------------|",
          "| 1 | 尾部事件 | 甲 | 必须保留 TAIL_CANON_MARKER |",
          "=== SECTION: power_system ===",
          "（原作无明确力量体系）",
          "=== SECTION: writing_style ===",
          "句式克制。",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const source = `${"前段".repeat(25_000)}\nTAIL_CANON_MARKER`;
    const result = await agent.importFromText(source, "长原作", "canon");

    expect(chatSpy).toHaveBeenCalledTimes(3);
    const secondChunkMessages = chatSpy.mock.calls[1]?.[0] as Array<{ role: string; content: string }>;
    expect(secondChunkMessages[1]?.content).toContain("TAIL_CANON_MARKER");
    const finalMessages = chatSpy.mock.calls[2]?.[0] as Array<{ role: string; content: string }>;
    expect(finalMessages[1]?.content).toContain("片段2资料：TAIL_CANON_MARKER");
    expect(finalMessages[0]?.content).not.toContain("已截断");
    expect(result.worldRules).toContain("TAIL_CANON_MARKER");
  });

  it("reports chunk-compilation and final-extraction progress via the callback", async () => {
    const agent = new FanficCanonImporter({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    const chatSpy = vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    )
      .mockResolvedValue({ content: "片段资料", usage: ZERO_USAGE })
      .mockResolvedValueOnce({
        content: [
          "=== SECTION: world_rules ===",
          "规则 A。",
          "=== SECTION: character_profiles ===",
          "（素材中未提取到角色信息）",
          "=== SECTION: key_events ===",
          "（素材中未提取到关键事件）",
          "=== SECTION: power_system ===",
          "（原作无明确力量体系）",
          "=== SECTION: writing_style ===",
          "克制。",
        ].join("\n"),
        usage: ZERO_USAGE,
      });

    const progress: Array<{ phase: string; done: number; total: number }> = [];
    const source = `${"前段".repeat(30_000)}`;
    await agent.importFromText(source, "长原作", "canon", (p) => progress.push(p));

    expect(chatSpy.mock.calls.length).toBe(3);
    expect(progress).toEqual([
      { phase: "compiling", done: 0, total: 2 },
      { phase: "compiling", done: 1, total: 2 },
      { phase: "compiling", done: 2, total: 2 },
      { phase: "extracting", done: 1, total: 1 },
    ]);
  });

  it("emits only the final extraction progress for short sources", async () => {
    const agent = new FanficCanonImporter({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });

    vi.spyOn(
      agent as unknown as { chat: (...args: unknown[]) => Promise<unknown> },
      "chat",
    ).mockResolvedValue({
      content: [
        "=== SECTION: world_rules ===",
        "规则 A。",
        "=== SECTION: character_profiles ===",
        "（素材中未提取到角色信息）",
        "=== SECTION: key_events ===",
        "（素材中未提取到关键事件）",
        "=== SECTION: power_system ===",
        "（原作无明确力量体系）",
        "=== SECTION: writing_style ===",
        "克制。",
      ].join("\n"),
      usage: ZERO_USAGE,
    });

    const progress: Array<{ phase: string; done: number; total: number }> = [];
    await agent.importFromText("短文本", "短原作", "canon", (p) => progress.push(p));

    expect(progress).toEqual([{ phase: "extracting", done: 1, total: 1 }]);
  });

  it("resumes an interrupted compile from the persisted chunk cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-fanfic-cache-"));
    const cachePath = join(root, "compile.json");
    const source = "A".repeat(60_000);

    const first = new FanficCanonImporter({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });
    vi.spyOn(first as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValueOnce({ content: "片段1资料", usage: ZERO_USAGE })
      .mockRejectedValueOnce(new Error("interrupted"));
    await expect(first.importFromText(source, "长原作", "canon", undefined, { cachePath })).rejects.toThrow("interrupted");

    const second = new FanficCanonImporter({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });
    const secondChat = vi.spyOn(second as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValueOnce({ content: "片段2资料", usage: ZERO_USAGE })
      .mockResolvedValueOnce({ content: SECTIONS_RESPONSE, usage: ZERO_USAGE });

    const result = await second.importFromText(source, "长原作", "canon", undefined, { cachePath });

    expect(secondChat).toHaveBeenCalledTimes(2);
    const chunkTwoMessages = secondChat.mock.calls[0]?.[0] as Array<{ content: string }>;
    expect(chunkTwoMessages[1]?.content).toContain("片段：2/2");
    expect(result.chunkCount).toBe(2);
    expect(result.worldRules).toContain("规则 A。");
    await rm(root, { recursive: true, force: true });
  });

  it("ignores a stale resume cache when the fingerprint changed", async () => {
    const root = await mkdtemp(join(tmpdir(), "inkos-fanfic-cache-"));
    const cachePath = join(root, "compile.json");
    const source = "A".repeat(60_000);

    const first = new FanficCanonImporter({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });
    vi.spyOn(first as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValueOnce({ content: "旧片段", usage: ZERO_USAGE })
      .mockRejectedValueOnce(new Error("stop"));
    await expect(first.importFromText(source, "长原作", "canon", undefined, { cachePath, fingerprint: "old-fp" }))
      .rejects.toThrow("stop");

    const second = new FanficCanonImporter({
      client: TEST_CLIENT,
      model: "test-model",
      projectRoot: process.cwd(),
    });
    const secondChat = vi.spyOn(second as unknown as { chat: (...args: unknown[]) => Promise<unknown> }, "chat")
      .mockResolvedValueOnce({ content: "新片段", usage: ZERO_USAGE })
      .mockResolvedValueOnce({ content: "新片段", usage: ZERO_USAGE })
      .mockResolvedValueOnce({ content: SECTIONS_RESPONSE, usage: ZERO_USAGE });

    await second.importFromText(source, "长原作", "canon", undefined, { cachePath, fingerprint: "new-fp" });

    expect(secondChat).toHaveBeenCalledTimes(3);
    await rm(root, { recursive: true, force: true });
  });
});

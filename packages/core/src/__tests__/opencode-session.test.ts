import { describe, expect, it, vi } from "vitest";
import type { Model } from "@mariozechner/pi-ai";
import type { LLMConfig } from "../models/project.js";

const EMPTY_USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const { streamCalls, completeCalls } = vi.hoisted(() => ({
  streamCalls: [] as Array<{ model: any; context: any; options: any }>,
  completeCalls: [] as Array<{ model: any; context: any; options: any }>,
}));

function assistantMessage(model: any, text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}

vi.mock("@mariozechner/pi-ai", async () => {
  const actual = await vi.importActual<any>("@mariozechner/pi-ai");
  return {
    ...actual,
    streamSimple: (model: any, context: any, options: any) => {
      streamCalls.push({ model, context, options });
      const stream = actual.createAssistantMessageEventStream();
      const message = assistantMessage(model, "ok");
      queueMicrotask(() => {
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
      });
      return stream;
    },
    completeSimple: async (model: any, context: any, options: any) => {
      completeCalls.push({ model, context, options });
      return assistantMessage(model, "ok");
    },
  };
});

const { guardedPiStream } = await import("../agent/pi-stream.js");
const { chatCompletion, createLLMClient } = await import("../llm/provider.js");
const { isOpenCodeTarget, withOpenCodeSessionHeader, OPENCODE_SESSION_HEADER } = await import(
  "../llm/opencode-session.js"
);

function makeModel(baseUrl: string): Model<"anthropic-messages"> {
  return {
    id: "glm-5.1",
    name: "glm-5.1",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8192,
  } as Model<"anthropic-messages">;
}

function makeConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    provider: "openai",
    service: "opencodeCodingPlan",
    configSource: "studio",
    baseUrl: "https://opencode.ai/api/anthropic",
    apiKey: "test-key",
    model: "glm-5.1",
    temperature: 0.7,
    thinkingBudget: 0,
    apiFormat: "chat",
    stream: false,
    headers: undefined,
    ...overrides,
  } as LLMConfig;
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _event of stream) {
    // consume
  }
}

describe("isOpenCodeTarget", () => {
  it("matches the built-in OpenCode services", () => {
    expect(isOpenCodeTarget({ service: "opencodeCodingPlan" })).toBe(true);
    expect(isOpenCodeTarget({ service: "opencode" })).toBe(true);
  });

  it("matches any opencode.ai host", () => {
    expect(isOpenCodeTarget({ baseUrl: "https://opencode.ai/api/anthropic" })).toBe(true);
    expect(isOpenCodeTarget({ baseUrl: "https://zen.opencode.ai/v1" })).toBe(true);
  });

  it("does not match other providers", () => {
    expect(isOpenCodeTarget({ service: "openai" })).toBe(false);
    expect(isOpenCodeTarget({ baseUrl: "https://api.deepseek.com" })).toBe(false);
    expect(isOpenCodeTarget({ baseUrl: "not a url" })).toBe(false);
    expect(isOpenCodeTarget({})).toBe(false);
  });
});

describe("withOpenCodeSessionHeader", () => {
  const target = { service: "opencodeCodingPlan", baseUrl: "https://opencode.ai/api/anthropic" };

  it("adds the header for OpenCode endpoints", () => {
    expect(withOpenCodeSessionHeader({ "Content-Type": "application/json" }, { ...target, sessionId: "inkos-1" }))
      .toEqual({ "Content-Type": "application/json", [OPENCODE_SESSION_HEADER]: "inkos-1" });
  });

  it("keeps an explicit caller header", () => {
    const headers = { [OPENCODE_SESSION_HEADER]: "from-user" };
    expect(withOpenCodeSessionHeader(headers, { ...target, sessionId: "inkos-1" })).toBe(headers);
  });

  it("is a no-op without a session id or for other endpoints", () => {
    expect(withOpenCodeSessionHeader(undefined, target)).toBeUndefined();
    expect(withOpenCodeSessionHeader({ a: "b" }, { baseUrl: "https://api.deepseek.com", sessionId: "x" }))
      .toEqual({ a: "b" });
  });

  it("drops non-ASCII session ids", () => {
    expect(withOpenCodeSessionHeader({ a: "b" }, { ...target, sessionId: "会话一" }))
      .toEqual({ a: "b" });
  });
});

describe("OpenCode session header on the wire", () => {
  it("sends x-opencode-session from the agent transport", async () => {
    streamCalls.length = 0;
    const stream = guardedPiStream(
      makeModel("https://opencode.ai/api/anthropic"),
      { messages: [] } as any,
      { maxTokens: 256 },
      "inkos-agent-session",
    );
    await drain(stream);

    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0].options.headers?.[OPENCODE_SESSION_HEADER]).toBe("inkos-agent-session");
  });

  it("does not send the header to non-OpenCode endpoints", async () => {
    streamCalls.length = 0;
    const stream = guardedPiStream(
      makeModel("https://api.deepseek.com"),
      { messages: [] } as any,
      { maxTokens: 256 },
      "inkos-agent-session",
    );
    await drain(stream);

    expect(streamCalls[0].options.headers?.[OPENCODE_SESSION_HEADER]).toBeUndefined();
  });

  it("sends x-opencode-session from the pipeline transport", async () => {
    completeCalls.length = 0;
    const client = createLLMClient(makeConfig());
    await chatCompletion(client, "glm-5.1", [{ role: "user", content: "hi" }]);

    expect(completeCalls).toHaveLength(1);
    const sent = completeCalls[0].options.headers ?? {};
    expect(sent[OPENCODE_SESSION_HEADER]).toBe(client.sessionId);
    expect(client.sessionId).toMatch(/^inkos-/);
  });
});

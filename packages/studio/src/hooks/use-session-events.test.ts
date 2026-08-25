import { describe, expect, it } from "vitest";
import type { SSEMessage } from "./use-sse";
import { collectNewSSEMessages } from "./use-sse";
import { buildBackgroundTaskExecution } from "./use-session-events";

function msg(event: string, timestamp: number, data: unknown = {}): SSEMessage {
  return { event, timestamp, data, seq: timestamp };
}

describe("collectNewSSEMessages for session events", () => {
  it("returns every event after the cursor instead of only the last one", () => {
    const created = msg("book:created", 1, { sessionId: "s1", bookId: "b1" });
    const complete = msg("agent:complete", 2, { sessionId: "s1" });

    expect(collectNewSSEMessages([created, complete], 0).fresh).toEqual([created, complete]);
    expect(collectNewSSEMessages([created, complete], 2).fresh).toEqual([]);
  });

  it("still sees new events when the SSE ring buffer keeps the same length", () => {
    const old1 = msg("agent:start", 1);
    const old2 = msg("agent:complete", 2);
    const next = msg("book:created", 3, { sessionId: "s1", bookId: "b1" });

    expect(collectNewSSEMessages([old1, old2], 0).fresh).toEqual([old1, old2]);
    expect(collectNewSSEMessages([old2, next], 2).fresh).toEqual([next]);
  });
});

describe("buildBackgroundTaskExecution", () => {
  it("builds a background-tagged running tool card from a tool:start event", () => {
    const execution = buildBackgroundTaskExecution({
      sessionId: "s1",
      id: "task-1",
      tool: "sub_agent",
      args: { agent: "writer" },
      stages: ["准备章节输入", "撰写章节草稿"],
    });

    expect(execution).toMatchObject({
      id: "task-1",
      tool: "sub_agent",
      agent: "writer",
      label: "写作",
      status: "running",
      background: true,
      stages: [
        { label: "准备章节输入", status: "pending" },
        { label: "撰写章节草稿", status: "pending" },
      ],
    });
  });

  it("falls back to a generated id and tool label when fields are missing", () => {
    const execution = buildBackgroundTaskExecution({ sessionId: "s1", tool: "short_fiction_run" });
    expect(execution.tool).toBe("short_fiction_run");
    expect(execution.label).toBe("短篇生产");
    expect(execution.id).toBeTruthy();
    expect(execution.background).toBe(true);
  });
});

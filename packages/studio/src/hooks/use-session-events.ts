import { useEffect } from "react";
import type { SSEMessage } from "./use-sse";
import { useNewSSEMessages } from "./use-sse";
import type { HashRoute } from "./use-hash-route";
import { useChatStore } from "../store/chat";
import type { ToolExecution } from "../store/chat/types";
import { shouldRefreshSidebarForTool } from "../store/chat/message-policy";
import {
  bookKey,
  extractToolDetails,
  extractToolError,
  mergeSessionIds,
  mergeTaskExecution,
  resolveToolLabel,
  summarizeResult,
  updateSession,
  updateToolPartById,
} from "../store/chat/slices/message/runtime";

/**
 * 监听全局 SSE 事件中与 session 有关的两类消息：
 * - session:title — AI 自动生成标题后推送，更新侧边栏显示
 * - book:created  — 新建书籍成功后推送，把 session 从 null 迁移到新书籍；若当前正处
 *   建书聊天页则跳转到新书（基于 store 激活会话判断，不再依赖 localStorage）
 *
 * 以及后台生产任务事件（tool:start / tool:end / task:snapshot）：
 * 服务端把任务事件广播给所有 SSE 订阅者，但只有"发起端 / 会话详情加载端"的会话级流
 * 在消费它们。这里在全局消费一份，让另一台设备 / 另一个标签页也能实时看到并收尾
 * 运行中的任务——有会话级流的会话（发起端）交给会话流处理，避免双重处理。
 *
 * Cursor-based consumption matters because React may batch multiple SSE state
 * updates into one render; looking only at messages.at(-1) drops middle events.
 */

interface TaskStartEventData {
  readonly sessionId?: string;
  readonly id?: string;
  readonly tool?: string;
  readonly args?: Record<string, unknown>;
  readonly stages?: readonly string[];
  readonly background?: boolean;
  readonly execution?: ToolExecution;
}

function asTaskStartData(value: unknown): TaskStartEventData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as TaskStartEventData;
}

/** 从 tool:start 事件构建后台任务卡 execution（带 background 标记）。 */
export function buildBackgroundTaskExecution(data: TaskStartEventData): ToolExecution {
  const rawAgent = data.tool === "sub_agent" ? data.args?.agent : undefined;
  const agent = typeof rawAgent === "string" ? rawAgent : undefined;
  return {
    id: data.id ?? `task-${Date.now()}`,
    tool: data.tool ?? "unknown",
    ...(agent ? { agent } : {}),
    label: resolveToolLabel(data.tool ?? "unknown", agent),
    status: "running",
    ...(data.args ? { args: data.args } : {}),
    ...(Array.isArray(data.stages) && data.stages.length > 0
      ? { stages: data.stages.map((label) => ({ label, status: "pending" as const })) }
      : {}),
    startedAt: Date.now(),
    background: true,
  };
}

function sessionHasSessionStream(sessionId: string): boolean {
  return Boolean(useChatStore.getState().sessions[sessionId]?.stream);
}

/**
 * 后台生产任务启动 / 快照到达：
 * - 会话已有会话级流：发起端 / 已恢复端，交给 attachSessionStreamListeners 处理。
 * - 会话已加载消息但无流：合并任务卡、置 isStreaming、开会话级流。
 * - 会话未加载：调 loadSessionDetail 恢复任务卡并开流（与刷新恢复同一路径）。
 */
function handleTaskStart(sessionId: string, execution: ToolExecution): void {
  if (sessionHasSessionStream(sessionId)) return;
  const runtime = useChatStore.getState().sessions[sessionId];
  if (!runtime || runtime.messages.length === 0) {
    void useChatStore.getState().loadSessionDetail(sessionId);
    return;
  }
  useChatStore.setState((state) => ({
    sessions: updateSession(state.sessions, sessionId, (session) => ({
      messages: mergeTaskExecution(session.messages, execution),
      isStreaming: true,
    })),
  }));
  useChatStore.getState().attachTaskStream(sessionId, execution.startedAt);
}

function handleToolStart(data: TaskStartEventData): void {
  const sessionId = data.sessionId;
  // 只有确认式生产任务（后台任务）的 tool:start 才在全局恢复；聊天轮工具的
  // tool:start 不带 background 标记，非发起端不展示，避免把聊天轮工具错标成
  // 后台任务卡。
  if (!sessionId || !data.tool || data.background !== true) return;
  handleTaskStart(sessionId, buildBackgroundTaskExecution(data));
}

function handleTaskSnapshot(data: TaskStartEventData): void {
  const sessionId = data.sessionId;
  const execution = data.execution;
  if (!sessionId || !execution) return;
  handleTaskStart(sessionId, execution);
}

/** tool:end 的兜底收尾：有会话级流时由会话流处理；没有时按 id 收尾任务卡。 */
function handleToolEnd(data: { readonly sessionId?: string; readonly id?: string; readonly tool?: string; readonly result?: unknown; readonly details?: unknown; readonly isError?: boolean } | null): void {
  const sessionId = data?.sessionId;
  if (!sessionId || !data?.tool) return;
  if (sessionHasSessionStream(sessionId)) return;
  const id = data.id;
  if (!id) return;
  let refreshedSidebar = false;
  useChatStore.setState((state) => {
    const runtime = state.sessions[sessionId];
    if (!runtime) return {};
    const messages = updateToolPartById(runtime.messages, id, (previous) => {
      const execution = { ...previous };
      execution.status = data.isError ? "error" : "completed";
      execution.completedAt = Date.now();
      execution.stages = execution.stages?.map((stage) =>
        stage.status !== "completed"
          ? { ...stage, status: "completed" as const, progress: undefined }
          : stage,
      );
      if (data.isError) execution.error = extractToolError(data.result);
      else execution.result = summarizeResult(data.result);
      const details = data.details ?? extractToolDetails(data.result);
      if (details !== undefined) execution.details = details;
      return execution;
    });
    if (!messages) return {};
    refreshedSidebar = true;
    return { sessions: updateSession(state.sessions, sessionId, () => ({ messages })) };
  });
  if (refreshedSidebar && shouldRefreshSidebarForTool(data.tool)) {
    useChatStore.getState().bumpBookDataVersion();
  }
}

export function useSessionEvents(
  sse: { messages: ReadonlyArray<SSEMessage>; connected: boolean },
  route: HashRoute,
  setRoute: (route: HashRoute) => void,
): void {
  // 加载（或 SSE 重连）时恢复"仍在本进程运行的后台生产任务"：
  // 覆盖"任务进行中刷新页面 / 换设备打开"的场景，让任务卡与运行状态恢复可见。
  useEffect(() => {
    if (sse.connected) void useChatStore.getState().restoreActiveTasks();
  }, [sse.connected]);

  useNewSSEMessages(sse.messages, (recent) => {
    if (recent.event === "session:title") {
      const data = recent.data as { sessionId?: string; title?: string } | null;
      if (!data?.sessionId || !data.title) return;
      const { sessionId, title } = data;
      useChatStore.setState((state) => {
        const session = state.sessions[sessionId];
        if (!session) return {};
        return {
          sessions: updateSession(state.sessions, sessionId, () => ({ title })),
        };
      });
      return;
    }

    if (recent.event === "book:created") {
      const data = recent.data as { sessionId?: string; bookId?: string } | null;
      if (!data?.sessionId || !data.bookId) return;
      const { sessionId, bookId } = data;

      useChatStore.setState((state) => {
        const session = state.sessions[sessionId];
        if (!session) return {};
        const previousKey = bookKey(session.bookId);
        const nextKey = bookKey(bookId);
        return {
          sessions: updateSession(state.sessions, sessionId, () => ({ bookId })),
          sessionIdsByBook: {
            ...state.sessionIdsByBook,
            [previousKey]: (state.sessionIdsByBook[previousKey] ?? []).filter((id) => id !== sessionId),
            [nextKey]: mergeSessionIds(state.sessionIdsByBook[nextKey], [sessionId]),
          },
        };
      });

      // 建书聊天页：当前激活会话创建成功时跳转到新书。会话选择已服务端派生，
      // 这里用 store 里的激活会话（而非各浏览器 localStorage）判断是否跳转。
      if (route.page === "book-create" && useChatStore.getState().activeSessionId === sessionId) {
        setRoute({ page: "book", bookId });
      }
      return;
    }

    if (recent.event === "tool:start") {
      const data = asTaskStartData(recent.data);
      if (data) handleToolStart(data);
      return;
    }

    if (recent.event === "task:snapshot") {
      const data = asTaskStartData(recent.data);
      if (data) handleTaskSnapshot(data);
      return;
    }

    if (recent.event === "tool:end") {
      handleToolEnd(recent.data as Parameters<typeof handleToolEnd>[0]);
      return;
    }
  });
}

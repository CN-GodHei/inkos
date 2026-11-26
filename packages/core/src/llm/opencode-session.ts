/**
 * OpenCode (opencode.ai) 订阅端点要求每个请求带 `x-opencode-session` 头，
 * 用于把同一段对话的请求路由到同一个上游会话。
 *
 * pi-ai 直到 1.4.0 才内置这个头（且只在内置 opencode provider 或
 * `Models` facade + `sessionId` 时生效），本项目钉在 0.67.1，
 * 所以在自己的传输层补齐：只要是 opencode.ai 端点就带上。
 */

import { randomUUID } from "node:crypto";

export const OPENCODE_SESSION_HEADER = "x-opencode-session";

const OPENCODE_HOST = "opencode.ai";

const OPENCODE_SERVICE_IDS = new Set([
  "opencode",
  "opencode-go",
  // InkOS 内置的 OpenCode Coding Plan 端点（见 providers/endpoints/opencodeCodingPlan.ts）
  "opencodeCodingPlan",
]);

export interface OpenCodeTarget {
  readonly service?: string | undefined;
  readonly baseUrl?: string | undefined;
}

function hostnameOf(baseUrl: string | undefined): string {
  if (!baseUrl) return "";
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** 是否为 OpenCode 端点：按内置服务 id 或 baseUrl 域名判断。 */
export function isOpenCodeTarget(target: OpenCodeTarget): boolean {
  const service = target.service?.trim();
  if (service && OPENCODE_SERVICE_IDS.has(service)) return true;
  const host = hostnameOf(target.baseUrl);
  return host === OPENCODE_HOST || host.endsWith(`.${OPENCODE_HOST}`);
}

function sanitizeSessionId(sessionId: string | undefined): string | undefined {
  const trimmed = sessionId?.trim();
  if (!trimmed) return undefined;
  // HTTP 头值必须是可打印 ASCII；带中文/换行的 id 直接放弃注入。
  if (!/^[\x20-\x7e]+$/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * 给发往 OpenCode 的请求补上 session 头。
 * - 非 OpenCode 端点、没有 sessionId、或调用方已经显式设置了该头 → 原样返回。
 */
export function withOpenCodeSessionHeader(
  headers: Record<string, string> | undefined,
  target: OpenCodeTarget & { readonly sessionId?: string | undefined },
): Record<string, string> | undefined {
  const sessionId = sanitizeSessionId(target.sessionId);
  if (!sessionId || !isOpenCodeTarget(target)) return headers;

  const alreadySet = Object.keys(headers ?? {}).some(
    (key) => key.toLowerCase() === OPENCODE_SESSION_HEADER,
  );
  if (alreadySet) return headers;

  return { ...(headers ?? {}), [OPENCODE_SESSION_HEADER]: sessionId };
}

/** 生成一个在日志里可辨识的会话 id。 */
export function createOpenCodeSessionId(): string {
  return `inkos-${randomUUID()}`;
}

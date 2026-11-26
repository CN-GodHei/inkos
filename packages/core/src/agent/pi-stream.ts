import { streamSimple } from "@mariozechner/pi-ai";
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import {
  assertWithinContextWindow,
  estimatePiContextTokens,
  guardAssistantMessageStream,
} from "../llm/provider.js";
import {
  agentTrajectoryHeaders,
  beginAgentModelCall,
} from "../llm/agent-trajectory.js";
import { withOpenCodeSessionHeader } from "../llm/opencode-session.js";

/**
 * The single Pi transport boundary used by both conversational and worker
 * agents. Pi keeps native tool calls; InkOS adds context guards, trajectory
 * headers, cancellation, and stream deadlines around the request.
 *
 * `openCodeSessionId` 传入时，发往 opencode.ai 的请求会带上
 * `x-opencode-session`（订阅端点要求；pi-ai 0.67.1 不会自己加）。
 */
export function guardedPiStream<TApi extends Api>(
  model: Model<TApi>,
  context: Context,
  options?: SimpleStreamOptions,
  openCodeSessionId?: string,
): AssistantMessageEventStream {
  const reservedOutputTokens = Number.isFinite(options?.maxTokens)
    ? options!.maxTokens!
    : Number.isFinite(model.maxTokens)
      ? model.maxTokens
      : 4096;
  assertWithinContextWindow({
    piModel: model,
    model: model.id,
    estimatedInputTokens: estimatePiContextTokens(context),
    reservedOutputTokens,
  });
  const modelCall = beginAgentModelCall();
  const traceHeaders = agentTrajectoryHeaders(model.baseUrl, modelCall, 1, {
    effort: String(options?.reasoning ?? (model.reasoning ? "enabled" : "disabled")),
  });
  const headers = withOpenCodeSessionHeader(
    { ...(options?.headers ?? {}), ...traceHeaders },
    { baseUrl: model.baseUrl, sessionId: openCodeSessionId },
  );
  return guardAssistantMessageStream(
    model,
    (signal) => streamSimple(model, context, {
      ...options,
      headers,
      signal,
    }),
    options?.signal,
  );
}

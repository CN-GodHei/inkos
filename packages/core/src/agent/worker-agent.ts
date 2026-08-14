import { Agent } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import {
  chatCompletion,
  type LLMClient,
  type LLMMessage,
  type LLMResponse,
  type OnStreamProgress,
} from "../llm/provider.js";

export interface WorkerAgentOptions {
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly webSearch?: boolean;
  readonly onStreamProgress?: OnStreamProgress;
  readonly onTextDelta?: (text: string) => void;
  readonly signal?: AbortSignal;
}

const EMPTY_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function workerModel(client: LLMClient, modelId: string, maxTokens?: number): Model<Api> {
  const base = client._piModel;
  if (base) {
    return base.id === modelId ? base : { ...base, id: modelId, name: modelId };
  }

  // Test doubles and embedders may provide only the public LLMClient surface.
  // The actual transport still runs through chatCompletion; this model is Pi
  // lifecycle metadata rather than a second provider configuration.
  return {
    id: modelId,
    name: modelId,
    api: (client.apiFormat === "responses" ? "openai-responses" : "openai-completions") as Api,
    provider: client.provider as Provider,
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: EMPTY_COST,
    contextWindow: 200_000,
    maxTokens: maxTokens ?? client.defaults?.maxTokens ?? 32_768,
  };
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { ...EMPTY_COST, total: 0 },
  };
}

function assistantMessage(
  model: Model<Api>,
  content: string,
  response: LLMResponse | undefined,
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: content ? [{ type: "text", text: content }] : [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: response?.usage
      ? {
          input: response.usage.promptTokens,
          output: response.usage.completionTokens,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: response.usage.totalTokens,
          cost: { ...EMPTY_COST, total: 0 },
        }
      : emptyUsage(),
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function textFromContent(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is Extract<(typeof content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function contextMessages(context: Context): LLMMessage[] {
  const messages: LLMMessage[] = [];
  if (context.systemPrompt?.trim()) {
    messages.push({ role: "system", content: context.systemPrompt });
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      messages.push({ role: "user", content: textFromContent(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      messages.push({
        role: "assistant",
        content: message.content
          .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      });
      continue;
    }
    messages.push({
      role: "user",
      content: `[Tool result: ${message.toolName}]\n${textFromContent(message.content)}`,
    });
  }
  return messages;
}

function combineSignals(primary: AbortSignal | undefined, secondary: AbortSignal | undefined): AbortSignal | undefined {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return AbortSignal.any([primary, secondary]);
}

/**
 * Pi stream adapter backed by the existing InkOS provider boundary.
 *
 * Pi owns the worker lifecycle and cancellation. The provider remains the sole
 * transport implementation so custom endpoints, retries, context guards and
 * stream deadlines behave exactly like the rest of InkOS.
 */
function providerWorkerStream(
  client: LLMClient,
  model: Model<Api>,
  context: Context,
  streamOptions: SimpleStreamOptions | undefined,
  options: WorkerAgentOptions,
  onFailure: (error: unknown) => void,
) {
  const stream = createAssistantMessageEventStream();
  let streamedText = "";
  let started = false;

  const partial = (): AssistantMessage => assistantMessage(model, streamedText, undefined, "stop");
  const emitDelta = (delta: string): void => {
    if (!delta) return;
    options.onTextDelta?.(delta);
    if (!started) {
      stream.push({ type: "start", partial: partial() });
      stream.push({ type: "text_start", contentIndex: 0, partial: partial() });
      started = true;
    }
    streamedText += delta;
    stream.push({ type: "text_delta", contentIndex: 0, delta, partial: partial() });
  };

  queueMicrotask(() => {
    void (async () => {
      try {
        const signal = combineSignals(streamOptions?.signal, options.signal);
        const response = await chatCompletion(client, model.id, contextMessages(context), {
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
          ...(options.webSearch !== undefined ? { webSearch: options.webSearch } : {}),
          ...(options.onStreamProgress ? { onStreamProgress: options.onStreamProgress } : {}),
          onTextDelta: emitDelta,
          ...(signal ? { signal } : {}),
        });
        if (started) {
          streamedText = response.content;
          stream.push({ type: "text_end", contentIndex: 0, content: response.content, partial: partial() });
        }
        const message = assistantMessage(model, response.content, response, "stop");
        stream.push({ type: "done", reason: "stop", message });
        stream.end(message);
      } catch (error) {
        onFailure(error);
        const aborted = streamOptions?.signal?.aborted || options.signal?.aborted;
        const message = assistantMessage(
          model,
          streamedText,
          undefined,
          aborted ? "aborted" : "error",
          error instanceof Error ? error.message : String(error),
        );
        stream.push({ type: "error", reason: aborted ? "aborted" : "error", error: message });
        stream.end(message);
      }
    })();
  });

  return stream;
}

function toAgentMessages(messages: ReadonlyArray<LLMMessage>, model: Model<Api>): Message[] {
  return messages
    .filter((message) => message.role !== "system")
    .map((message): Message => {
      if (message.role === "user") {
        return { role: "user", content: message.content, timestamp: Date.now() };
      }
      return assistantMessage(model, message.content, undefined, "stop");
    });
}

export async function runWorkerAgent(
  client: LLMClient,
  modelId: string,
  messages: ReadonlyArray<LLMMessage>,
  options: WorkerAgentOptions = {},
): Promise<LLMResponse> {
  options.signal?.throwIfAborted();
  const model = workerModel(client, modelId, options.maxTokens);
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const promptMessages = toAgentMessages(messages, model);
  if (promptMessages.length === 0) {
    throw new Error("Worker Agent requires at least one non-system message");
  }

  let streamFailure: unknown;
  const agent = new Agent({
    initialState: { model, systemPrompt, tools: [], messages: [] },
    toolExecution: "sequential",
    streamFn: (streamModel, context, streamOptions) => providerWorkerStream(
      client,
      streamModel,
      context,
      streamOptions,
      options,
      (error) => { streamFailure = error; },
    ),
  });
  const abortAgent = () => agent.abort();
  options.signal?.addEventListener("abort", abortAgent, { once: true });

  try {
    await agent.prompt(promptMessages);
    options.signal?.throwIfAborted();
    if (streamFailure !== undefined) throw streamFailure;
    const final = [...agent.state.messages].reverse().find(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    if (!final) throw new Error("Worker Agent completed without an assistant response");
    if (final.stopReason === "error" || final.stopReason === "aborted") {
      throw new Error(final.errorMessage ?? `Worker Agent stopped: ${final.stopReason}`);
    }
    return {
      content: final.content
        .filter((part): part is Extract<(typeof final.content)[number], { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join(""),
      usage: {
        promptTokens: final.usage.input,
        completionTokens: final.usage.output,
        totalTokens: final.usage.totalTokens,
      },
    };
  } finally {
    options.signal?.removeEventListener("abort", abortAgent);
  }
}

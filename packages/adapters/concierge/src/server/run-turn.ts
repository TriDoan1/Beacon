import Anthropic from "@anthropic-ai/sdk";
import type {
  SupportMessageRole,
  SupportMessageToolCall,
} from "@paperclipai/shared";
import { conciergeTools, parseToolEffect, type ConciergeToolEffect } from "./tools.js";

export interface ConciergeHistoryMessage {
  role: SupportMessageRole;
  content: string;
  toolCalls?: SupportMessageToolCall[] | null;
}

export interface RunConciergeTurnInput {
  apiKey: string;
  apiBaseUrl?: string;
  model: string;
  systemPrompt: string;
  history: ConciergeHistoryMessage[];
  userMessage: string;
  maxOutputTokens?: number;
}

export interface ConciergeTurnEvent {
  type:
    | "text_delta"
    | "tool_call"
    | "stop"
    | "usage"
    | "error";
  textDelta?: string;
  toolCall?: SupportMessageToolCall;
  toolEffect?: ConciergeToolEffect;
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
}

export interface RunConciergeTurnResult {
  assistantText: string;
  toolCalls: SupportMessageToolCall[];
  toolEffects: ConciergeToolEffect[];
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}

export async function* runConciergeTurn(
  input: RunConciergeTurnInput,
): AsyncGenerator<ConciergeTurnEvent, RunConciergeTurnResult> {
  const client = new Anthropic({
    apiKey: input.apiKey,
    baseURL: input.apiBaseUrl,
  });

  const messages = toAnthropicMessages([
    ...input.history,
    { role: "user", content: input.userMessage },
  ]);

  const stream = client.messages.stream({
    model: input.model,
    max_tokens: input.maxOutputTokens ?? 1024,
    system: input.systemPrompt,
    tools: conciergeTools,
    messages,
  });

  let assistantText = "";
  const toolCalls: SupportMessageToolCall[] = [];
  const toolEffects: ConciergeToolEffect[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;

  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          const delta = event.delta.text;
          assistantText += delta;
          yield { type: "text_delta", textDelta: delta };
        }
      } else if (event.type === "message_delta") {
        if (event.delta.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
        if (event.usage && typeof event.usage.output_tokens === "number") {
          outputTokens = event.usage.output_tokens;
        }
      } else if (event.type === "message_start") {
        if (event.message.usage) {
          inputTokens = event.message.usage.input_tokens ?? inputTokens;
          outputTokens = event.message.usage.output_tokens ?? outputTokens;
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    if (finalMessage.usage) {
      inputTokens = finalMessage.usage.input_tokens ?? inputTokens;
      outputTokens = finalMessage.usage.output_tokens ?? outputTokens;
    }
    if (finalMessage.stop_reason) {
      stopReason = finalMessage.stop_reason;
    }

    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        const args = (block.input as Record<string, unknown>) ?? {};
        const call: SupportMessageToolCall = {
          id: block.id,
          name: block.name,
          arguments: args,
        };
        toolCalls.push(call);
        yield { type: "tool_call", toolCall: call };
        const effect = parseToolEffect(block.name, args);
        if (effect) {
          toolEffects.push(effect);
        }
      }
    }

    yield {
      type: "usage",
      inputTokens,
      outputTokens,
    };
    yield { type: "stop", stopReason: stopReason ?? undefined };

    return {
      assistantText,
      toolCalls,
      toolEffects,
      inputTokens,
      outputTokens,
      stopReason,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    yield { type: "error", errorMessage: message };
    throw error;
  }
}

type AssistantContentBlock = Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam;

function toAnthropicMessages(
  history: ConciergeHistoryMessage[],
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of history) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const blocks: AssistantContentBlock[] = [];
      if (m.content) {
        blocks.push({ type: "text", text: m.content });
      }
      if (m.toolCalls) {
        for (const call of m.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
      }
      if (blocks.length > 0) {
        out.push({ role: "assistant", content: blocks });
      }
    }
  }
  return out;
}

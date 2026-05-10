import type { SupportSessionInitialContext } from "@paperclipai/shared";
import { SupportApiClient, SupportApiError } from "./api-client.js";
import { clearStoredSessionId, loadStoredSessionId, storeSessionId } from "./storage.js";
import type { InternalMessage, SessionPhase, WidgetPublicState } from "./types.js";

export interface SessionManagerOptions {
  api: SupportApiClient;
  productKey: string;
  initialContext: SupportSessionInitialContext;
  onChange: () => void;
  onPublicStateChange?: (state: WidgetPublicState) => void;
}

interface SessionManagerState {
  phase: SessionPhase;
  sessionId: string | null;
  greeting: string | null;
  closeReason: string | null;
  errorCode: string | null;
  messages: InternalMessage[];
  modelUsed: string | null;
}

export class SessionManager {
  private state: SessionManagerState = {
    phase: "idle",
    sessionId: null,
    greeting: null,
    closeReason: null,
    errorCode: null,
    messages: [],
    modelUsed: null,
  };

  private currentTurnAbort: AbortController | null = null;

  constructor(private readonly opts: SessionManagerOptions) {}

  getState(): Readonly<SessionManagerState> {
    return this.state;
  }

  getPublicState(): WidgetPublicState {
    return {
      phase: this.state.phase,
      sessionId: this.state.sessionId,
      closeReason: this.state.closeReason,
      errorCode: this.state.errorCode,
    };
  }

  private setState(patch: Partial<SessionManagerState>) {
    const before = this.state.phase;
    this.state = { ...this.state, ...patch };
    this.opts.onChange();
    if (before !== this.state.phase) {
      this.opts.onPublicStateChange?.(this.getPublicState());
    }
  }

  async ensureSession(): Promise<void> {
    if (this.state.sessionId) return;
    const stored = loadStoredSessionId(this.opts.productKey);
    if (stored) {
      try {
        const replay = await this.opts.api.replay(stored);
        if (replay.status === "active") {
          this.setState({
            phase: "active",
            sessionId: replay.sessionId,
            modelUsed: replay.modelUsed,
            messages: replay.messages.map((m) => ({
              id: m.id,
              seq: m.seq,
              role: m.role,
              content: m.content,
              toolCalls: m.toolCalls ?? null,
            })),
          });
          return;
        }
        // Stored session is closed; clear and fall through to opening a new one.
        clearStoredSessionId(this.opts.productKey);
      } catch (err) {
        if (err instanceof SupportApiError && err.status === 401) {
          this.setState({ phase: "error", errorCode: "invalid_token" });
          return;
        }
        // 404, network error, etc — start fresh.
        clearStoredSessionId(this.opts.productKey);
      }
    }
    await this.openNewSession();
  }

  private async openNewSession(): Promise<void> {
    this.setState({ phase: "opening", errorCode: null });
    try {
      const response = await this.opts.api.openSession(this.opts.initialContext);
      storeSessionId(this.opts.productKey, response.sessionId);
      this.setState({
        phase: "active",
        sessionId: response.sessionId,
        greeting: response.greeting ?? null,
        modelUsed: response.modelUsed,
        messages: [],
      });
    } catch (err) {
      this.handleApiError(err);
    }
  }

  async sendUserMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!this.state.sessionId) {
      await this.ensureSession();
      if (!this.state.sessionId) return;
    }
    if (this.state.phase !== "active") return;

    const optimisticSeq = nextLocalSeq(this.state.messages);
    const userMsg: InternalMessage = {
      id: `local-user-${optimisticSeq}`,
      seq: optimisticSeq,
      role: "user",
      content: trimmed,
    };
    const pendingAssistant: InternalMessage = {
      id: `local-assistant-${optimisticSeq + 1}`,
      seq: optimisticSeq + 1,
      role: "assistant",
      content: "",
      pending: true,
    };
    this.setState({
      phase: "streaming",
      messages: [...this.state.messages, userMsg, pendingAssistant],
    });

    const abort = new AbortController();
    this.currentTurnAbort = abort;
    let assistantText = "";
    const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
    let closeReason: string | null = null;
    try {
      await this.opts.api.sendTurn(
        this.state.sessionId!,
        trimmed,
        (frame) => {
          if (frame.event === "text") {
            const delta = (frame.data as { delta?: string })?.delta ?? "";
            assistantText += delta;
            const assistant = this.state.messages.find((m) => m.pending && m.role === "assistant");
            if (assistant) {
              assistant.content = assistantText;
              this.setState({ messages: [...this.state.messages] });
            }
          } else if (frame.event === "tool_call") {
            const tc = frame.data as { id: string; name: string; arguments: Record<string, unknown> };
            toolCalls.push(tc);
            const assistant = this.state.messages.find((m) => m.pending && m.role === "assistant");
            if (assistant) {
              assistant.toolCalls = [...(assistant.toolCalls ?? []), tc];
              this.setState({ messages: [...this.state.messages] });
            }
          } else if (frame.event === "complete") {
            const data = frame.data as { closeReason?: string | null; assistantMessageSeq?: number };
            closeReason = data.closeReason ?? null;
            const assistant = this.state.messages.find((m) => m.pending && m.role === "assistant");
            if (assistant) {
              assistant.pending = false;
              if (typeof data.assistantMessageSeq === "number") {
                assistant.seq = data.assistantMessageSeq;
              }
            }
            this.setState({ messages: [...this.state.messages] });
          } else if (frame.event === "error") {
            const data = frame.data as { message?: string };
            const assistant = this.state.messages.find((m) => m.pending && m.role === "assistant");
            if (assistant) {
              assistant.content = data.message ?? "Something went wrong.";
              assistant.pending = false;
              this.setState({ messages: [...this.state.messages] });
            }
          }
        },
        abort.signal,
      );
      if (closeReason) {
        clearStoredSessionId(this.opts.productKey);
        this.setState({
          phase: "closed",
          closeReason,
        });
      } else {
        this.setState({ phase: "active" });
      }
    } catch (err) {
      this.handleApiError(err);
    } finally {
      this.currentTurnAbort = null;
    }
  }

  abortCurrentTurn(): void {
    this.currentTurnAbort?.abort();
  }

  private handleApiError(err: unknown): void {
    if (err instanceof DOMException && err.name === "AbortError") {
      this.setState({ phase: "active" });
      return;
    }
    if (err instanceof SupportApiError) {
      const code = err.code;
      if (err.status === 401) {
        this.setState({ phase: "error", errorCode: "invalid_token" });
        return;
      }
      if (err.status === 402) {
        clearStoredSessionId(this.opts.productKey);
        this.setState({ phase: "closed", closeReason: "cost_cap", errorCode: code });
        return;
      }
      if (err.status === 429) {
        this.setState({ phase: "error", errorCode: code });
        return;
      }
      if (err.status === 403) {
        this.setState({ phase: "error", errorCode: code });
        return;
      }
      this.setState({ phase: "error", errorCode: code });
      return;
    }
    if (err instanceof TypeError && /fetch|network/i.test(err.message)) {
      this.setState({ phase: "offline", errorCode: "network" });
      return;
    }
    this.setState({ phase: "error", errorCode: "unknown" });
  }

  async retry(): Promise<void> {
    this.setState({ phase: "idle", errorCode: null });
    await this.ensureSession();
  }
}

function nextLocalSeq(messages: InternalMessage[]): number {
  return messages.reduce((max, m) => (m.seq > max ? m.seq : max), 0) + 1;
}

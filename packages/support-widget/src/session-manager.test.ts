import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "./session-manager.js";
import { SupportApiClient, SupportApiError } from "./api-client.js";
import type { SupportSessionInitialContext } from "@paperclipai/shared";

afterEach(() => {
  window.localStorage.clear();
});

function makeManager(api: Partial<SupportApiClient>) {
  let renders = 0;
  const initialContext: SupportSessionInitialContext = { url: "https://test", routePath: "/" };
  const manager = new SessionManager({
    api: api as SupportApiClient,
    productKey: "tailwind",
    initialContext,
    onChange: () => {
      renders += 1;
    },
  });
  return { manager, getRenders: () => renders };
}

describe("SessionManager.ensureSession", () => {
  it("opens a new session when localStorage is empty", async () => {
    const { manager } = makeManager({
      openSession: async () => ({
        sessionId: "s-1",
        modelUsed: "claude-haiku-4-5-20251001",
        greeting: "hi",
        theme: {},
        status: "active" as const,
      }),
    });
    await manager.ensureSession();
    const state = manager.getState();
    expect(state.sessionId).toBe("s-1");
    expect(state.phase).toBe("active");
    expect(state.greeting).toBe("hi");
    expect(window.localStorage.getItem("support-widget:sessionId:tailwind")).toBe("s-1");
  });

  it("resumes an active session from localStorage via /replay", async () => {
    window.localStorage.setItem("support-widget:sessionId:tailwind", "s-9");
    const { manager } = makeManager({
      replay: async () => ({
        sessionId: "s-9",
        status: "active" as const,
        closeReason: null,
        modelUsed: "claude-haiku-4-5-20251001",
        messages: [
          { id: "m1", seq: 1, role: "user", content: "hi", createdAt: new Date().toISOString() },
          { id: "m2", seq: 2, role: "assistant", content: "hey", createdAt: new Date().toISOString() },
        ],
      }),
    });
    await manager.ensureSession();
    const state = manager.getState();
    expect(state.sessionId).toBe("s-9");
    expect(state.phase).toBe("active");
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]?.content).toBe("hey");
  });

  it("falls through and opens a fresh session when stored session is closed", async () => {
    window.localStorage.setItem("support-widget:sessionId:tailwind", "s-old");
    const { manager } = makeManager({
      replay: async () => ({
        sessionId: "s-old",
        status: "closed" as const,
        closeReason: "intake_submitted" as const,
        modelUsed: "claude-haiku-4-5-20251001",
        messages: [],
      }),
      openSession: async () => ({
        sessionId: "s-new",
        modelUsed: "claude-haiku-4-5-20251001",
        greeting: undefined,
        theme: {},
        status: "active" as const,
      }),
    });
    await manager.ensureSession();
    const state = manager.getState();
    expect(state.sessionId).toBe("s-new");
    expect(state.phase).toBe("active");
    expect(window.localStorage.getItem("support-widget:sessionId:tailwind")).toBe("s-new");
  });

  it("clears stored session id and starts fresh on 404 from replay", async () => {
    window.localStorage.setItem("support-widget:sessionId:tailwind", "s-gone");
    const { manager } = makeManager({
      replay: async () => {
        throw new SupportApiError(404, "session_not_found");
      },
      openSession: async () => ({
        sessionId: "s-fresh",
        modelUsed: "claude-haiku-4-5-20251001",
        greeting: undefined,
        theme: {},
        status: "active" as const,
      }),
    });
    await manager.ensureSession();
    expect(manager.getState().sessionId).toBe("s-fresh");
  });

  it("transitions to error phase on 401 from replay (token invalid)", async () => {
    window.localStorage.setItem("support-widget:sessionId:tailwind", "s-old");
    const { manager } = makeManager({
      replay: async () => {
        throw new SupportApiError(401, "invalid_token");
      },
    });
    await manager.ensureSession();
    expect(manager.getState().phase).toBe("error");
    expect(manager.getState().errorCode).toBe("invalid_token");
  });
});

describe("SessionManager.handleApiError mapping", () => {
  it("maps 402 to phase=closed reason=cost_cap and clears stored session", async () => {
    window.localStorage.setItem("support-widget:sessionId:tailwind", "s-1");
    const { manager } = makeManager({
      openSession: async () => {
        throw new SupportApiError(402, "session_cost_cap_exceeded");
      },
    });
    await manager.ensureSession();
    expect(manager.getState().phase).toBe("closed");
    expect(manager.getState().closeReason).toBe("cost_cap");
    expect(window.localStorage.getItem("support-widget:sessionId:tailwind")).toBeNull();
  });

  it("maps 429 to phase=error", async () => {
    const { manager } = makeManager({
      openSession: async () => {
        throw new SupportApiError(429, "rate_limited");
      },
    });
    await manager.ensureSession();
    expect(manager.getState().phase).toBe("error");
    expect(manager.getState().errorCode).toBe("rate_limited");
  });
});

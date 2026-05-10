import { afterEach, describe, expect, it } from "vitest";
import { clearStoredSessionId, loadStoredSessionId, storeSessionId } from "./storage.js";

afterEach(() => {
  window.localStorage.clear();
});

describe("storage", () => {
  it("stores and loads a sessionId scoped by productKey", () => {
    storeSessionId("tailwind", "abc-123");
    storeSessionId("openclaw", "def-456");
    expect(loadStoredSessionId("tailwind")).toBe("abc-123");
    expect(loadStoredSessionId("openclaw")).toBe("def-456");
  });

  it("clears a stored sessionId", () => {
    storeSessionId("tailwind", "abc-123");
    clearStoredSessionId("tailwind");
    expect(loadStoredSessionId("tailwind")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(loadStoredSessionId("never-set")).toBeNull();
  });
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { IssueExecutionDisposition } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssueDispositionBadge, dispositionCategory } from "./IssueDispositionBadge";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("IssueDispositionBadge", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function render(disposition: IssueExecutionDisposition | null) {
    const root = createRoot(container);
    act(() => {
      root.render(<IssueDispositionBadge disposition={disposition} />);
    });
    return root;
  }

  it("renders nothing for null disposition", () => {
    const root = render(null);
    expect(container.querySelector("[data-execution-disposition-kind]")).toBeNull();
    act(() => root.unmount());
  });

  it("renders nothing for terminal and resting kinds by default", () => {
    let root = render({ kind: "terminal" });
    expect(container.querySelector("[data-execution-disposition-kind]")).toBeNull();
    act(() => root.unmount());

    root = render({ kind: "resting" });
    expect(container.querySelector("[data-execution-disposition-kind]")).toBeNull();
    act(() => root.unmount());
  });

  it("renders Live category for live disposition", () => {
    const root = render({ kind: "live", path: "active_run" });
    const badge = container.querySelector("[data-execution-disposition-kind]");
    expect(badge?.getAttribute("data-execution-disposition-kind")).toBe("live");
    expect(badge?.getAttribute("data-execution-disposition-category")).toBe("live");
    expect(badge?.textContent).toContain("Live");
    expect(badge?.getAttribute("title")).toContain("Active run");
    act(() => root.unmount());
  });

  it("distinguishes blocked_chain from generic waiting", () => {
    const root = render({ kind: "waiting", path: "blocker_chain" });
    const badge = container.querySelector("[data-execution-disposition-kind]");
    expect(badge?.getAttribute("data-execution-disposition-category")).toBe("blocked_chain");
    expect(badge?.textContent).toContain("Blocked");
    act(() => root.unmount());
  });

  it("renders invalid category with reason in tooltip", () => {
    const root = render({
      kind: "invalid",
      reason: "in_review_without_action_path",
      suggestedCorrection: "fix it",
    });
    const badge = container.querySelector("[data-execution-disposition-kind]");
    expect(badge?.getAttribute("data-execution-disposition-category")).toBe("invalid");
    expect(badge?.getAttribute("title")).toContain("Review without action path");
    act(() => root.unmount());
  });

  it("dispositionCategory maps recovery and continuable to recovery", () => {
    expect(dispositionCategory({ kind: "recoverable_by_control_plane", recovery: "dispatch" })).toBe("recovery");
    expect(dispositionCategory({ kind: "agent_continuable", continuationAttempt: 1, maxAttempts: 2 })).toBe("recovery");
  });
});

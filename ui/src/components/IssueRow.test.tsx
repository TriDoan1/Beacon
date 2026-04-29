// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Issue } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueRow } from "./IssueRow";

vi.mock("@/lib/router", () => ({
  Link: ({
    children,
    className,
    disableIssueQuicklook: _disableIssueQuicklook,
    issuePrefetch,
    ...props
  }: React.ComponentProps<"a"> & { disableIssueQuicklook?: boolean; issuePrefetch?: Issue | null }) => (
    <a
      className={className}
      data-disable-issue-quicklook={_disableIssueQuicklook ? "true" : undefined}
      data-issue-prefetch-id={issuePrefetch?.id}
      {...props}
    >
      {children}
    </a>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function createIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    identifier: "PAP-1",
    companyId: "company-1",
    projectId: null,
    projectWorkspaceId: null,
    goalId: null,
    parentId: null,
    title: "Inbox item",
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 1,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    executionWorkspaceId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    createdAt: new Date("2026-03-11T00:00:00.000Z"),
    updatedAt: new Date("2026-03-11T00:00:00.000Z"),
    labels: [],
    labelIds: [],
    myLastTouchAt: null,
    lastExternalCommentAt: null,
    isUnreadForMe: false,
    ...overrides,
  };
}

describe("IssueRow", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("suppresses accent hover styling when the row is selected", () => {
    const root = createRoot(container);
    const issue = createIssue();

    act(() => {
      root.render(<IssueRow issue={issue} selected />);
    });

    const link = container.querySelector("[data-inbox-issue-link]") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.className).toContain("hover:bg-transparent");
    expect(link?.className).not.toContain("hover:bg-accent/50");

    act(() => {
      root.unmount();
    });
  });

  it("neutralizes selected status and unread dot accents", () => {
    const root = createRoot(container);

    act(() => {
      root.render(<IssueRow issue={createIssue()} selected unreadState="visible" />);
    });

    const markReadButton = container.querySelector('button[aria-label="Mark as read"]');
    const unreadDot = markReadButton?.querySelector("span");
    const statusIcon = container.querySelector('span[class*="border-muted-foreground"]');

    expect(markReadButton).not.toBeNull();
    expect(markReadButton?.className).toContain("hover:bg-muted/80");
    expect(markReadButton?.className).not.toContain("hover:bg-blue-500/20");
    expect(unreadDot).not.toBeNull();
    expect(unreadDot?.className).toContain("bg-muted-foreground/70");
    expect(unreadDot?.className).not.toContain("bg-blue-600");
    expect(statusIcon).not.toBeNull();
    expect(statusIcon?.className).toContain("!border-muted-foreground");
    expect(statusIcon?.className).toContain("!text-muted-foreground");

    act(() => {
      root.unmount();
    });
  });

  it("preserves the issue detail breadcrumb source and href in the link target", () => {
    const root = createRoot(container);
    const issue = createIssue();
    const state = {
      issueDetailBreadcrumb: { label: "Inbox", href: "/PAP/inbox/mine" },
      issueDetailSource: "inbox",
    };

    act(() => {
      root.render(<IssueRow issue={issue} issueLinkState={state} />);
    });

    const link = container.querySelector("[data-inbox-issue-link]") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute("to") ?? link?.getAttribute("href")).toBe("/issues/PAP-1");

    act(() => {
      root.unmount();
    });
  });

  it("opts issue quicklook out for dense inbox rows", () => {
    const root = createRoot(container);

    act(() => {
      root.render(<IssueRow issue={createIssue()} />);
    });

    const link = container.querySelector("[data-inbox-issue-link]") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.getAttribute("data-disable-issue-quicklook")).toBe("true");

    act(() => {
      root.unmount();
    });
  });

  it("passes the visible row issue into the navigation prefetch path", () => {
    const root = createRoot(container);

    act(() => {
      root.render(<IssueRow issue={createIssue()} />);
    });

    const link = container.querySelector("[data-inbox-issue-link]") as HTMLAnchorElement | null;
    expect(link?.getAttribute("data-issue-prefetch-id")).toBe("issue-1");

    act(() => {
      root.unmount();
    });
  });

  it("renders titleSuffix inline after the issue title", () => {
    const root = createRoot(container);
    const issue = createIssue({ title: "Parent task" });

    act(() => {
      root.render(
        <IssueRow
          issue={issue}
          titleSuffix={<span data-testid="suffix">(3 sub-tasks)</span>}
        />,
      );
    });

    const titleEl = container.querySelector(".line-clamp-2, .truncate");
    expect(titleEl?.textContent).toContain("Parent task");
    expect(titleEl?.textContent).toContain("(3 sub-tasks)");
    expect(container.querySelector('[data-testid="suffix"]')).not.toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("renders checklist step numbers beside the issue identifier", () => {
    const root = createRoot(container);

    act(() => {
      root.render(
        <IssueRow
          issue={createIssue({ identifier: "PAP-42" })}
          checklistStepNumber="2.1"
          mobileMeta="updated now"
        />,
      );
    });

    const link = container.querySelector("[data-inbox-issue-link]") as HTMLAnchorElement | null;
    const metaRow = Array.from(link?.querySelectorAll("span.flex.items-center.gap-2") ?? [])
      .find((element) => element.textContent?.includes("PAP-42"));

    expect(metaRow).not.toBeUndefined();
    expect(metaRow?.textContent?.replace(/\s+/g, "")).toContain("2.1.PAP-42");

    act(() => {
      root.unmount();
    });
  });

  it("renders the sky waiting pill with the resolved owner label when blockerAttention.reason is explicit_waiting", () => {
    const root = createRoot(container);
    const issue = createIssue({
      blockerAttention: {
        state: "covered",
        reason: "explicit_waiting",
        unresolvedBlockerCount: 0,
        coveredBlockerCount: 0,
        stalledBlockerCount: 0,
        attentionBlockerCount: 0,
        sampleBlockerIdentifier: null,
        sampleStalledBlockerIdentifier: null,
        nextActionOwner: { type: "user", agentId: null, userId: null },
        nextActionHint: "needs_human_review",
      },
    });

    act(() => {
      root.render(<IssueRow issue={issue} />);
    });

    const pills = Array.from(container.querySelectorAll<HTMLSpanElement>("span"))
      .filter(
        (element) => element.textContent === "Waiting · board"
          && element.className.includes("border-sky-200/80"),
      );
    expect(pills.length).toBeGreaterThan(0);
    expect(pills[0]?.getAttribute("title")).toBe("Waiting · board");

    act(() => {
      root.unmount();
    });
  });

  it("renders the disposition badge for live and invalid dispositions", () => {
    const root = createRoot(container);
    const liveIssue = createIssue({
      executionDisposition: { kind: "live", path: "active_run" },
    });
    act(() => {
      root.render(<IssueRow issue={liveIssue} />);
    });
    let badge = container.querySelector("[data-execution-disposition-kind]");
    expect(badge?.getAttribute("data-execution-disposition-category")).toBe("live");
    act(() => root.unmount());

    const root2 = createRoot(container);
    const stalledIssue = createIssue({
      status: "in_review",
      executionDisposition: {
        kind: "invalid",
        reason: "in_review_without_action_path",
        suggestedCorrection: "fix",
      },
    });
    act(() => {
      root2.render(<IssueRow issue={stalledIssue} />);
    });
    badge = container.querySelector("[data-execution-disposition-kind]");
    expect(badge?.getAttribute("data-execution-disposition-category")).toBe("invalid");
    expect(badge?.textContent).toContain("Stalled");
    act(() => root2.unmount());
  });

  it("hides the disposition badge when the explicit waiting pill already conveys the same signal", () => {
    const root = createRoot(container);
    const issue = createIssue({
      blockerAttention: {
        state: "covered",
        reason: "explicit_waiting",
        unresolvedBlockerCount: 0,
        coveredBlockerCount: 0,
        stalledBlockerCount: 0,
        attentionBlockerCount: 0,
        sampleBlockerIdentifier: null,
        sampleStalledBlockerIdentifier: null,
        nextActionOwner: { type: "user", agentId: null, userId: null },
        nextActionHint: "needs_human_review",
      },
      executionDisposition: { kind: "waiting", path: "interaction" },
    });
    act(() => {
      root.render(<IssueRow issue={issue} />);
    });
    const badge = container.querySelector("[data-execution-disposition-kind]");
    expect(badge).toBeNull();
    act(() => root.unmount());
  });

  it("renders without error when titleSuffix is omitted", () => {
    const root = createRoot(container);

    act(() => {
      root.render(<IssueRow issue={createIssue()} />);
    });

    const titleEl = container.querySelector(".line-clamp-2, .truncate");
    expect(titleEl?.textContent).toContain("Inbox item");

    act(() => {
      root.unmount();
    });
  });
});

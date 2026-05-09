import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import type { IssueRecoveryAction } from "@paperclipai/shared";
import { IssueRecoveryActionCard } from "@/components/IssueRecoveryActionCard";
import { IssueRow } from "@/components/IssueRow";
import { storybookAgentMap, storybookAgents, createIssue } from "../fixtures/paperclipData";

const claudeAgent = storybookAgents.find((agent) => agent.name.toLowerCase().startsWith("claude")) ?? storybookAgents[0]!;
const codexAgent = storybookAgents.find((agent) => agent.name.toLowerCase().startsWith("codex")) ?? storybookAgents[0]!;

function StoryFrame({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Source-issue recovery
          </div>
          <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </header>
        {children}
      </div>
    </main>
  );
}

function buildAction(overrides: Partial<IssueRecoveryAction> = {}): IssueRecoveryAction {
  return {
    id: "00000000-0000-0000-0000-0000000000aa",
    companyId: "company-storybook",
    sourceIssueId: "00000000-0000-0000-0000-0000000000ff",
    recoveryIssueId: null,
    kind: "missing_disposition",
    status: "active",
    ownerType: "agent",
    ownerAgentId: claudeAgent.id,
    ownerUserId: null,
    previousOwnerAgentId: codexAgent.id,
    returnOwnerAgentId: codexAgent.id,
    cause: "missing_disposition",
    fingerprint: "fp",
    evidence: {
      summary: "Run finished without picking a disposition. The PR has tests passing on CI.",
      sourceRunId: "7accd7a4-c9ca-4db2-9233-3228a037cc09",
      correctiveRunId: "2606404d-3859-4142-ba37-3228a037cc09",
    },
    nextAction: "Choose and record a valid issue disposition without copying transcript content.",
    wakePolicy: { type: "wake_owner" },
    monitorPolicy: null,
    attemptCount: 1,
    maxAttempts: 3,
    timeoutAt: null,
    lastAttemptAt: "2026-04-20T11:55:00.000Z",
    outcome: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: "2026-04-20T11:55:00.000Z",
    updatedAt: "2026-04-20T11:55:00.000Z",
    ...overrides,
  };
}

function CardPanel({ caption, action, forcedState, canCancelRecovery }: {
  caption: string;
  action: IssueRecoveryAction;
  forcedState?: React.ComponentProps<typeof IssueRecoveryActionCard>["forcedState"];
  canCancelRecovery?: boolean;
}) {
  return (
    <section className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {caption}
      </div>
      <IssueRecoveryActionCard
        action={action}
        agentMap={storybookAgentMap}
        forcedState={forcedState}
        onResolve={() => {}}
        canCancelRecovery={canCancelRecovery}
      />
    </section>
  );
}

function AllStatesPanel() {
  return (
    <div className="grid gap-5 lg:grid-cols-1">
      <CardPanel caption="State 1 · Recovery needed (default)" action={buildAction()} canCancelRecovery />
      <CardPanel
        caption="State 2 · Recovery in progress"
        action={buildAction({ outcome: "delegated", attemptCount: 2 })}
        forcedState="in_progress"
        canCancelRecovery
      />
      <CardPanel
        caption="State 3 · Observing active run (watchdog)"
        action={buildAction({
          kind: "active_run_watchdog",
          wakePolicy: { type: "monitor", intervalLabel: "in 4m" },
          evidence: { summary: "The active run has been silent for 7 minutes. Last log: 'continuing checks…'" },
          nextAction: "Observe the active run; intervene only if the silence persists past timeout.",
        })}
      />
      <CardPanel
        caption="State 4 · Recovery escalated"
        action={buildAction({
          status: "escalated",
          attemptCount: 3,
          wakePolicy: { type: "board_escalation" },
          evidence: {
            summary: "Three corrective wakes failed. The recovery owner has not produced a disposition.",
            sourceRunId: "7accd7a4-c9ca-4db2-9233-3228a037cc09",
          },
          nextAction: "Board operator: assign an invokable owner or record a manual resolution.",
        })}
        canCancelRecovery
      />
      <CardPanel
        caption="State 5 · Recovery resolved"
        action={buildAction({
          status: "resolved",
          outcome: "restored",
          resolvedAt: "2026-04-20T12:01:00.000Z",
          nextAction: "Issue restored to a valid disposition.",
        })}
      />
    </div>
  );
}

function InboxRowPanel() {
  const baseIssue = createIssue();
  return (
    <div className="rounded-lg border border-border/70 bg-background/80">
      <IssueRow
        issue={{
          ...baseIssue,
          identifier: "PAP-9065",
          title: "Add full company search page",
          status: "in_progress",
          activeRecoveryAction: buildAction(),
        }}
      />
      <IssueRow
        issue={{
          ...baseIssue,
          id: "issue-recovery-watch",
          identifier: "PAP-9099",
          title: "Watchdog: PR review pipeline silent",
          status: "in_progress",
          activeRecoveryAction: buildAction({ kind: "active_run_watchdog" }),
        }}
      />
      <IssueRow
        issue={{
          ...baseIssue,
          id: "issue-recovery-escalated",
          identifier: "PAP-9073",
          title: "Recovery escalated for stranded run",
          status: "blocked",
          activeRecoveryAction: buildAction({ status: "escalated" }),
        }}
      />
    </div>
  );
}

const meta = {
  title: "Paperclip/Source Issue Recovery",
  component: AllStatesPanel,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AllStatesPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const RecoveryActionCardStates: Story = {
  render: () => (
    <StoryFrame
      title="Recovery action card states"
      description="Five states required by the source-issue recovery contract: needed, in progress, observe-only watchdog, escalated, resolved."
    >
      <AllStatesPanel />
    </StoryFrame>
  ),
};

export const InboxRowChips: Story = {
  render: () => (
    <StoryFrame
      title="Inbox row recovery chips"
      description="Source rows expose recovery state inline; no synthetic sibling row appears for source-scoped recovery."
    >
      <InboxRowPanel />
    </StoryFrame>
  ),
};

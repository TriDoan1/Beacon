import type {
  IssueExecutionDisposition,
  IssueExecutionHumanEscalationOwner,
  IssueExecutionLivePath,
  IssueExecutionRecoveryKind,
  IssueExecutionWaitingPath,
} from "@paperclipai/shared";
import {
  AlertOctagon,
  AlertTriangle,
  CircleDashed,
  Hourglass,
  Lock,
  Play,
  Wrench,
} from "lucide-react";
import { cn } from "../lib/utils";

export type IssueDispositionCategory =
  | "live"
  | "dispatchable"
  | "waiting"
  | "blocked_chain"
  | "recovery"
  | "needs_attention"
  | "invalid"
  | "terminal"
  | "resting";

const CATEGORY_LABEL: Record<IssueDispositionCategory, string> = {
  live: "Live",
  dispatchable: "Ready",
  waiting: "Waiting",
  blocked_chain: "Blocked",
  recovery: "Recovery",
  needs_attention: "Needs attention",
  invalid: "Stalled",
  terminal: "Done",
  resting: "Resting",
};

const LIVE_PATH_LABEL: Record<IssueExecutionLivePath, string> = {
  active_run: "Active run",
  queued_wake: "Queued wake",
  scheduled_retry: "Scheduled retry",
  deferred_execution: "Deferred execution",
};

const WAITING_PATH_LABEL: Record<IssueExecutionWaitingPath, string> = {
  participant: "Review participant",
  interaction: "Interaction response",
  approval: "Board approval",
  human_owner: "Human owner",
  blocker_chain: "Blocker chain",
  pause_hold: "Tree paused",
  review_artifact: "Recovery work",
  external_owner_action: "External owner",
};

const RECOVERY_LABEL: Record<IssueExecutionRecoveryKind, string> = {
  dispatch: "Awaiting dispatch repair",
  continuation: "Awaiting continuation",
  repair_wait: "Repairing wait state",
};

const ESCALATION_LABEL: Record<IssueExecutionHumanEscalationOwner, string> = {
  board: "Needs board",
  manager: "Needs manager",
  recovery_owner: "Needs recovery owner",
  external: "Needs external owner",
};

export function dispositionCategory(
  disposition: IssueExecutionDisposition | null | undefined,
): IssueDispositionCategory | null {
  if (!disposition) return null;
  switch (disposition.kind) {
    case "terminal":
      return "terminal";
    case "resting":
      return "resting";
    case "live":
      return "live";
    case "dispatchable":
      return "dispatchable";
    case "waiting":
      return disposition.path === "blocker_chain" ? "blocked_chain" : "waiting";
    case "recoverable_by_control_plane":
    case "agent_continuable":
      return "recovery";
    case "human_escalation_required":
      return "needs_attention";
    case "invalid":
      return "invalid";
    default:
      return null;
  }
}

export function dispositionDetailLabel(
  disposition: IssueExecutionDisposition | null | undefined,
): string | null {
  if (!disposition) return null;
  switch (disposition.kind) {
    case "live":
      return LIVE_PATH_LABEL[disposition.path];
    case "waiting":
      return WAITING_PATH_LABEL[disposition.path];
    case "recoverable_by_control_plane":
      return RECOVERY_LABEL[disposition.recovery];
    case "agent_continuable":
      return `Continuation ${disposition.continuationAttempt}/${disposition.maxAttempts}`;
    case "human_escalation_required":
      return ESCALATION_LABEL[disposition.owner];
    case "invalid":
      return invalidReasonLabel(disposition.reason);
    default:
      return null;
  }
}

function invalidReasonLabel(reason: string): string {
  switch (reason) {
    case "in_review_without_action_path":
      return "Review without action path";
    case "invalid_review_participant":
      return "Invalid review participant";
    case "blocked_by_invalid_issue":
      return "Blocked by invalid issue";
    case "blocked_by_cancelled_issue":
      return "Blocked by cancelled issue";
    case "blocked_by_unassigned_issue":
      return "Blocked by unassigned issue";
    case "blocked_by_resting_issue":
      return "Blocked by resting issue";
    case "blocked_without_action_path":
      return "Blocked without action path";
    case "dual_assignee":
      return "Dual assignee";
    default:
      return reason.replace(/_/g, " ");
  }
}

const CATEGORY_PILL: Record<IssueDispositionCategory, string> = {
  live: "border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200",
  dispatchable: "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200",
  waiting: "border-sky-300/70 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200",
  blocked_chain: "border-amber-300/70 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
  recovery: "border-rose-300/70 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200",
  needs_attention: "border-rose-300/70 bg-rose-50 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200",
  invalid: "border-rose-400/80 bg-rose-100 text-rose-900 dark:border-rose-500/60 dark:bg-rose-500/20 dark:text-rose-100",
  terminal: "border-border bg-muted text-muted-foreground",
  resting: "border-border bg-muted text-muted-foreground",
};

const CATEGORY_ICON: Record<IssueDispositionCategory, React.ComponentType<{ className?: string }>> = {
  live: Play,
  dispatchable: Play,
  waiting: Hourglass,
  blocked_chain: Lock,
  recovery: Wrench,
  needs_attention: AlertTriangle,
  invalid: AlertOctagon,
  terminal: CircleDashed,
  resting: CircleDashed,
};

export interface IssueDispositionBadgeProps {
  disposition: IssueExecutionDisposition | null | undefined;
  className?: string;
  hideLabel?: boolean;
  hideForResting?: boolean;
  hideForTerminal?: boolean;
}

export function IssueDispositionBadge({
  disposition,
  className,
  hideLabel = false,
  hideForResting = true,
  hideForTerminal = true,
}: IssueDispositionBadgeProps) {
  const category = dispositionCategory(disposition);
  if (!category) return null;
  if (hideForResting && category === "resting") return null;
  if (hideForTerminal && category === "terminal") return null;

  const detail = dispositionDetailLabel(disposition);
  const label = CATEGORY_LABEL[category];
  const Icon = CATEGORY_ICON[category];
  const tooltip = detail ? `${label} · ${detail}` : label;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        CATEGORY_PILL[category],
        className,
      )}
      title={tooltip}
      data-execution-disposition-kind={disposition?.kind}
      data-execution-disposition-category={category}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {hideLabel ? null : <span>{label}</span>}
    </span>
  );
}

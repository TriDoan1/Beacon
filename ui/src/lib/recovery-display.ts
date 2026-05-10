import type { IssueRecoveryAction } from "@paperclipai/shared";

export type RecoveryDisplayState =
  | "needed"
  | "in_progress"
  | "observe_only"
  | "escalated"
  | "resolved";

export type ActiveRecoveryDisplayState = Exclude<RecoveryDisplayState, "resolved">;

export function deriveRecoveryDisplayState(
  action: Pick<IssueRecoveryAction, "status" | "kind" | "outcome">,
): RecoveryDisplayState {
  if (action.status === "resolved") return "resolved";
  if (action.status === "escalated") return "escalated";
  if (action.status === "cancelled") return "resolved";
  if (action.kind === "active_run_watchdog") return "observe_only";
  if (action.outcome === "delegated") return "in_progress";
  return "needed";
}

export function deriveActiveRecoveryDisplayState(
  action: Pick<IssueRecoveryAction, "status" | "kind" | "outcome">,
): ActiveRecoveryDisplayState | null {
  const state = deriveRecoveryDisplayState(action);
  return state === "resolved" ? null : state;
}

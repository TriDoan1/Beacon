import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentWakeupRequests,
  agents,
  approvals,
  heartbeatRuns,
  issueApprovals,
  issueRelations,
  issueThreadInteractions,
  issues,
} from "@paperclipai/db";
import type { IssueExecutionDisposition } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";
import {
  classifyIssueExecutionDisposition,
  type IssueExecutionParticipantState,
  type IssueExecutionStateVector,
} from "./issue-execution-disposition.js";
import { parseIssueExecutionState } from "./issue-execution-policy.js";
import {
  isLiveExplicitApprovalWaitingPath,
  isLiveExplicitInteractionWaitingPath,
} from "./recovery/explicit-waiting-paths.js";

const ACTIVE_RUN_STATUSES = ["queued", "running"] as const;
const SCHEDULED_RETRY_RUN_STATUSES = ["scheduled_retry"] as const;
const ACTIVE_WAKE_STATUSES = ["queued", "deferred_issue_execution"] as const;
const PENDING_INTERACTION_STATUSES = ["pending"] as const;
const WAITING_INTERACTION_KINDS = ["request_confirmation", "ask_user_questions"] as const;
const PENDING_APPROVAL_STATUSES = ["pending", "revision_requested"] as const;
const OPEN_RECOVERY_ORIGIN_KINDS = ["harness_liveness_escalation", "stranded_issue_recovery"] as const;
const OPEN_RECOVERY_TERMINAL_STATUSES = ["done", "cancelled"] as const;

type DbReader = Pick<Db, "select">;
type IssueRow = typeof issues.$inferSelect;

export type IssueTransitionGuardSource = "create" | "update";

function isValidParticipant(participant: unknown) {
  if (!participant || typeof participant !== "object") return false;
  const value = participant as Record<string, unknown>;
  if (value.type === "agent") return typeof value.agentId === "string" && value.agentId.length > 0;
  if (value.type === "user") return typeof value.userId === "string" && value.userId.length > 0;
  return false;
}

function isGuardedStatus(status: string | null | undefined) {
  return status === "in_progress" || status === "in_review" || status === "blocked";
}

function invalidMessage(disposition: Extract<IssueExecutionDisposition, { kind: "invalid" }>) {
  return `Invalid issue transition: ${disposition.reason}`;
}

async function buildIssueExecutionStateVector(
  dbOrTx: DbReader,
  issue: IssueRow,
): Promise<IssueExecutionStateVector> {
  const [agent] = issue.assigneeAgentId
    ? await dbOrTx
        .select({
          id: agents.id,
          status: agents.status,
        })
        .from(agents)
        .where(and(eq(agents.companyId, issue.companyId), eq(agents.id, issue.assigneeAgentId)))
    : [];

  const [executionRun] = issue.executionRunId
    ? await dbOrTx
        .select({ status: heartbeatRuns.status })
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, issue.companyId), eq(heartbeatRuns.id, issue.executionRunId)))
    : [];

  const [queuedWake] = await dbOrTx
    .select({
      issueId: sql<string | null>`${agentWakeupRequests.payload} ->> 'issueId'`,
      status: agentWakeupRequests.status,
    })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.companyId, issue.companyId),
        inArray(agentWakeupRequests.status, [...ACTIVE_WAKE_STATUSES]),
        sql`${agentWakeupRequests.runId} is null`,
        eq(sql<string>`${agentWakeupRequests.payload} ->> 'issueId'`, issue.id),
      ),
    )
    .orderBy(desc(agentWakeupRequests.createdAt), desc(agentWakeupRequests.id))
    .limit(1);

  const executionState = parseIssueExecutionState(issue.executionState);
  let participant: IssueExecutionParticipantState = "none";
  if (executionState?.status === "pending") {
    participant = isValidParticipant(executionState.currentParticipant) ? "valid" : "invalid";
  }

  let pendingInteraction: "none" | "live" = "none";
  const interactionRows: Array<{
    issueId: string;
    companyId: string;
    status: string;
    kind: string;
    createdByUserId: string | null;
    createdAt: Date;
  }> = await dbOrTx
    .select({
      issueId: issueThreadInteractions.issueId,
      companyId: issueThreadInteractions.companyId,
      status: issueThreadInteractions.status,
      kind: issueThreadInteractions.kind,
      createdByUserId: issueThreadInteractions.createdByUserId,
      createdAt: issueThreadInteractions.createdAt,
    })
    .from(issueThreadInteractions)
    .where(
      and(
        eq(issueThreadInteractions.companyId, issue.companyId),
        eq(issueThreadInteractions.issueId, issue.id),
        inArray(issueThreadInteractions.status, [...PENDING_INTERACTION_STATUSES]),
        inArray(issueThreadInteractions.kind, [...WAITING_INTERACTION_KINDS]),
      ),
    );
  for (const row of interactionRows) {
    if (isLiveExplicitInteractionWaitingPath(issue, row)) {
      pendingInteraction = "live";
      break;
    }
  }

  let pendingApproval: "none" | "live" = "none";
  const approvalRows: Array<{
    issueId: string;
    companyId: string;
    status: string;
    requestedByUserId: string | null;
    linkedByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    linkedAt: Date;
  }> = await dbOrTx
    .select({
      issueId: issueApprovals.issueId,
      companyId: issueApprovals.companyId,
      status: approvals.status,
      requestedByUserId: approvals.requestedByUserId,
      linkedByUserId: issueApprovals.linkedByUserId,
      createdAt: approvals.createdAt,
      updatedAt: approvals.updatedAt,
      linkedAt: issueApprovals.createdAt,
    })
    .from(issueApprovals)
    .innerJoin(approvals, eq(issueApprovals.approvalId, approvals.id))
    .where(
      and(
        eq(issueApprovals.companyId, issue.companyId),
        eq(issueApprovals.issueId, issue.id),
        inArray(approvals.status, [...PENDING_APPROVAL_STATUSES]),
      ),
    );
  for (const row of approvalRows) {
    if (isLiveExplicitApprovalWaitingPath(issue, row)) {
      pendingApproval = "live";
      break;
    }
  }

  const recoveryRows: Array<{ id: string }> = await dbOrTx
    .select({ id: issues.id })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, issue.companyId),
        inArray(issues.originKind, [...OPEN_RECOVERY_ORIGIN_KINDS]),
        eq(issues.originId, issue.id),
        isNull(issues.hiddenAt),
        notInArray(issues.status, [...OPEN_RECOVERY_TERMINAL_STATUSES]),
      ),
    )
    .limit(1);

  const blockerRows: Array<{
    id: string;
    status: string;
    assigneeAgentId: string | null;
    assigneeUserId: string | null;
    originKind: string | null;
  }> = await dbOrTx
    .select({
      id: issues.id,
      status: issues.status,
      assigneeAgentId: issues.assigneeAgentId,
      assigneeUserId: issues.assigneeUserId,
      originKind: issues.originKind,
    })
    .from(issueRelations)
    .innerJoin(issues, eq(issueRelations.issueId, issues.id))
    .where(
      and(
        eq(issueRelations.companyId, issue.companyId),
        eq(issueRelations.relatedIssueId, issue.id),
        eq(issueRelations.type, "blocks"),
        eq(issues.companyId, issue.companyId),
      ),
    );

  return {
    issue: {
      id: issue.id,
      status: issue.status as IssueExecutionStateVector["issue"]["status"],
      assigneeAgentId: issue.assigneeAgentId,
      assigneeUserId: issue.assigneeUserId,
      originKind: issue.originKind,
    },
    agent: agent
      ? {
          id: agent.id,
          status: agent.status,
        }
      : null,
    execution: {
      activeRun: executionRun ? (ACTIVE_RUN_STATUSES as readonly string[]).includes(executionRun.status) : false,
      scheduledRetry: executionRun
        ? (SCHEDULED_RETRY_RUN_STATUSES as readonly string[]).includes(executionRun.status)
        : false,
      queuedWake: queuedWake?.status === "queued",
      deferredExecution: queuedWake?.status === "deferred_issue_execution",
    },
    waits: {
      participant,
      pendingInteraction,
      pendingApproval,
      openRecoveryIssue: recoveryRows.length > 0 ||
        blockerRows.some((blocker) =>
          (OPEN_RECOVERY_ORIGIN_KINDS as readonly string[]).includes(blocker.originKind ?? "")
        ),
    },
    blockers: blockerRows.map((blocker) => ({
      issue: {
        id: blocker.id,
        status: blocker.status as IssueExecutionStateVector["issue"]["status"],
        assigneeAgentId: blocker.assigneeAgentId,
        assigneeUserId: blocker.assigneeUserId,
      },
    })),
  };
}

export async function assertIssueTransitionAllowed(input: {
  db: DbReader;
  issue: IssueRow;
  source: IssueTransitionGuardSource;
  statusTouched?: boolean;
  assigneeTouched?: boolean;
  blockerTouched?: boolean;
  executionStateTouched?: boolean;
}) {
  const shouldGuard =
    isGuardedStatus(input.issue.status) &&
    (input.source === "create" ||
      input.statusTouched ||
      input.assigneeTouched ||
      input.blockerTouched ||
      input.executionStateTouched);
  if (!shouldGuard) return;

  const stateVector = await buildIssueExecutionStateVector(input.db, input.issue);
  const disposition = classifyIssueExecutionDisposition(stateVector);
  if (disposition.kind !== "invalid") return;

  throw unprocessable(invalidMessage(disposition), {
    disposition,
    suggestedCorrection: disposition.suggestedCorrection,
  });
}

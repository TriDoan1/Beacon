import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  heartbeatRuns,
  issueTreeHoldMembers,
  issueTreeHolds,
  issues,
} from "@paperclipai/db";
import {
  ISSUE_STATUSES,
  type IssueStatus,
  type IssueTreeControlMode,
  type IssueTreeControlPreview,
  type IssueTreeHold,
  type IssueTreeHoldMember,
  type IssueTreeHoldReleasePolicy,
  type IssueTreePreviewAgent,
  type IssueTreePreviewIssue,
  type IssueTreePreviewRun,
  type IssueTreePreviewWarning,
} from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";

type IssueRow = typeof issues.$inferSelect;
type HoldRow = typeof issueTreeHolds.$inferSelect;
type HoldMemberRow = typeof issueTreeHoldMembers.$inferSelect;
type ActorInput = {
  actorType: "user" | "agent" | "system";
  actorId: string;
  agentId?: string | null;
  userId?: string | null;
  runId?: string | null;
};
type TreeIssue = IssueRow & { depth: number };
type ActiveRunRow = {
  id: string;
  issueId: string;
  agentId: string;
  status: "queued" | "running";
  startedAt: Date | null;
  createdAt: Date;
};

const TERMINAL_ISSUE_STATUSES = new Set<IssueStatus>(["done", "cancelled"]);
const ACTIVE_RUN_STATUSES = ["queued", "running"] as const;
const DEFAULT_RELEASE_POLICY: IssueTreeHoldReleasePolicy = { strategy: "manual" };

function normalizeReleasePolicy(
  releasePolicy: IssueTreeHoldReleasePolicy | null | undefined,
): IssueTreeHoldReleasePolicy {
  return releasePolicy ?? DEFAULT_RELEASE_POLICY;
}

function coerceIssueStatus(status: string): IssueStatus {
  return ISSUE_STATUSES.includes(status as IssueStatus) ? (status as IssueStatus) : "backlog";
}

function isTerminalIssue(status: string): status is IssueStatus {
  return TERMINAL_ISSUE_STATUSES.has(coerceIssueStatus(status));
}

function toPreviewRun(row: ActiveRunRow): IssueTreePreviewRun {
  return {
    id: row.id,
    issueId: row.issueId,
    agentId: row.agentId,
    status: row.status,
    startedAt: row.startedAt,
    createdAt: row.createdAt,
  };
}

function toHold(row: HoldRow, members?: HoldMemberRow[]): IssueTreeHold {
  return {
    id: row.id,
    companyId: row.companyId,
    rootIssueId: row.rootIssueId,
    mode: row.mode as IssueTreeControlMode,
    status: row.status as IssueTreeHold["status"],
    reason: row.reason,
    releasePolicy: (row.releasePolicy as IssueTreeHoldReleasePolicy | null) ?? null,
    createdByActorType: row.createdByActorType as IssueTreeHold["createdByActorType"],
    createdByAgentId: row.createdByAgentId,
    createdByUserId: row.createdByUserId,
    createdByRunId: row.createdByRunId,
    releasedAt: row.releasedAt,
    releasedByActorType: row.releasedByActorType as IssueTreeHold["releasedByActorType"],
    releasedByAgentId: row.releasedByAgentId,
    releasedByUserId: row.releasedByUserId,
    releasedByRunId: row.releasedByRunId,
    releaseReason: row.releaseReason,
    releaseMetadata: row.releaseMetadata ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(members ? { members: members.map(toHoldMember) } : {}),
  };
}

function toHoldMember(row: HoldMemberRow): IssueTreeHoldMember {
  return {
    id: row.id,
    companyId: row.companyId,
    holdId: row.holdId,
    issueId: row.issueId,
    parentIssueId: row.parentIssueId,
    depth: row.depth,
    issueIdentifier: row.issueIdentifier,
    issueTitle: row.issueTitle,
    issueStatus: coerceIssueStatus(row.issueStatus),
    assigneeAgentId: row.assigneeAgentId,
    assigneeUserId: row.assigneeUserId,
    activeRunId: row.activeRunId,
    activeRunStatus: row.activeRunStatus,
    skipped: row.skipped,
    skipReason: row.skipReason,
    createdAt: row.createdAt,
  };
}

function issueSkipReason(input: {
  mode: IssueTreeControlMode;
  issue: TreeIssue;
  activePauseHoldIds: string[];
}): string | null {
  const status = coerceIssueStatus(input.issue.status);
  if (input.mode === "restore") {
    return status === "cancelled" ? null : "not_cancelled";
  }
  if (isTerminalIssue(status)) {
    return "terminal_status";
  }
  if (input.mode === "pause" && input.activePauseHoldIds.length > 0) {
    return "already_held";
  }
  if (input.mode === "resume" && input.activePauseHoldIds.length === 0) {
    return "not_held";
  }
  return null;
}

function buildAffectedAgents(issuesToPreview: IssueTreePreviewIssue[]): IssueTreePreviewAgent[] {
  const byAgentId = new Map<string, IssueTreePreviewAgent>();
  for (const issue of issuesToPreview) {
    if (issue.skipped) continue;
    const agentIds = new Set<string>();
    if (issue.assigneeAgentId) agentIds.add(issue.assigneeAgentId);
    if (issue.activeRun) agentIds.add(issue.activeRun.agentId);
    for (const agentId of agentIds) {
      const current = byAgentId.get(agentId) ?? { agentId, issueCount: 0, activeRunCount: 0 };
      current.issueCount += 1;
      if (issue.activeRun?.agentId === agentId) current.activeRunCount += 1;
      byAgentId.set(agentId, current);
    }
  }
  return [...byAgentId.values()].sort((a, b) => a.agentId.localeCompare(b.agentId));
}

function buildWarnings(input: {
  mode: IssueTreeControlMode;
  issuesToPreview: IssueTreePreviewIssue[];
  activeRuns: IssueTreePreviewRun[];
}): IssueTreePreviewWarning[] {
  const affectedIssues = input.issuesToPreview.filter((issue) => !issue.skipped);
  const affectedIssueIds = new Set(affectedIssues.map((issue) => issue.id));
  const affectedRuns = input.activeRuns.filter((run) => affectedIssueIds.has(run.issueId));
  const warnings: IssueTreePreviewWarning[] = [];

  if (affectedIssues.length === 0) {
    warnings.push({
      code: "no_affected_issues",
      message: "No issues in this subtree match the requested control action.",
    });
  }

  const runningRunIssueIds = affectedRuns
    .filter((run) => run.status === "running")
    .map((run) => run.issueId);
  if ((input.mode === "pause" || input.mode === "cancel") && runningRunIssueIds.length > 0) {
    warnings.push({
      code: "running_runs_present",
      message: "Some affected issues have running heartbeat runs.",
      issueIds: [...new Set(runningRunIssueIds)].sort(),
    });
  }

  const queuedRunIssueIds = affectedRuns
    .filter((run) => run.status === "queued")
    .map((run) => run.issueId);
  if ((input.mode === "pause" || input.mode === "cancel") && queuedRunIssueIds.length > 0) {
    warnings.push({
      code: "queued_runs_present",
      message: "Some affected issues have queued heartbeat runs.",
      issueIds: [...new Set(queuedRunIssueIds)].sort(),
    });
  }

  if (input.mode === "resume" && affectedIssues.length === 0) {
    warnings.push({
      code: "no_active_pause_holds",
      message: "No active pause holds were found in this subtree.",
    });
  }

  return warnings;
}

export function issueTreeControlService(db: Db) {
  async function listTreeIssues(companyId: string, rootIssueId: string): Promise<TreeIssue[]> {
    const root = await db
      .select()
      .from(issues)
      .where(and(eq(issues.id, rootIssueId), eq(issues.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!root) {
      throw notFound("Root issue not found");
    }

    const result: TreeIssue[] = [{ ...root, depth: 0 }];
    const visited = new Set<string>([root.id]);
    let frontier = [{ id: root.id, depth: 0 }];

    while (frontier.length > 0) {
      const parentIds = frontier.map((item) => item.id);
      const depthByParentId = new Map(frontier.map((item) => [item.id, item.depth]));
      const children = await db
        .select()
        .from(issues)
        .where(and(eq(issues.companyId, companyId), inArray(issues.parentId, parentIds)))
        .orderBy(asc(issues.createdAt), asc(issues.id));

      const nextFrontier: typeof frontier = [];
      for (const child of children) {
        if (visited.has(child.id)) continue;
        const depth = (depthByParentId.get(child.parentId ?? "") ?? 0) + 1;
        visited.add(child.id);
        result.push({ ...child, depth });
        nextFrontier.push({ id: child.id, depth });
      }
      frontier = nextFrontier;
    }

    return result;
  }

  async function activeRunsByIssueId(companyId: string, treeIssues: TreeIssue[]) {
    const runIds = treeIssues
      .map((issue) => issue.executionRunId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const byIssueId = new Map<string, ActiveRunRow>();
    if (runIds.length === 0) return byIssueId;

    const rows = await db
      .select({
        id: heartbeatRuns.id,
        agentId: heartbeatRuns.agentId,
        status: heartbeatRuns.status,
        startedAt: heartbeatRuns.startedAt,
        createdAt: heartbeatRuns.createdAt,
      })
      .from(heartbeatRuns)
      .where(
        and(
          eq(heartbeatRuns.companyId, companyId),
          inArray(heartbeatRuns.id, [...new Set(runIds)]),
          inArray(heartbeatRuns.status, [...ACTIVE_RUN_STATUSES]),
        ),
      );
    const runById = new Map<string, typeof rows[number]>();
    for (const row of rows) {
      if (row.status === "queued" || row.status === "running") {
        runById.set(row.id, row);
      }
    }
    for (const issue of treeIssues) {
      if (!issue.executionRunId) continue;
      const run = runById.get(issue.executionRunId);
      if (!run) continue;
      const status = run.status === "queued" || run.status === "running" ? run.status : null;
      if (!status) continue;
      byIssueId.set(issue.id, {
        id: run.id,
        issueId: issue.id,
        agentId: run.agentId,
        status,
        startedAt: run.startedAt,
        createdAt: run.createdAt,
      });
    }
    return byIssueId;
  }

  async function activeHoldsByIssueId(companyId: string, issueIds: string[]) {
    const byIssueId = new Map<string, { all: string[]; pause: string[] }>();
    if (issueIds.length === 0) return byIssueId;
    const rows = await db
      .select({
        issueId: issueTreeHoldMembers.issueId,
        holdId: issueTreeHolds.id,
        mode: issueTreeHolds.mode,
      })
      .from(issueTreeHoldMembers)
      .innerJoin(issueTreeHolds, eq(issueTreeHoldMembers.holdId, issueTreeHolds.id))
      .where(
        and(
          eq(issueTreeHoldMembers.companyId, companyId),
          eq(issueTreeHolds.status, "active"),
          inArray(issueTreeHoldMembers.issueId, issueIds),
        ),
      )
      .orderBy(asc(issueTreeHolds.createdAt), asc(issueTreeHolds.id));

    for (const row of rows) {
      const current = byIssueId.get(row.issueId) ?? { all: [], pause: [] };
      current.all.push(row.holdId);
      if (row.mode === "pause") current.pause.push(row.holdId);
      byIssueId.set(row.issueId, current);
    }
    return byIssueId;
  }

  async function preview(
    companyId: string,
    rootIssueId: string,
    input: {
      mode: IssueTreeControlMode;
      releasePolicy?: IssueTreeHoldReleasePolicy | null;
    },
  ): Promise<IssueTreeControlPreview> {
    const treeIssues = await listTreeIssues(companyId, rootIssueId);
    const issueIds = treeIssues.map((issue) => issue.id);
    const [runsByIssueId, holdsByIssueId] = await Promise.all([
      activeRunsByIssueId(companyId, treeIssues),
      activeHoldsByIssueId(companyId, issueIds),
    ]);
    const countsByStatus: Partial<Record<IssueStatus, number>> = {};

    const issuesToPreview = treeIssues.map((issue) => {
      const status = coerceIssueStatus(issue.status);
      countsByStatus[status] = (countsByStatus[status] ?? 0) + 1;
      const holdState = holdsByIssueId.get(issue.id) ?? { all: [], pause: [] };
      const skipReason = issueSkipReason({
        mode: input.mode,
        issue,
        activePauseHoldIds: holdState.pause,
      });
      const run = runsByIssueId.get(issue.id);
      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        status,
        parentId: issue.parentId,
        depth: issue.depth,
        assigneeAgentId: issue.assigneeAgentId,
        assigneeUserId: issue.assigneeUserId,
        activeRun: run ? toPreviewRun(run) : null,
        activeHoldIds: holdState.all,
        action: input.mode,
        skipped: skipReason !== null,
        skipReason,
      } satisfies IssueTreePreviewIssue;
    });
    const skippedIssues = issuesToPreview.filter((issue) => issue.skipped);
    const activeRuns = [...runsByIssueId.values()]
      .map(toPreviewRun)
      .sort((a, b) => a.issueId.localeCompare(b.issueId) || a.id.localeCompare(b.id));
    const affectedAgents = buildAffectedAgents(issuesToPreview);

    return {
      companyId,
      rootIssueId,
      mode: input.mode,
      generatedAt: new Date(),
      releasePolicy: normalizeReleasePolicy(input.releasePolicy),
      totals: {
        totalIssues: issuesToPreview.length,
        affectedIssues: issuesToPreview.length - skippedIssues.length,
        skippedIssues: skippedIssues.length,
        activeRuns: activeRuns.filter((run) => run.status === "running").length,
        queuedRuns: activeRuns.filter((run) => run.status === "queued").length,
        affectedAgents: affectedAgents.length,
      },
      countsByStatus,
      issues: issuesToPreview,
      skippedIssues,
      activeRuns,
      affectedAgents,
      warnings: buildWarnings({ mode: input.mode, issuesToPreview, activeRuns }),
    };
  }

  async function createHold(
    companyId: string,
    rootIssueId: string,
    input: {
      mode: IssueTreeControlMode;
      reason?: string | null;
      releasePolicy?: IssueTreeHoldReleasePolicy | null;
      actor: ActorInput;
    },
  ) {
    const holdReleasePolicy = normalizeReleasePolicy(input.releasePolicy);
    const holdPreview = await preview(companyId, rootIssueId, {
      mode: input.mode,
      releasePolicy: holdReleasePolicy,
    });

    const { hold, members } = await db.transaction(async (tx) => {
      const [createdHold] = await tx
        .insert(issueTreeHolds)
        .values({
          companyId,
          rootIssueId,
          mode: input.mode,
          status: "active",
          reason: input.reason ?? null,
          releasePolicy: holdReleasePolicy as unknown as Record<string, unknown>,
          createdByActorType: input.actor.actorType,
          createdByAgentId: input.actor.agentId ?? null,
          createdByUserId: input.actor.userId ?? (input.actor.actorType === "user" ? input.actor.actorId : null),
          createdByRunId: input.actor.runId ?? null,
        })
        .returning();

      const memberRows = holdPreview.issues.map((issue) => ({
        companyId,
        holdId: createdHold.id,
        issueId: issue.id,
        parentIssueId: issue.parentId,
        depth: issue.depth,
        issueIdentifier: issue.identifier,
        issueTitle: issue.title,
        issueStatus: issue.status,
        assigneeAgentId: issue.assigneeAgentId,
        assigneeUserId: issue.assigneeUserId,
        activeRunId: issue.activeRun?.id ?? null,
        activeRunStatus: issue.activeRun?.status ?? null,
        skipped: issue.skipped,
        skipReason: issue.skipReason,
      }));

      const createdMembers = memberRows.length > 0
        ? await tx.insert(issueTreeHoldMembers).values(memberRows).returning()
        : [];

      return { hold: createdHold, members: createdMembers };
    });

    return {
      hold: toHold(hold, members),
      preview: holdPreview,
    };
  }

  async function getHold(companyId: string, holdId: string) {
    const hold = await db
      .select()
      .from(issueTreeHolds)
      .where(and(eq(issueTreeHolds.id, holdId), eq(issueTreeHolds.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!hold) return null;
    const members = await db
      .select()
      .from(issueTreeHoldMembers)
      .where(and(eq(issueTreeHoldMembers.companyId, companyId), eq(issueTreeHoldMembers.holdId, holdId)))
      .orderBy(asc(issueTreeHoldMembers.depth), asc(issueTreeHoldMembers.createdAt), asc(issueTreeHoldMembers.issueId));
    return toHold(hold, members);
  }

  async function releaseHold(
    companyId: string,
    rootIssueId: string,
    holdId: string,
    input: {
      reason?: string | null;
      releasePolicy?: IssueTreeHoldReleasePolicy | null;
      metadata?: Record<string, unknown> | null;
      actor: ActorInput;
    },
  ) {
    const existing = await db
      .select()
      .from(issueTreeHolds)
      .where(and(eq(issueTreeHolds.id, holdId), eq(issueTreeHolds.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!existing) throw notFound("Issue tree hold not found");
    if (existing.rootIssueId !== rootIssueId) {
      throw unprocessable("Issue tree hold does not belong to the requested root issue");
    }
    if (existing.status === "released") {
      throw conflict("Issue tree hold is already released");
    }

    const [updated] = await db
      .update(issueTreeHolds)
      .set({
        status: "released",
        releasedAt: new Date(),
        releasedByActorType: input.actor.actorType,
        releasedByAgentId: input.actor.agentId ?? null,
        releasedByUserId: input.actor.userId ?? (input.actor.actorType === "user" ? input.actor.actorId : null),
        releasedByRunId: input.actor.runId ?? null,
        releaseReason: input.reason ?? null,
        releasePolicy: input.releasePolicy
          ? (normalizeReleasePolicy(input.releasePolicy) as unknown as Record<string, unknown>)
          : existing.releasePolicy,
        releaseMetadata: input.metadata ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(issueTreeHolds.id, holdId), eq(issueTreeHolds.companyId, companyId)))
      .returning();

    const members = await db
      .select()
      .from(issueTreeHoldMembers)
      .where(and(eq(issueTreeHoldMembers.companyId, companyId), eq(issueTreeHoldMembers.holdId, holdId)))
      .orderBy(asc(issueTreeHoldMembers.depth), asc(issueTreeHoldMembers.createdAt), asc(issueTreeHoldMembers.issueId));

    return toHold(updated, members);
  }

  return {
    listTreeIssues,
    preview,
    createHold,
    getHold,
    releaseHold,
  };
}

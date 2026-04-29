import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueService } from "../services/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue transition guard tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("issue transition guard", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-issue-transition-guard-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompanyAndAgents() {
    const companyId = randomUUID();
    const coderAgentId = randomUUID();
    const reviewerAgentId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: coderAgentId,
        companyId,
        name: "CodexCoder",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: reviewerAgentId,
        companyId,
        name: "Reviewer",
        role: "qa",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    return { companyId, coderAgentId, reviewerAgentId };
  }

  it("rejects bare agent-owned in_review creates", async () => {
    const { companyId, coderAgentId } = await seedCompanyAndAgents();
    const svc = issueService(db);

    await expect(
      svc.create(companyId, {
        title: "Bare review",
        status: "in_review",
        assigneeAgentId: coderAgentId,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: "Invalid issue transition: in_review_without_action_path",
    });
  });

  it("rejects blocked updates without blockers or a wait path", async () => {
    const { companyId, coderAgentId } = await seedCompanyAndAgents();
    const svc = issueService(db);
    const issue = await svc.create(companyId, {
      title: "Needs a real blocker",
      status: "todo",
      assigneeAgentId: coderAgentId,
    });

    await expect(svc.update(issue.id, { status: "blocked" })).rejects.toMatchObject({
      status: 422,
      message: "Invalid issue transition: blocked_without_action_path",
    });
  });

  it("accepts blocked writes with a healthy first-class blocker chain", async () => {
    const { companyId, coderAgentId } = await seedCompanyAndAgents();
    const svc = issueService(db);
    const blocker = await svc.create(companyId, {
      title: "Do this first",
      status: "todo",
      assigneeAgentId: coderAgentId,
    });

    const issue = await svc.create(companyId, {
      title: "Wait on blocker",
      status: "blocked",
      assigneeAgentId: coderAgentId,
      blockedByIssueIds: [blocker.id],
    });

    expect(issue.status).toBe("blocked");
  });

  it("accepts workflow-normalized review state with a typed participant", async () => {
    const { companyId, coderAgentId, reviewerAgentId } = await seedCompanyAndAgents();
    const svc = issueService(db);
    const issue = await svc.create(companyId, {
      title: "Review me",
      status: "in_progress",
      assigneeAgentId: coderAgentId,
    });

    const updated = await svc.update(issue.id, {
      status: "in_review",
      assigneeAgentId: reviewerAgentId,
      executionState: {
        status: "pending",
        currentStageId: randomUUID(),
        currentStageIndex: 0,
        currentStageType: "review",
        currentParticipant: { type: "agent", agentId: reviewerAgentId, userId: null },
        returnAssignee: { type: "agent", agentId: coderAgentId, userId: null },
        reviewRequest: null,
        completedStageIds: [],
        lastDecisionId: null,
        lastDecisionOutcome: null,
      },
    });

    expect(updated).toMatchObject({
      id: issue.id,
      status: "in_review",
      assigneeAgentId: reviewerAgentId,
    });
  });
});

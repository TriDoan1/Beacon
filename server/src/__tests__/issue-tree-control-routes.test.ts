import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockTreeControlService = vi.hoisted(() => ({
  preview: vi.fn(),
  createHold: vi.fn(),
  getHold: vi.fn(),
  releaseHold: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  issueService: () => mockIssueService,
  issueTreeControlService: () => mockTreeControlService,
  logActivity: mockLogActivity,
}));

async function createApp(actor: Record<string, unknown>) {
  const [{ errorHandler }, { issueTreeControlRoutes }] = await Promise.all([
    import("../middleware/index.js"),
    import("../routes/issue-tree-control.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueTreeControlRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("issue tree control routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-2",
    });
  });

  it("rejects cross-company preview requests before calling the preview service", async () => {
    const app = await createApp({
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .post("/api/issues/11111111-1111-4111-8111-111111111111/tree-control/preview")
      .send({ mode: "pause" });

    expect(res.status).toBe(403);
    expect(mockTreeControlService.preview).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("requires board access for hold creation", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "22222222-2222-4222-8222-222222222222",
      companyId: "company-2",
      runId: null,
      source: "api_key",
    });

    const res = await request(app)
      .post("/api/issues/11111111-1111-4111-8111-111111111111/tree-holds")
      .send({ mode: "pause" });

    expect(res.status).toBe(403);
    expect(mockIssueService.getById).not.toHaveBeenCalled();
    expect(mockTreeControlService.createHold).not.toHaveBeenCalled();
  });
});

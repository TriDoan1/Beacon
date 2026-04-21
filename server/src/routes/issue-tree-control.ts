import { Router } from "express";
import type { Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  createIssueTreeHoldSchema,
  previewIssueTreeControlSchema,
  releaseIssueTreeHoldSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { issueService, issueTreeControlService, logActivity } from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

export function issueTreeControlRoutes(db: Db) {
  const router = Router();
  const issuesSvc = issueService(db);
  const treeControlSvc = issueTreeControlService(db);

  async function resolveRootIssue(req: Request) {
    const rootIssueId = req.params.id as string;
    const root = await issuesSvc.getById(rootIssueId);
    return root;
  }

  router.post("/issues/:id/tree-control/preview", validate(previewIssueTreeControlSchema), async (req, res) => {
    assertBoard(req);
    const root = await resolveRootIssue(req);
    if (!root) {
      res.status(404).json({ error: "Root issue not found" });
      return;
    }
    assertCompanyAccess(req, root.companyId);

    const preview = await treeControlSvc.preview(root.companyId, root.id, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: root.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.tree_control_previewed",
      entityType: "issue",
      entityId: root.id,
      details: {
        mode: preview.mode,
        totals: preview.totals,
        warningCodes: preview.warnings.map((warning) => warning.code),
      },
    });

    res.json(preview);
  });

  router.post("/issues/:id/tree-holds", validate(createIssueTreeHoldSchema), async (req, res) => {
    assertBoard(req);
    const root = await resolveRootIssue(req);
    if (!root) {
      res.status(404).json({ error: "Root issue not found" });
      return;
    }
    assertCompanyAccess(req, root.companyId);

    const actor = getActorInfo(req);
    const result = await treeControlSvc.createHold(root.companyId, root.id, {
      ...req.body,
      actor: {
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        userId: actor.actorType === "user" ? actor.actorId : null,
        runId: actor.runId,
      },
    });
    await logActivity(db, {
      companyId: root.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.tree_hold_created",
      entityType: "issue",
      entityId: root.id,
      details: {
        holdId: result.hold.id,
        mode: result.hold.mode,
        reason: result.hold.reason,
        totals: result.preview.totals,
        warningCodes: result.preview.warnings.map((warning) => warning.code),
      },
    });

    res.status(201).json(result);
  });

  router.get("/issues/:id/tree-holds/:holdId", async (req, res) => {
    assertBoard(req);
    const root = await resolveRootIssue(req);
    if (!root) {
      res.status(404).json({ error: "Root issue not found" });
      return;
    }
    assertCompanyAccess(req, root.companyId);

    const hold = await treeControlSvc.getHold(root.companyId, req.params.holdId as string);
    if (!hold || hold.rootIssueId !== root.id) {
      res.status(404).json({ error: "Issue tree hold not found" });
      return;
    }
    res.json(hold);
  });

  router.post(
    "/issues/:id/tree-holds/:holdId/release",
    validate(releaseIssueTreeHoldSchema),
    async (req, res) => {
      assertBoard(req);
      const root = await resolveRootIssue(req);
      if (!root) {
        res.status(404).json({ error: "Root issue not found" });
        return;
      }
      assertCompanyAccess(req, root.companyId);

      const actor = getActorInfo(req);
      const hold = await treeControlSvc.releaseHold(root.companyId, root.id, req.params.holdId as string, {
        ...req.body,
        actor: {
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          userId: actor.actorType === "user" ? actor.actorId : null,
          runId: actor.runId,
        },
      });
      await logActivity(db, {
        companyId: root.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.tree_hold_released",
        entityType: "issue",
        entityId: root.id,
        details: {
          holdId: hold.id,
          mode: hold.mode,
          reason: hold.releaseReason,
          memberCount: hold.members?.length ?? 0,
        },
      });

      res.json(hold);
    },
  );

  return router;
}

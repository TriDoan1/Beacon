import type { Db } from "@paperclipai/db";
import { issueTreeControlService } from "../issue-tree-control.js";

export async function isAutomaticRecoverySuppressedByPauseHold(
  db: Db,
  companyId: string,
  issueId: string,
) {
  const activePauseHold = await issueTreeControlService(db).getActivePauseHoldGate(companyId, issueId);
  return Boolean(activePauseHold);
}

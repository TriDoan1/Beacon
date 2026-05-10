import type Anthropic from "@anthropic-ai/sdk";
import { SUPPORT_INTAKE_TOOL_NAMES } from "@paperclipai/shared";

export type ConciergeToolName =
  | typeof SUPPORT_INTAKE_TOOL_NAMES.submitIntake
  | typeof SUPPORT_INTAKE_TOOL_NAMES.requestHuman
  | typeof SUPPORT_INTAKE_TOOL_NAMES.notABug;

export type ConciergeToolDefinition = Anthropic.Tool;

export const conciergeTools: ConciergeToolDefinition[] = [
  {
    name: SUPPORT_INTAKE_TOOL_NAMES.submitIntake,
    description:
      "Submit a structured intake packet describing the bug. Call this only when you have gathered enough detail to file a real ticket: a clear description of what happened, the steps to reproduce, and any context the engineer will need. Calling this closes the session and creates a linked issue.",
    input_schema: {
      type: "object",
      properties: {
        whatUserWasDoing: {
          type: "string",
          description: "One sentence: what the user was trying to do.",
        },
        whatHappened: {
          type: "string",
          description: "One sentence: what went wrong instead.",
        },
        reproSteps: {
          type: "array",
          items: { type: "string" },
          description: "Ordered steps to reproduce the issue.",
        },
        affectedFeature: {
          type: "string",
          description: "Optional: the feature/area of the product (e.g. 'rentals', 'self-checkout').",
        },
        severityHint: {
          type: "string",
          enum: ["blocker", "major", "minor", "cosmetic", "unknown"],
          description: "Concierge's best guess at user-perceived severity. Not authoritative.",
        },
      },
      required: ["whatUserWasDoing", "whatHappened", "reproSteps"],
    },
  },
  {
    name: SUPPORT_INTAKE_TOOL_NAMES.requestHuman,
    description:
      "Hand off to a human responder. Call this when the user explicitly asks for a human, when the issue involves billing/account access/security/data loss, or when after 3 exchanges you still cannot get a clear repro. Closes the session.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Short reason for the handoff, shown to the human responder.",
        },
        urgency: {
          type: "string",
          enum: ["routine", "elevated", "urgent"],
        },
      },
      required: ["reason"],
    },
  },
  {
    name: SUPPORT_INTAKE_TOOL_NAMES.notABug,
    description:
      "Close the session because this is not a bug — it is a how-do-I question, a feature request, or a usage clarification. Always include a short note explaining what you told the user.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["question", "feature_request", "account", "other"],
        },
        summary: {
          type: "string",
          description: "One-sentence summary of what the user actually needed.",
        },
      },
      required: ["category", "summary"],
    },
  },
];

export type ConciergeToolEffect =
  | {
      kind: "submit_intake";
      whatUserWasDoing: string;
      whatHappened: string;
      reproSteps: string[];
      affectedFeature?: string;
      severityHint?: string;
    }
  | {
      kind: "request_human";
      reason: string;
      urgency?: "routine" | "elevated" | "urgent";
    }
  | {
      kind: "not_a_bug";
      category: "question" | "feature_request" | "account" | "other";
      summary: string;
    };

export function parseToolEffect(
  name: string,
  input: Record<string, unknown>,
): ConciergeToolEffect | null {
  switch (name) {
    case SUPPORT_INTAKE_TOOL_NAMES.submitIntake:
      return {
        kind: "submit_intake",
        whatUserWasDoing: String(input.whatUserWasDoing ?? ""),
        whatHappened: String(input.whatHappened ?? ""),
        reproSteps: Array.isArray(input.reproSteps) ? input.reproSteps.map(String) : [],
        affectedFeature: input.affectedFeature ? String(input.affectedFeature) : undefined,
        severityHint: input.severityHint ? String(input.severityHint) : undefined,
      };
    case SUPPORT_INTAKE_TOOL_NAMES.requestHuman:
      return {
        kind: "request_human",
        reason: String(input.reason ?? ""),
        urgency: input.urgency as ConciergeToolEffect extends { kind: "request_human" }
          ? ConciergeToolEffect["urgency"]
          : never,
      };
    case SUPPORT_INTAKE_TOOL_NAMES.notABug:
      return {
        kind: "not_a_bug",
        category: (input.category as "question" | "feature_request" | "account" | "other") ?? "other",
        summary: String(input.summary ?? ""),
      };
    default:
      return null;
  }
}

import { SUPPORT_DEFAULT_MODEL } from "@paperclipai/shared";

export const type = "concierge";
export const label = "Concierge (live chat)";

export const models = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { id: "claude-haiku-4-6", label: "Claude Haiku 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
];

export const defaultModel = SUPPORT_DEFAULT_MODEL;

export const agentConfigurationDoc = `# concierge agent configuration

Adapter: concierge

This adapter is a live, user-facing chat agent — not a heartbeat-driven worker.
End-users interact with it through the @paperclipai/support-widget npm package
or the support API directly. The adapter does not consume issues; on intake
completion it CREATES an issue that other employees can pick up.

Core fields:
- model (string, optional): Claude model id; defaults to ${SUPPORT_DEFAULT_MODEL}.
- systemPrompt (string, optional): override the default Concierge system prompt.
  Supports {{PRODUCT_LABEL}} template variable.
- greeting (string, optional): first message shown when a session opens.
- maxTurnsPerSession (number, optional): hard ceiling on assistant turns; defaults
  to 40.
- productKey (string, required): scopes this employee to one Tailwind product.
  Must match the productKey on the linked support_widget_configs row.

Side-effect tools available to the agent:
- submit_intake_packet — gathers structured intake and creates a linked issue.
- request_human — escalates to a human responder; closes the session.
- not_a_bug_close — politely closes a session that does not represent a bug
  (questions, feature requests, account issues that need human review).

Per-session policy lives on support_widget_configs (origin allowlist, cost
caps, rate limits, theme, webhook URL).
`;

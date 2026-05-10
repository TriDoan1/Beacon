# 2026-05-09 — Customer Support Agent Pipeline

Status: **draft design doc**, not yet a build contract.

This document grounds the [BRAD support-agent TRD](../../../BRAD/Roadmap/support-agent-trd.md) (which is product-agnostic) in Paperclip's actual primitives, after reading the real schema, plugin spec, and routes. It supersedes any earlier scratch plan and is the reference for sequencing the implementation.

> **First product target: Tailwind.** Open follow-up: confirm exact repo target and GitHub App scope before Phase 2.

## 1. Goal

Stand up a 6-stage automated support pipeline (Concierge → Triage → Diagnostician → Fixer → QA → Deployment Watcher), plus an Orchestrator, where the **Concierge is a real Paperclip employee** that customers chat with directly. Each customer support request runs against an isolated Concierge instance, then hands off to specialist employees via Paperclip's normal task/comment primitives.

The pipeline must:

1. Resolve T1/T2 issues end-to-end without a human for low-risk fix classes.
2. Produce structured handoff packets for everything else (so a human starts at minute 30 of investigation, not minute 0).
3. Maintain a complete audit trail and graduated capability tiers (TRD §2.6).

## 2. Core Insight: Per-Customer Instances Already Exist

Reading [agents.ts](../../packages/db/src/schema/agents.ts), [heartbeat_runs.ts](../../packages/db/src/schema/heartbeat_runs.ts), and [agent_task_sessions.ts](../../packages/db/src/schema/agent_task_sessions.ts):

- `agents` is a **template** row (one per role).
- `heartbeat_runs` is the per-execution row (its own process, scratch dir, log store).
- `agent_task_sessions` is unique on `(companyId, agentId, adapterType, taskKey)` and persists adapter session state (e.g. Claude `sessionId`) across runs of the same `taskKey`.

So "spawn a unique Concierge instance per customer" = **issue heartbeat runs with `taskKey = "intake-{ticketId}"`**. The instance is implicit in the run; no new abstraction needed. The Claude session resumes turn-to-turn via `sessionParamsJson`. Multiple concurrent customers = multiple `taskKey`s, each fully isolated.

Constraint to add: a per-`taskKey` lock so rapid double-clicks from one customer don't race two runs against the same `sessionParamsJson`.

## 3. Architectural Shape

```
Customer browser
      │ POST  /api/plugins/<support-ingress>/webhooks/<endpointKey>
      ▼
Support Ingress plugin  (new package)
      │ ctx.issues.create / addComment / requestWakeup
      ▼
Paperclip core
      │ assignment wakeup → heartbeat run
      ▼
Tailwind Support  (a Paperclip company)
   ┌──────────────────────────────────────────────┐
   │ Concierge       (claude_local, taskKey-keyed)│
   │ Triage                                        │
   │ Diagnostician                                 │
   │ Fixer                                         │
   │ QA                                            │
   │ Deployment Watcher                            │
   │ Orchestrator (CEO of the support org)         │
   └──────────────────────────────────────────────┘
```

One **Tailwind Support** company holds the seven employees. Customers never touch Paperclip auth — they only ever interact with the plugin's public webhook endpoints. The plugin holds an agent API key for the Tailwind Support company and is the only thing that can reach core on behalf of customers.

## 4. Customer Ingress: Reuse Plugin Webhooks (the key simplification)

[server/src/routes/plugins.ts:2266](../../server/src/routes/plugins.ts) implements `POST /api/plugins/:pluginId/webhooks/:endpointKey` today — this route is **public, unauthenticated, capability-gated by the plugin manifest** (`webhooks.receive`), records every delivery in `plugin_webhook_deliveries`, and dispatches to the worker's `handleWebhook` RPC. The kitchen-sink plugin already uses it.

That is the entire customer-facing surface. We do **not** need a new "customer" actor type, do **not** need to extend `server/src/middleware/auth.ts`, and do **not** need to enable the disabled scoped-route `auth: "webhook"` mode (which the explore agents flagged — we just don't go through that path).

### 4.1 Endpoint design

The plugin declares four webhook endpoints:

| `endpointKey` | Customer intent | Worker behavior |
|---|---|---|
| `session.start` | Begin a new ticket | Verify HMAC handshake, mint ticket+session token, create parent issue, return token + greeting |
| `session.send` | Send a message | Verify token, append `issue_comments` row with `actorRole=customer`, request Concierge wakeup, return any new agent messages since `since` |
| `session.poll` | Poll for replies (no new message) | Verify token, return new agent messages since `since` |
| `session.close` | End the ticket | Verify token, mark issue `cancelled`/`done`, post final comment |

Each endpoint validates a session token (HS256, 30-min sliding TTL, scoped to ticketId). Token is minted by `session.start` after the host product (Tailwind app) signs an HMAC handshake of `{customerId, tenantId, productId, exp}` with a server-side secret stored as a plugin secret ref. Anonymous (logged-out) browser visitors get a `guest:<browser-fingerprint>` identity capped at low-trust handling.

### 4.2 Why the worker, not core, owns auth

Paperclip's plugin spec (§22) is explicit that secrets stay as refs and resolve to the worker at execution time. HMAC verification and JWT mint/verify both live in the worker, using `ctx.secrets.read-ref` — this keeps customer auth mechanics outside core forever, which matches PRODUCT.md's "not a chatbot" boundary.

### 4.3 Rate limiting

In the worker: per-`customerId` 10 msg/min, per-`tenantId` 100 msg/min. Persisted in `plugin_state` (scope=instance, namespace=`ratelimit`). Token TTL caps replay risk regardless.

## 5. Mapping the TRD to Existing Primitives

| TRD concept | Paperclip primitive | Source of truth |
|---|---|---|
| Six specialist agents + Orchestrator | Seven `agents` rows in the support company | [agents.ts](../../packages/db/src/schema/agents.ts) |
| `support_session` | Parent **issue** | [issues.ts](../../packages/db/src/schema/issues.ts) |
| Per-stage work | Sub-issues with `parentId` set | same |
| Stage dependencies | `blockedByIssueIds` on sub-issues | same |
| `session_message` (chat) | `issue_comments` rows | [issue_comments.ts](../../packages/db/src/schema/issue_comments.ts) |
| `agent_event` (audit) | `activity_log` (append-only, indexed) | [activity_log.ts](../../packages/db/src/schema/activity_log.ts) |
| Diagnosis / proposed_fix docs | Versioned `issue_documents` on the parent | [issue_documents.ts](../../packages/db/src/schema/issue_documents.ts), [document_revisions.ts](../../packages/db/src/schema/document_revisions.ts) |
| Per-session cost ceiling | `budget_policies` scoped to the parent issue, `hardStopEnabled=true` | [budget_policies.ts](../../packages/db/src/schema/budget_policies.ts), [cost_events.ts](../../packages/db/src/schema/cost_events.ts) |
| Deployment Watcher 30-min monitor | `routines` + `routine_triggers` + `routine_runs` with `coalesce_if_active` | [routines.ts](../../packages/db/src/schema/routines.ts) |
| Confidence-threshold escalation | `approvals` row of new type `support_escalation` | [approvals.ts](../../packages/db/src/schema/approvals.ts), [issue_approvals.ts](../../packages/db/src/schema/issue_approvals.ts) |
| Customer/concierge/specialist message split | New columns `actor_role` and `internal` on `issue_comments` | extension |
| Capability tiers 0–8 | New table `agent_capability_grants` + middleware | extension |
| Concurrency/dedupe | Application logic in Orchestrator + plugin (hash-based merge into in-flight parent) | extension |

## 6. Extensions Needed (concrete, minimal)

### 6.1 New schema

**`agent_capability_grants`** (new table)
- `id uuid pk`
- `companyId uuid fk` companies
- `agentId uuid fk` agents
- `tier int` 0..8
- `grantedBy uuid` user that granted
- `grantedAt timestamptz`
- unique `(companyId, agentId, tier)`

**`issue_comments`** (extend existing)
- `actorRole text` nullable, one of `customer | concierge | specialist | board | system`
- `internal boolean default false`

The plugin webhook layer filters customer-visible reads to `internal=false`. Specialists' inter-agent comments set `internal=true`.

### 6.2 New routes / services

- `server/src/services/capability-tier.ts` — `requireTier(agentId, tier)` middleware. For non-granted tiers, creates `approvals` of type `capability_tier_gate` and throws/awaits.
- `server/src/services/support-orchestrator.ts` — dedupe (hash productId+tenantId+symptomClass against open parent issues), escalation, post-rollback re-open hook. The Orchestrator agent uses these helpers via the paperclip skill rather than reinventing them.
- No changes to `server/src/middleware/auth.ts`. Customer auth lives entirely in the plugin worker.

### 6.3 New plugin

**`packages/plugins/support-ingress/`** with:
- Manifest declaring `webhooks.receive`, `issues.create/update`, `issue.comments.create`, `issue.documents.write`, `events.subscribe`, `secrets.read-ref`, `plugin.state.read/write`, `agent.tools.register` (none needed in v1 but reserve), `ui.action.register` (operator "join chat as human" affordance). Categories: `connector`, `ui`.
- Webhook endpoints: `session.start`, `session.send`, `session.poll`, `session.close` (§4.1).
- Optional UI slot: a `taskDetailView` for the parent issue showing the customer-facing transcript so operators can monitor without leaving Paperclip.
- Optional UI slot: a `commentContextMenuItem` "Take over chat" that pauses Concierge auto-replies.
- A widget bundle at `dist/widget/` served via `/_plugins/support-ingress/widget/*` for embedding into Tailwind's site as `<script src="…/loader.js">`. The kitchen-sink example shows the bundling pattern.

### 6.4 Concierge prompt (TRD §4.1) lives where?

Per [PRODUCT.md](../PRODUCT.md), the agent's prompt is its `adapterConfig`. The Concierge employee is `adapterType: "claude_local"` with `adapterConfig.systemPrompt` set verbatim from TRD §4.1, plus a `tier: 1` field the agent reads on each wake. Specialist prompts (§4.2–§4.7) seed the other six employees the same way.

## 7. Concierge Loop (per wake)

1. Resolve the `taskKey` from the heartbeat trigger (parent issue id).
2. Read [skills/paperclip/SKILL.md](../../skills/paperclip/SKILL.md) coordination API: `GET /api/issues/{issueId}/heartbeat-context`. Already returns parent + comments + recent events.
3. Identify the latest unanswered comment with `actorRole=customer`.
4. Decide one of:
   - Ask a follow-up — append a `concierge` comment, optionally request a screenshot.
   - Hand off — create a sub-issue (`parentId`, `assigneeAgentId={triage}`, `status=todo`, billing scoped to parent), write `issue_documents` of kind `intake_packet` containing the structured handoff (TRD §4.1 output).
   - Escalate to human — assign sub-issue to a board user, create `approvals` of type `support_escalation`, post Slack/PagerDuty via existing notification path.
5. Update the customer-facing comment thread with status ("Looking into it. ETA 5 min.") if appropriate.
6. **Stay assigned to the parent issue.** Concierge does not finish on handoff. It re-wakes on:
   - new customer comment (via plugin → `requestWakeup`);
   - sub-issue `status_changed` event;
   - `issue_documents.created` on the parent (specialist posted findings).

A pre-LLM classifier in the plugin worker enforces hard escalation triggers (security / data loss / billing) regardless of what the LLM does — this is redundant with the prompt but the redundancy is intentional.

## 8. Capability Tiers — Where Each Is Enforced

| Tier | Action | Enforcement point |
|---|---|---|
| 0 | Read logs/repo/issues/metrics | Granted broadly; no special check |
| 1 | Draft internal artifacts (docs, comments) | `issue.documents.write`, `issue.comments.create` capability + `agent_capability_grants` ≥ 1 |
| 2 | Write code to scratch branch, run tests | Fixer's GitHub App permissions limited to its scratch branch namespace |
| 3 | Open a draft PR | `requireTier(agentId, 3)` middleware |
| 4 | Mark PR ready | Fix-class allowlist (copy / CSS) auto-approves; otherwise `approvals` row |
| 5 | Auto-merge to dev | Allowlist + green CI + QA pass + confidence ≥ 0.85 |
| 6 | Deploy to staging | Same as 5 |
| 7 | Deploy to production | Always human-gated. **No code path may bypass.** |
| 8 | Touch auth/payments/secrets/migrations/infra | **Structurally** forbidden via GitHub App branch protection on `auth/`, `payments/`, `migrations/`, `.github/`, `infra/` — belt and suspenders with prompt rules |

Tier 7 and 8 enforcement does **not** rely on prompt obedience. A prompt-injected Fixer cannot deploy to prod because the GitHub App lacks the permission and Paperclip's middleware rejects the call.

## 9. Critical Edge Cases (full list, prioritized)

These are the ones with high cost-of-late-discovery. Each gets a Phase to address in.

1. **Long pipelines vs. customer attention.** Diagnose-fix-ship can take 20+ min; customer's tab is closed. Need a notification channel (email/SMS) plus a magic-link resume page. Phase 0 stub with email-only; Phase 4 add SMS.
2. **Session continuity across handoff.** Concierge's Claude session is not shareable with specialists. Specialists get fresh Claude sessions; the handoff packet (`issue_documents`) carries the structured summary. Don't try to share `sessionId`s across agents.
3. **Same customer, two tabs, two parallel turns.** DB advisory lock keyed by `taskKey` in the heartbeat invocation path. Without it, both runs mutate `sessionParamsJson` and one update is silently lost. Phase 0.
4. **Same bug, ten customers in five minutes.** Orchestrator dedupe: hash `(productId, tenantId, classified_symptom)`; if matches an open parent issue, link the new ticket via `issue_relations` and reuse the in-flight diagnosis. Concierge tells the new customer "we're already on it." Phase 1.
5. **Concierge crash mid-turn.** Transactionally update `agent_task_sessions.sessionParamsJson` only on successful run completion. Existing watchdog ([heartbeat_run_watchdog_decisions](../../packages/db/src/schema/heartbeat_run_watchdog_decisions.ts)) reaps stale runs.
6. **Customer abandons the chat.** A routine `session_idle_timeout` closes any open ticket with no customer activity for 24h. Phase 0.
7. **Customer says something the prompt's escalation list ignores.** Pre-LLM classifier in the plugin worker; doesn't replace the prompt rule, augments it. Phase 0.
8. **Cost runaway.** Per-session `budget_policies` with `hardStopEnabled=true`, default $5, alert at $3. Sub-issue costs roll up to parent. Phase 2.
9. **Outage classification.** Triage detects "N parents opened in M minutes with same symptom"; pages on-call and suspends Fixer pipelines instead of fan-out. Phase 1.
10. **Prompt injection via customer messages.** Specialists treat customer-supplied content (text, screenshot OCR, error logs) as untrusted data; same discipline as this Claude harness. Document in each specialist's adapter config. Phase 1.
11. **PII in audit log.** Activity log redactor pass on storage of `details_json` (mask credit-card-like patterns, JWTs, API keys, OAuth tokens). Retention policy: 1y for closed tickets, then archive. Phase 0.
12. **Rollback hits a customer mid-conversation.** Watcher posts a `rollback_event` `issue_documents` revision; Concierge wakes on document creation and posts an accurate apology. Phase 4.
13. **Operator wants to take over.** Plugin UI slot "Take over chat" on the parent issue — sets a parent-issue tag `concierge_paused=true` that the Concierge prompt checks before replying. Phase 1.
14. **Mode mismatch.** Plugin webhook routes are public **today**, regardless of `local_trusted`/`authenticated` mode. No change needed. Document in [DEPLOYMENT-MODES.md](../DEPLOYMENT-MODES.md) that customer-ingress plugins expose public surfaces.
15. **Tier escalation UX.** `approvals` of type `capability_tier_gate` lands in the existing approval inbox. Phase 3.
16. **Tailwind-specific fix-class definition.** Tailwind's repo *is* CSS; "CSS-only" allowlist must be defined as `apps/site/**`/`packages/docs-site/**` (marketing/docs) **not** the utility-class generator. Resolve before Phase 4.
17. **Plugin ↔ core deploy coupling.** Plugin install is global per-instance (PLUGIN_SPEC.md §8). A plugin upgrade that needs a new core capability must be coordinated. Mitigate by versioning the plugin's manifest API version and gating behind feature flags.

## 10. Phased Build

Each phase is shippable on its own and produces real value. No skipping ahead.

### Phase 0 — Smart intake form (1–2 weeks)
**Goal: a customer can chat with Concierge, who creates a clean ticket and hands off to a human.**

Deliverables:
- `packages/plugins/support-ingress/` scaffolded from `create-paperclip-plugin`. Webhook endpoints for `session.start/send/poll/close`. Pre-LLM classifier. Rate limit. Embed widget bundle at `/_plugins/support-ingress/widget/`.
- New schema: `agent_capability_grants`, `issue_comments.actor_role`, `issue_comments.internal`. Migration via `pnpm db:generate`.
- New service `server/src/services/capability-tier.ts`.
- New service `server/src/services/support-orchestrator.ts` (stubs for dedupe, full impl in P1).
- New "Tailwind Support" company seeded with the Concierge employee and one human board operator as the handoff target.
- Concierge `adapterConfig.systemPrompt` set from TRD §4.1. Tier 1 grant.
- Per-`taskKey` advisory lock in `server/src/services/heartbeat.ts` invocation path.
- Activity-log redactor for credit-card-like / JWT / OAuth-token patterns on writes to `details_json`.
- Routine `session_idle_timeout` for 24h abandonment.
- Verification (§13): customer chats via the widget, ticket lands in board UI, audit chain visible, idle timeout fires.

### Phase 1 — Triage + Diagnostician (2 weeks)
**Goal: by the time a human picks up the ticket, the diagnosis is already attached.**

- Add Triage and Diagnostician employees, both Tier 0.
- Concierge handoff target switches from human to Triage.
- Triage classification → routes to Diagnostician for `bug`, to human for `data_issue`/`security`, closes for `feature_request`.
- Diagnostician writes `issue_documents` of kind `diagnosis`. Concierge wakes on doc creation and updates the customer.
- Orchestrator dedupe (real impl).
- "Take over chat" UI slot.
- Outage detection (>N tickets/M min same symptom → page on-call, suspend Fixer queue).
- Verification: 20 real tickets, time-to-diagnosis p50 < 5 min, ≥70% diagnoses rated useful by reviewer.

### Phase 2 — Fixer (suggested fixes only) (2 weeks)
**Goal: human reviews a proposed diff alongside the diagnosis. No PRs auto-opened.**

- Fixer at Tier 2: scratch branch + tests only, posts diff link in `issue_documents` of kind `proposed_fix`.
- Per-session `budget_policies` with `hardStopEnabled` ($5 default). Cost rollup includes sub-issues.
- Verification: track merged-as-is vs edited vs rejected rates over ≥30 fixes.

### Phase 3 — Auto-PR + QA (2 weeks)
**Goal: human gets a green draft PR ready for review.**

- Fixer escalated to Tier 3 (opens draft PR).
- QA employee added: full test suite, regression test verification, diff-scope check.
- Tier 4 (mark ready) gated by `approvals` of type `capability_tier_gate` for now.
- Concierge updates customer with PR link if tenant has `notify_with_pr_links=true`.
- Verification: ≥30 draft PRs through QA; QA catches scope creep and missing regressions.

### Phase 4 — Auto-merge (allowlist) + Deployment Watcher (2–3 weeks)
**Goal: end-to-end auto-resolve for copy strings and CSS-only diffs in scoped paths.**

- Tailwind-specific fix-class allowlist resolved (§9.16). Likely `apps/site/**` for copy and `packages/marketing/styles/**` for CSS-only.
- Deployment Watcher implemented as a `routine` that fires on PR-merge webhook, runs for 30 min, auto-rollbacks on threshold breach, wakes Concierge on rollback.
- Tier 7 stays human-gated. Tier 8 stays structurally forbidden.
- Verification: 30 successful auto-merges with zero false-fix incidents over 14 days **before** any allowlist expansion.

## 11. Critical Files

Existing — read carefully before modifying:
- [packages/db/src/schema/agents.ts](../../packages/db/src/schema/agents.ts), [heartbeat_runs.ts](../../packages/db/src/schema/heartbeat_runs.ts), [agent_task_sessions.ts](../../packages/db/src/schema/agent_task_sessions.ts) — per-instance isolation.
- [packages/db/src/schema/issues.ts](../../packages/db/src/schema/issues.ts), [issue_comments.ts](../../packages/db/src/schema/issue_comments.ts), [issue_documents.ts](../../packages/db/src/schema/issue_documents.ts) — pipeline + chat transport.
- [packages/db/src/schema/activity_log.ts](../../packages/db/src/schema/activity_log.ts), [budget_policies.ts](../../packages/db/src/schema/budget_policies.ts), [routines.ts](../../packages/db/src/schema/routines.ts), [approvals.ts](../../packages/db/src/schema/approvals.ts) — governance.
- [server/src/routes/plugins.ts:2266](../../server/src/routes/plugins.ts) — `POST /api/plugins/:pluginId/webhooks/:endpointKey` is the customer-ingress door.
- [server/src/services/heartbeat.ts](../../server/src/services/heartbeat.ts) — where the per-`taskKey` lock goes.
- [doc/plugins/PLUGIN_SPEC.md](../plugins/PLUGIN_SPEC.md) — the contract the new plugin must follow.
- [packages/plugins/examples/plugin-kitchen-sink-example/](../../packages/plugins/examples/plugin-kitchen-sink-example) — reference plugin (declares webhooks, jobs, tools, UI slots).
- [skills/paperclip/SKILL.md](../../skills/paperclip/SKILL.md) — the API the support employees use to coordinate.

New — to be created:
- `packages/plugins/support-ingress/` — the customer-facing plugin.
- `packages/db/src/schema/agent_capability_grants.ts`.
- `server/src/services/capability-tier.ts`.
- `server/src/services/support-orchestrator.ts`.

## 12. Open Decisions

Locked:
1. First product target: **Tailwind**.
2. Ingress: **plugin** at `packages/plugins/support-ingress` using existing webhook surface. No new auth mode.
3. Pipeline: **all six are Paperclip employees** in one Support Org company.
4. Auto-merge allowlist v1: **copy strings + CSS-only diffs**, behind feature flags, with the Tailwind-specific path scope from §9.16.

Still open (decide before relevant phase):
- **Tailwind repo target & GitHub App scope** — before Phase 2.
- **Sentry/PostHog access for Diagnostician** — before Phase 1.
- **Cost ceiling**: $5/session hard, alert at $3. Confirm before Phase 2.
- **Human escalation channel**: Slack `#support-agent` + PagerDuty for security/data loss. Confirm before Phase 0.
- **Confidence thresholds**: Diagnostician ≥ 0.6, QA ≥ 0.85. Confirm before Phase 3.
- **Notification adapter for "I'll email you when it's ready"** — Phase 0 stub, full impl Phase 1.

## 13. End-to-End Verification

Each phase requires this checklist before being declared done:

1. `pnpm dev`; install support-ingress plugin via `pnpm paperclipai plugin install ./packages/plugins/support-ingress`; widget loads from `/_plugins/support-ingress/widget/`.
2. **Per-customer isolation**: open the widget in two browsers with two `customerId`s, send overlapping turns; verify two distinct `agent_task_sessions` rows and that conversations don't bleed.
3. **Single-active-run lock**: rapid-fire 5 messages from one customer; verify only one `heartbeat_runs` row at a time per `taskKey`, others queued.
4. **Handoff**: trigger an obvious-bug intent; verify a Triage sub-issue with `parentId` set, an `issue_documents` row of kind `intake_packet`, and that Triage wakes.
5. **Audit**: query `activity_log` for the parent issue id; every customer message, agent decision, and status change is present with monotonic `createdAt`.
6. **Cost ceiling**: set the session budget to $0.01; verify the parent issue auto-pauses and a `budget_incidents` row is opened.
7. **Tier gate**: stub the Fixer requesting Tier 4; verify an `approvals` row of `type=capability_tier_gate` lands in the board approval inbox.
8. **Routine**: simulate a merged PR webhook; verify a `routine_runs` row + linked watcher issue + 30-min completion path.
9. **Idle timeout**: open a ticket, send no messages for 24h (or wind the clock); verify the routine closes the ticket with `resolution_type=abandoned`.
10. `pnpm -r typecheck && pnpm test:run && pnpm build` clean. Plugin has its own vitest suite covering token mint/verify, rate limit, classifier short-circuits, and HMAC handshake.

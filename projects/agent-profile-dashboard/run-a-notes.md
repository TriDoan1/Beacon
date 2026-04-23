# Run A — Notes

Accumulating log of decisions, DS deviations, operating-principles citations, and surfaced findings across the Run A phases. Phase 4 will consolidate; phases 2–3 append as they go.

---

## Phase 2 fix — activity-state bug and budget window (commit `389f8105`)

### Decisions

- **Activity-state is derived, not read.** The hero activity pill resolves state via a derived `activityStatus` that prefers agent-level terminal states (paused, pending_approval, terminated) first, then looks at the `runs` array to detect running/queued heartbeats, and only falls through to raw `agent.status` for other cases. This guarantees the pill agrees with the Live Run card — both read the same source of truth for "is the agent running right now."
  - *Lens — Mental Models:* users expect the header indicator and the live card to tell the same story; any disagreement is a trust-break.
  - *Lens — Postel's Law:* tolerate imperfect backend signals (stale `agent.status` cache) by deriving from a signal that's always fresh.

### DS deviations

None introduced in this phase. Only used tokens + raw-palette classes that already existed in the dashboard region.

### Surfaced findings (not fixed — flagged for later)

- **Cache-key mismatch for agent.status live-event invalidation** (`ui/src/context/LiveUpdatesProvider.tsx:816` vs `ui/src/pages/AgentDetail.tsx:655`). The detail query keys on the URL-ref (`"conversation-tester"`) plus company-id; the live-event invalidation passes the UUID. React Query's prefix match fails. Derivation sidesteps the symptom; the underlying cache-coherence issue remains. Out of scope for Run A — flagging for a follow-up cleanup.

---

## Phase 3a — Hero module redesign

### Decisions

- **50/50 hero split, not 55/45.** Smoke test feedback: right zone felt cramped at 55/45. Switched to `grid-cols-2`. Both zones now have matched visual weight; right zone has breathing room for the budget card and recent-runs strip without eating vertical space.
  - *Lens — Common Region (Gestalt):* equal widths reinforce "now" vs. "how are we doing" as parallel questions, not subordinate ones. A 55/45 treatment whispered "the left is more important" when in fact both zones carry Section-1-critical signals.

- **Cyan relocated, not preserved at card level.** The Live Run card no longer renders `border-cyan-500/30` + glow shadow. The activity-state pill carries the liveness signal externally; the internal `StatusIcon` (cyan spinning `Loader2` when running) carries it locally. This eliminates the three-way cyan duplication that existed in Phase 2 (pill + card border + internal spinner).
  - *Lens — Von Restorff:* isolation works only when the isolated signal is alone. The pill is now the single chromatic "alive" signal at the top of the hero. The internal spinner is a secondary local signal, small enough not to compete.
  - *Lens — Information Scent:* the pill's position (top-left, where the eye lands first per F-pattern) is the right place for the liveness signal; burying it in a card border is noise, not signal.

- **LatestRunCard header row removed.** The previous "Live Run / Latest Run" heading plus separate "View details →" link were redundant with the activity pill above and the `StatusBadge` inside the card. The card is now a single `Link` — click anywhere navigates to run detail. `aria-label` carries the context for screen readers.
  - *Lens — Fitts's Law:* the whole card as a click target is larger and faster than an isolated text link.
  - *Lens — Recognition over Recall:* the `StatusBadge` inside the card tells the user what kind of card it is without requiring a separate heading.

- **Idle-state "Next up" hint.** When the activity status is `idle` or `active` (i.e., the agent is waiting, not running), the left zone renders a small forward-looking line below the Latest Run card: either `Next up · <task-id> <title> →` (linking to the top in-flight task) or `No pending work` (when there are zero in-flight tasks). This answers "what's supposed to happen next?" for the monitoring user, which the concept §1 flagged as a missing signal.
  - *Lens — Goal-Gradient + Zeigarnik:* an idle agent with pending work should surface that work cheaply; users resolve faster when they see the next step.
  - *Lens — Serial Position:* primary item (`inFlightTasks[0]`, highest priority by existing sort) earns the "Next up" slot; the full list is one scroll away.
  - *Data scope:* the forward-looking signal is derived from `inFlightTasks` (already computed in `AgentOverview`). A richer signal ("Next scheduled run in 12m") would require fetching routines, which is out of scope for this dashboard.

- **Recent-runs strip uses icons, not dots.** The seven recent runs are now rendered as colored lucide icons from `runStatusIcons` (`CheckCircle2`, `XCircle`, `Loader2`, `Clock`, etc.) at `h-3.5 w-3.5`, not colored dots. Each icon is a `<Link>` to the run detail, with `aria-label` and `title` carrying the status + relative time.
  - *Lens — WCAG POUR (color-independence):* icons are shape-distinguished, so colorblind users can parse outcomes without relying on color. Hover/focus tooltip + aria-label provide the full context.
  - *Implementation note:* the Phase 2 `tone.color.replace(/text-/g, "bg-")` hack is gone. LucideIcons use `currentColor`, so the parent link's `tone.color` class propagates cleanly.

- **Activity-pill text color.** Text is `text-foreground` by default, overridden to `text-cyan-600 dark:text-cyan-400` when running and `text-red-600 dark:text-red-400` on error. These specific classes are already present in the dashboard region (`runStatusIcons` at `AgentDetail.tsx:104–111`), so no new raw-palette drift. Paused/pending_approval/terminated use the default foreground text — the colored dot carries the severity.

### DS deviations — "pass with explicit justification"

None of these are DS violations; they are deliberate choices that may look like deviations on cursory review.

- **`rounded-full` on progress-bar track and activity-dot.** Sharp-corners default (`rounded-none`) applies to surfaces; a progress-bar fill and a 2px status dot are not surfaces — they're glyphs. `rounded-full` is the conventional shape for both and matches `BudgetPolicyCard`'s progress bar and the existing `agentStatusDot` usage elsewhere. Not flagged as rounded-corner drift.
- **Progress bar colors remain `bg-red-400 / bg-amber-300 / bg-emerald-300`.** These are raw-palette classes; the concept §3 suggested `--signal-success` for OK state. Decision: match `BudgetPolicyCard` exactly so the dashboard progress bar and the Budget tab card read as one coherent family. Switching to `--signal-success` locally would split the budget visual vocabulary. The rubric Section 5 "no new tokens" bans proposing tokens mid-experiment; using an existing-but-suboptimal pattern beats forking.
- **`bg-cyan-400` pulse on the activity-state dot** comes from `agentStatusDot["running"]` — unchanged from Phase 0 baseline, used consistently across the app (Agents list, Design Guide showcase).

### Surfaced findings

- **`agentStatusDot["idle"]` and `agentStatusDot["paused"]` are both `bg-yellow-400`.** Distinct states, identical dot color — this is an existing DS ambiguity, not something Phase 3a introduced. Users who check the pill can still read the label text ("Idle" vs "Paused"), but the dot alone is not state-distinguishing between these two. Flagging for a future `status-colors.ts` review; modifying the map is out of scope per the rubric.
- **`active` label renders as "Active" with green dot.** This is the pre-first-heartbeat state. The label is informative but uncommon; most users see `running` / `idle` / `paused`. No change needed.
- **Idle-hint visibility overlaps with In-flight tasks list.** The "Next up · top-task →" line in the hero points to the same top task that appears at the top of the in-flight list below. That's intentional — the hint is a *tip* for monitoring users who don't need to scroll, the list below is the full surface. `Progressive Disclosure` in action; not redundancy.
- **Zero-runs state** renders a plain "No runs yet" card in the left zone + the recent-runs strip collapses to "No runs yet." Both reads together communicate "this agent has no history at all" — fine, but two copies of the same empty-state message. Could consolidate in a future pass; not blocking.

### Tensions / open questions for the Phase 3a checkpoint

1. **Is the LatestRunCard without a heading clear enough?** Removing the "Live Run"/"Latest Run" heading flattens hierarchy but removes a piece of context. If the smoke test finds it ambiguous, we can restore a minimal inline label without reintroducing the pulse dot or separate link.
2. **Budget card zero-state.** At 0% utilization the filled div has `width: 0%`, so the track reads as empty. The "0%" label and "$0.00 of $N.NN" text still communicate the state in copy. No minimum-fill treatment was added — that would fake data. Flagging in case the visual impression of "empty track" reads as broken to the smoke test.
3. **Activity-pill presence.** Current treatment is minimal (dot + text, no pill container). The concept called it a "pill" but meant "status indicator" semantically. If you want more visual presence (padded container, subtle background), say so and I'll iterate. `Aesthetic-Usability Effect` says minimal is probably right here — decoration without function adds noise.

---

## Phase 3a polish — 50/25/25 layout + shadcn tooltips

### Decisions

- **Hero is three zones, not two.** 50/50 still felt crowded in the right column because budget card + recent-runs strip were stacked in the same 50%-wide zone. Changed to `lg:grid-cols-[2fr_1fr_1fr]`: left stays at 50% for the current-work surface, middle 25% is budget alone, right 25% is recent-runs alone. Each peer gets horizontal breathing room; the stacked-pair visual weight is gone.
  - *Lens — Common Region (Gestalt):* budget and recent-runs are independent signals that answer different questions ("how are we on spend?" vs. "how did recent runs go?"). Treating them as peers reinforces that independence.
  - *Lens — Proximity:* putting them in separate zones rather than stacked in one zone visually separates concerns.
  - *Budget readability at 25%:* at a 1440px viewport with the standard sidebar, content width lands around 1100–1150px; three zones at 2fr/1fr/1fr give the middle/right zones ~275–290px each. The budget card's densest line — `$amount of $limit` + `utilizationPercent%` — fits comfortably with `justify-between` and `gap-2`; the "remaining · resets in N days" line at text-xs stays within ~250px content width. Tested mentally against worst-case values (`$10,000.00 of $100,000.00` + `100%`) — still fits. No fallback to 50/50 was needed.
  - *Narrow-viewport caveat:* at the `lg:` breakpoint itself (1024px) the 25% zones drop to ~170–200px content width, which would squeeze the budget card's dense line. Acceptable because the layout stacks at smaller viewports (`grid-cols-1` below `lg`), and the primary-goal test is specifically at 1440px.

- **Tooltips via shadcn primitive, not native `title`.** The Phase 3a initial pass used the HTML `title` attribute on the recent-runs `Link`. Native browser tooltips are unreliable: delay is OS-dependent, visual styling is OS-dependent, and some browsers suppress the title attribute on anchor elements in certain cases. Replaced with `<Tooltip><TooltipTrigger asChild>...</TooltipTrigger><TooltipContent>...</TooltipContent></Tooltip>` from `@/components/ui/tooltip`, which is already project-standard (e.g., `HintIcon` in `agent-config-primitives.tsx:70`). The `TooltipProvider` is globally mounted in `main.tsx`, so no local provider needed.
  - *Lens — Doherty Threshold:* shadcn Tooltip defaults to `delayDuration={0}` at the provider level, giving sub-100ms open. Native browser tooltips typically wait ~500ms before showing.
  - *Lens — Jakob's Law:* styled tooltips match the rest of the app's hover-help vocabulary; users expect this look and behavior.
  - *Content:* tooltip body now carries the full concept-specified triplet — run id + outcome + relative time. The previous `title` attribute was missing the run id.
  - *Accessibility:* the `aria-label` on the `<Link>` is retained for screen-reader announcements; the visual tooltip is a separate affordance.

### DS deviations

None introduced in this polish. `TooltipProvider` was already mounted globally; `Tooltip` primitives are standard shadcn pattern already used elsewhere.

### Findings surfaced

- The Phase 3a initial tooltip implementation using native `title` was a miss — the concept explicitly specified interactive tooltips as part of the recent-runs deliverable, and native title attributes are not reliable cross-browser. Trust the DS tooltip primitive by default for any hover-content requirement in future phases.

---

## Phase 3a polish round 2 — compact run feed replaces icon strip

Concept-level revision, not a layout tweak. The Phase 3a icon strip (§7 of the concept) looked compact but proved information-sparse — run id, outcome detail, and timestamp all required hover to decode. A three-row compact feed below the Latest Run card reads everything at a glance.

### Decisions

- **Recent-runs icon strip removed; 3 compact rows take its place.** Each row is a single `<Link>` with: colored status icon (12px), mono run-id (8 chars), status label (text, replace underscores with spaces), and right-aligned relative time. Rows sit in a bordered container with `border-t` separators between them (not `divide-y` — explicit per-row treatment is more composable when future work adds row-level affordances).
  - *Lens — Jakob's Law:* the Latest Run card is already the user's mental model for "one run" — icon + id + status + time. Compact rows reuse the vocabulary at lower visual weight.
  - *Lens — Recognition over Recall:* users see outcomes in the row itself; hover isn't required to decode. Failed runs pop at a glance.
  - *Lens — Information Scent:* a monitoring user scanning the feed can spot a recent pattern (e.g., three consecutive failures) without interacting. The icon strip required hover per-dot.
  - *Lens — Serial Position + Miller's Law:* 3 prior rows + 1 Latest Run card = 4 items, well within working-memory limits. Primary-vs-secondary hierarchy stays clean — the card dominates, the feed supports.

- **Hero collapses back to 75/25 two-zone.** Left zone expands to 75% (activity pill + Latest Run card + prior-runs feed + idle hint). Right zone shrinks to 25% with the budget card alone. The three-zone layout from polish round 1 is gone — the feed needs the card's width to read cleanly at `text-xs`, and a 25% zone would have squeezed the relative-time column unreasonably.
  - Budget card at 25% was already verified in polish round 1; no change to its readability.

- **Latest Run selection moved out of `LatestRunCard` into the caller.** `LatestRunCard` signature changed from `{ runs, agentId }` to `{ run, agentId }`. The caller (`AgentOverview`) now owns the sort/find/latest/prior computation via a single `sortedRuns` memo, then derives `latestRun = liveRun ?? sortedRuns[0]` and `priorRuns = sortedRuns.filter(r => r.id !== latestRun.id).slice(0, 3)`. Simpler component, caller handles zero-runs and duplication avoidance.
  - *Why in the caller:* the prior-runs feed needs to know which run the Latest Run card is showing, to exclude it. Keeping selection inside `LatestRunCard` would require an awkward callback or duplicated logic.

- **No tooltips on the compact rows.** All information is visible in the row itself — tooltip would be redundant. `aria-label` isn't set either since the row content is already readable text; the `<Link>` has its own discoverable text for screen readers.

### DS deviations — "pass with explicit justification"

- **Compact rows use `px-3 py-1.5 text-xs`.** Mirrors the density of `EntityRow` (used in the in-flight tasks list below) for visual rhythm. No new tokens; standard Tailwind spacing from the existing scale.
- **`border-t` between rows instead of wrapping each row in a border.** Matches the `EntityRow` pattern (in-flight tasks list) where rows use `border-b` on all but the last. Same effect, same DS vocabulary.

### Findings surfaced

- **`runStatusIcons` is still the source of truth.** The icon + color pair drives both the Latest Run card's status row and the compact feed rows. Consistent across the module; no drift.
- **Edge case: live run not at position 0.** If there are runs created after the live run that already finished (unlikely but possible with overlapping executions), the compact feed would show those newer-completed runs above older-completed runs, skipping the live run's timeline position. The Latest Run card still correctly shows the live run. This is an edge case and the concept's spec ("3 runs before the Latest Run, not including it") is what drives the behavior — filtering by id is correct per spec.
- **Empty-state symmetry.** With the icon strip gone, the prior-runs feed simply doesn't render when there are fewer than 2 runs total. No "No prior runs yet" message — the zero/one-run case doesn't warrant a placeholder below an already-informative Latest Run card (or its own "No runs yet" fallback). `Progressive Disclosure` in action.

### Rubric alignment check

- **Section 1 item 3 (recent health):** satisfied — arguably stronger than the icon strip. Three runs with full outcome + timestamp in the monitoring frame, no interaction needed.
- **Section 1 monitoring-no-scroll:** the feed adds ~75–90px of vertical height to the hero (3 rows × ~28px + dividers). Hero previously ~180–240px tall; now ~255–330px with feed present. Still well inside a 720px content-area budget at 1440×900.
- **Section 5 DS compliance:** sharp corners preserved on the feed container; no new tokens; no new components extracted; no rounded-corner deviations.
- **Section 6 "Hierarchy clarity":** Latest Run card remains dominant by size and content density; compact feed is visually secondary, reinforcing the primary-monitoring goal.
- **Section 6 "Visual restraint":** the feed replaces a decorative icon strip with scannable information rows — fewer visual tricks, more content. Net restraint gain.

### Concept doc updated

Added a "Phase 3a revision" note at the end of `run-a-concept.md` recording this drift from §7. The original §7 is preserved as authored; the revision supersedes it for implementation.

---

## Phase 3a polish round 3 — hero-spanning activity pill

Mode 2 alignment exploration resolved in favor of Option C (hero-spanning header). Three approaches were proposed inline; Option C picked for its semantic honesty, preserved cyan isolation, and zero-cost structural shift.

### Decision

The activity pill was lifted out of the left zone and promoted to a hero-spanning position above the 75/25 grid. Latest Run card and budget card now share a vertical baseline; no grid-level asymmetry at the tops.

### User's reasoning (approved option)

- **Semantic honesty.** The activity pill describes the *agent* overall, not the current-work column. Promoting it one level up reflects its actual scope.
- **Von Restorff preserved.** The cyan signal keeps its spatial isolation — important for rubric Section 6 "Live-run signal strength." Options B (absorb into card) and the three-running-signals-in-one-container problem would have compromised this.
- **Lowest structural cost.** Zero new elements, zero new tokens. The pill changes position, nothing else changes.
- **Sharpened Latest Run meaning.** The card now unambiguously reads as "a specific run," not "what the agent is doing." Cleaner conceptual separation between agent-level and run-level state.
- **Graceful zero-runs.** No conditional complexity — the pill lives in the hero header regardless of whether there are any runs; the left zone's fallback "No runs yet" card sits cleanly in its slot.

**Why not Option A (symmetric eyebrows):** introduced a new informational signal (budget state indicator) to solve a layout problem — symptom-treating rather than root-cause.

**Why not Option B (pill into card):** three "running" signals inside one card (pill row + StatusBadge + cyan Loader2) reads as noise; loses spatial Von Restorff.

### Pill-grounding treatment (my call)

The risk flagged in the proposal was the pill looking "lonely" alone above a wide 1440px grid. Chose tight-proximity grounding rather than a visible separator:

- Hero wrapper uses `space-y-3` (12px), matching the existing intra-zone rhythm. The pill sits 12px above the grid — same gap as pill-to-card was in the prior layout.
- **No border-b** below the pill. A horizontal rule would read as "section divider," which is heavier than the pill deserves — the pill is a small element, not a section head. Proximity alone groups it with the grid below.
- **No decorative elevation** (no subtle bg, no padding container). The pill keeps its minimal dot + text treatment from earlier phases. *Aesthetic-Usability Effect*: restraint here.

**Principle cited:** Gestalt — *Proximity* over *Uniform Connectedness*. 12px between pill and grid is short enough that the eye groups them as one unit without needing a visual connector.

### Structural change

- `AgentOverview` hero block now wraps in an outer `space-y-3` container.
- First child: activity pill (flex row — dot + label).
- Second child: the existing `grid grid-cols-1 lg:grid-cols-[3fr_1fr]` with left and right zones. Left zone's internal `space-y-3` unchanged — now it starts directly with the Latest Run card (no pill).
- The outer `space-y-8` that separates the hero from the chart band below is preserved on the parent `AgentOverview` div.

### 1440px no-scroll

Expected delta was +4–8px. Confirmed negligible in practice: hero gains ~20px at the top (pill moved up) but left zone shrinks by ~20px (pill removed from its stack). Net increase is just the space-y-3 gap between the pill and the grid vs. the pill-to-card gap when it lived inside the left zone — zero to within rounding.

### DS compliance

Neutral. No new tokens, no new components, no new raw-palette classes. The change is pure DOM restructuring of existing elements.

### Residual items for Phase 3b onwards

- Right zone is now visually sparse (budget card only, ~140px tall). The chart band in Phase 3b may naturally fill space below the right zone; not a current-phase concern.
- If the smoke test finds the pill still looks lonely despite proximity grounding, a minimal alternative is to swap `space-y-3` to `space-y-2` (tighter) — one-line change. No escalation to borders or backgrounds unless that fails first.

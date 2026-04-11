# Chat–Feed–Tasks–Artifacts UX Design

## Context

The current Paperclip UI has Chat (BoardChat), Inbox, and Artifacts as separate pages with weak connections between them. When a user chats with the concierge and kicks off work, there's no way to watch it unfold, see tasks get created, or review artifacts without manually navigating between pages. This design defines the tight feedback loop between these surfaces.

## Design Decisions

### Navigation Structure

**Existing nav items (Dashboard, Routines, Goals, Agents, etc.) remain unchanged.** The following items are added or refined within the existing nav:

| Surface | Nav status | Purpose | Badges? |
|---------|-----------|---------|---------|
| **Chat** | Existing (BoardChat) | Conversation + real-time activity feed | No |
| **Inbox** | Existing — refined | Items needing user action (`in_review`, `blocked`, `failed`, new hires, etc.) | Yes |
| **Tasks** | New nav entry (or promoted from within Inbox) | Full task tracker — all tasks, all statuses | No |
| **Artifacts** | Existing — enhanced | Library of all work products, organized by type/project/agent | Yes — when new artifact lands |

Inbox and Tasks are separate nav items. Inbox is not just a filtered view of Tasks — it also includes non-task items like new hire approvals. The rest of the navigation (Dashboard, Routines, Goals, Agents, etc.) is unaffected.

### Layout by Screen Size

**Desktop:**
- Chat page = split pane (chat left, feed right, draggable divider)
- All other pages = full content area

**Mobile:**
- Chat page = full-screen chat. Feed accessible via pull-up drawer or toggle icon.
- All other pages = full-screen with standard navigation

**Feed is never its own nav destination.** It's always part of the Chat experience, rendered differently per screen size.

### The Feedback Loop: Chat → Feed → Destinations

#### 1. Chat message triggers work (chat → feed)
User says "build me a landing page." Agent responds conversationally in chat with an **inline text link** to the created task (not a card/embed — keeps chat lightweight and avoids competing with the feed).

Simultaneously, a **card appears in the feed** showing the task was created.

#### 2. Feed shows real-time activity (stream)
The feed shows all activity with items linking out to their permanent homes:

- "Task created: Landing Page" → links to task detail page
- "Agent X picked up the task" → links to task detail page  
- "Agent X is writing index.html..." → links to task detail page
- "Agent X submitted landing-page.html for review" → links to artifact URL
- "Task moved to In Review" → links to task detail page

**Feed item format varies by type:**
- Status changes = one-liners (icon + text + timestamp + link)
- Artifact submissions = small cards with a one-line preview

**Feed is flat chronological by default**, filterable/groupable (e.g. by task) when multiple concurrent tasks are running.

**Feed persistence:** Persistent but session-weighted. Recent activity is immediately visible. Older items load on scroll (similar to Cursor's conversation history pattern).

#### 3. Clicking through goes to permanent homes
- Task links → Task detail page (own URL within Tasks UI)
- Artifact links → Artifact's permanent page (own URL within Artifacts UI)

Artifacts have dual presence: attached to the specific task that produced them AND browsable independently in the Artifacts library.

#### 4. Notifications ripple outward
When something needs attention, notifications appear in multiple layers — the closer you are, the more detail:

| Layer | What appears |
|-------|-------------|
| **Chat thread** | Agent posts a message: "Landing page draft is ready for review → [View]" |
| **Feed card** | Card updates with review-needed status |
| **Left nav / bottom tabs** | Badge on Inbox (if task needs action) and/or Artifacts (if new artifact) |

### Badging Rules

| Event | Inbox badge? | Artifacts badge? |
|-------|-------------|-----------------|
| Task moved to `in_review` | Yes | No |
| Task `blocked` | Yes | No |
| Task `failed` | Yes | No |
| Task moved to `in_progress` | No | No |
| Task completed (after approval) | No | Only if artifact was produced |
| New artifact ready | No | Yes |
| New hire approval needed | Yes | No |

### Artifacts Page

Organized independently — by type, project, agent — not just a flat list. This makes it useful even when you don't know which task produced something. It serves as a **library** of everything ever produced.

### Task Detail Page

**URL:** `/:companyPrefix/issues/:issueId` (existing)

**Existing file:** `ui/src/pages/IssueDetail.tsx` (1695 lines) — already has comments, activity, documents, live run widget, sub-issues tabs. Needs reshaping, not rebuilding.

#### Layout

**Top: Status banner**
- When agent is actively working: prominent live status — "Agent X is working: writing index.html..." with pulsing indicator (existing `LiveRunWidget`, made more prominent)
- When task is `in_review`: sticky approval banner — "This task is ready for review → [Approve] [Request Changes]"
- Otherwise: standard status chip + metadata (assignee, priority, created date)

**Below banner: Tabs**
- **Comments** (default tab) — conversation thread with run associations
- **Artifacts** (shown only if artifacts exist) — artifact cards with individual approval actions
- **Sub-issues** — unchanged from current implementation
- **Activity** — execution history, status changes, cost summary

#### Approval Model

Two levels of approval: **artifact-level** and **task-level**.

**Artifact-level (on Work Products tab):**
- Each artifact card has Approve / Request Changes actions
- Approving marks that specific output as good
- Requesting changes notifies the agent to rework that artifact

**Task-level (sticky banner at top):**
- "Approve task" = this work is done, close it out
- "Request changes" = send back for more work

**Approval rules and safeguards:**
- **Approve task with unapproved artifacts:** Confirmation dialog — "2 artifacts haven't been individually reviewed. Approving the task will auto-approve them. Continue?"
- **Approve task with `changes_requested` artifacts:** Blocked or warned — "You've requested changes on styles.css. Resolve or dismiss that before approving the task."
- **Approve all artifacts individually:** Task stays `in_review` until user explicitly approves at the task level (approving artifacts doesn't auto-close the task)

---

## Implementation Progress

### Done

- [x] **Feed component** (`ActivityFeed.tsx`) — real-time activity stream in BoardChat split pane, 5s polling
- [x] **Mobile feed drawer** — Sheet-based bottom drawer with floating toggle button on mobile
- [x] **Event tier system** — Tier 1 (cards), Tier 2 (one-liners), Tier 3 (hidden by default)
- [x] **FeedCard component** (`FeedCard.tsx`) — rich cards for tasks, approvals, new hires with colored left border, status chips
- [x] **Status circle indicators** — Task cards use `StatusIcon`-style circles tied to task state (todo=blue, in_review=violet, done=green, etc.)
- [x] **Agent icons** — `AgentIcon` lucide icons replace circle-letter avatars throughout the feed
- [x] **Collapsed groups** — Sequential same-task events within 5min collapse into expandable "N updates to SKI-X"
- [x] **Entrance animations** — New items slide in with fade via CSS keyframes
- [x] **Active-work spinners** — Loader2 spinner on active heartbeat runs
- [x] **Time-based fading** — Older items get reduced opacity, "Earlier" separator at 5min boundary
- [x] **Contextual empty state** — Agent-state-aware messaging (all paused / no agents / active with pulse)
- [x] **"Show all activity" toggle** — Reveals hidden tier-3 events via filter dropdown

### Not Started

- [ ] **Task Detail page** — Status banner, Artifacts tab, two-level approval model
- [ ] **Nav badges** — Inbox/Artifacts badge logic based on event rules
- [ ] **Tasks nav entry** — Separate Tasks page promoted from Inbox
- [ ] **Artifacts page enhancement** — Organization by type/project/agent
- [ ] **Inline chat links** — Agent responses include text links to created tasks

## Open Questions

- Work Products tab: card layout, what metadata to show per artifact type (PR vs. preview URL vs. document)
- Whether the feed should have a small unread activity indicator on mobile (dot on toggle button)

## Key Files

| File | Role |
|------|------|
| `ui/src/components/ActivityFeed.tsx` | Main feed: tiers, collapse, animation, filtering, empty state |
| `ui/src/components/FeedCard.tsx` | Tier-1 cards: task created, approvals, new hires, status circles |
| `ui/src/components/ActivityRow.tsx` | Tier-2 one-liners with agent icons and active spinners |
| `ui/src/pages/BoardChat.tsx` | Split pane integration, mobile Sheet drawer |

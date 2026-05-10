# Handoff: Deploy the Support Concierge end-to-end

> **Audience:** A Claude Code session running on Tri's Mac mini, plus follow-up steps on Tri's dev machine where the Tailwind (trailer-booking SaaS) Next.js app lives.
>
> **Outcome at the end of this doc:** A logged-in user on `tailwind.com` can click a floating "?" button in the corner, chat with the Support Concierge, and the conversation either (a) closes with a structured intake row in Paperclip's `support_intake_packets` table, (b) escalates to a human, or (c) politely closes as not-a-bug.
>
> **Estimated wall time:** 60–90 minutes if everything goes smoothly. The two slowest steps are `pnpm install` on a fresh checkout (~5 minutes) and Tailscale cert provisioning (~30 seconds but flaky on first attempt).

---

## What you're deploying

The change set lives on the `claude/keen-leavitt-b18c38` branch of the [TriDoan1/Beacon](https://github.com/TriDoan1/Beacon) fork. Two commits:

1. `566103e8` — Phase 0: Drizzle schemas + migration `0084`, `@paperclipai/adapter-concierge`, support API routes (sessions/turns/replay/theme), Supabase JWT verification via JWKS, in-memory rate limiting, cost caps.
2. `dbe15f15` — Phase 1A: `@paperclipai/support-widget` npm package (Shadow DOM mount, SSE client, session manager, screenshot upload via host `onCapture` hook), `POST /api/support/sessions/:id/assets` upload route, theme endpoint returning real data.

There is one open draft PR ([Beacon#1](https://github.com/TriDoan1/Beacon/pull/1)) covering both. **Do not wait for it to merge** — work directly off this branch on the Mac mini.

The architecture in one paragraph: the **Concierge** is a Paperclip "employee" (a row in the `agents` table with `adapter_type = 'concierge'`). It is **not** driven by Paperclip's normal heartbeat run loop — instead, end-users hit `/api/support/*` HTTP routes directly, and the Concierge adapter calls Anthropic's API in-process with three custom tools (`submit_intake_packet`, `request_human`, `not_a_bug_close`). End-users authenticate by handing the widget their existing Supabase access token from the host product (Tailwind), which Paperclip verifies via Supabase's JWKS endpoint — no shared HMAC secret to manage. The widget is a Shadow-DOM-isolated React component shipped as an npm package that mounts into any host page.

---

## Prerequisites (verify before starting)

Run these checks. **If any fail, stop and resolve before continuing** — the rest of the doc assumes they pass.

```sh
# Required CLIs
node --version            # expect ≥ 20.x (project uses Node 24+ in CI; 20 should work)
pnpm --version            # expect ≥ 9.0
git --version             # any modern version
gh --version              # GitHub CLI, for cloning the private fork if needed

# Required services / accounts
echo $ANTHROPIC_API_KEY   # must be set; if empty, get one from https://console.anthropic.com
                          # (the Concierge adapter calls Anthropic directly — no key, no chat)

# Tailscale (only needed for Phase D below — public exposure)
tailscale version         # expect ≥ 1.70 with Funnel support
                          # if missing: `brew install --cask tailscale`
```

You also need:

- **Read/write SSH or HTTPS access to `TriDoan1/Beacon`** on GitHub. Verify with `gh auth status` — you should see `TriDoan1` listed as logged-in.
- **The Supabase project URL and audience** for Tailwind's auth. Default audience for Supabase access tokens is `authenticated`. The project URL looks like `https://<project-ref>.supabase.co`.
- **No port 3100 conflict** on the Mac mini. `lsof -iTCP:3100 -sTCP:LISTEN` should be empty. If something else is using 3100, kill it or change the port (instructions below).

---

## Part 1 — Mac mini: bring up Paperclip with the Concierge

### A. Clone and install

```sh
mkdir -p ~/Projects && cd ~/Projects

# If you already have ~/Projects/Beacon from earlier work, skip the clone.
if [ ! -d Beacon ]; then
  gh repo clone TriDoan1/Beacon
fi

cd Beacon

# Switch to the branch with the support work. Once Beacon#1 is merged, this
# step becomes `git checkout master` instead.
git fetch origin claude/keen-leavitt-b18c38
git checkout claude/keen-leavitt-b18c38
git pull origin claude/keen-leavitt-b18c38

# Install the entire workspace. This takes ~3–5 minutes on a cold cache and
# will print warnings about peer dep mismatches in better-auth — those are
# pre-existing and unrelated to this work.
pnpm install
```

**Verify:** `pnpm list --depth -1 | head` should show `@paperclipai/adapter-concierge` and `@paperclipai/support-widget` as workspace members.

### B. Configure environment

Create `~/Projects/Beacon/.env.local` (this file is gitignored):

```sh
cat > .env.local <<'EOF'
# Required: the Concierge adapter calls Anthropic directly.
ANTHROPIC_API_KEY=sk-ant-...replace-me...

# Optional: pin the dev server port. Default is 3100; change only if
# something else owns the port.
# PAPERCLIP_PORT=3100

# Leave DATABASE_URL unset for the embedded PGlite dev DB. Set it only if you
# want to use a real Postgres (e.g. Supabase) — see the appendix.
# DATABASE_URL=postgresql://...

# Auto-apply migrations on boot. Required for the new 0084 migration to land.
PAPERCLIP_MIGRATION_AUTO_APPLY=true
PAPERCLIP_MIGRATION_PROMPT=never
EOF
```

> **Note on the Anthropic key**: this is the only place it lives. The widget never sees it. The key only sees Paperclip's process on the Mac mini.

### C. Start the server (dev mode)

```sh
# This runs migrations on boot, builds workspace dependencies, and serves
# both the API and the operator UI on port 3100.
pnpm dev
```

Watch the logs for these lines:

- `Embedded Postgres ready` (or `Connected to <DATABASE_URL>` if you set one)
- `Applied migration 0084_conscious_longshot`
- `API listening on http://localhost:3100`
- `UI served from /api/...` or similar

If you see `Migration 0084 failed`, see the troubleshooting section.

**Verify in a second terminal:**

```sh
curl -s http://localhost:3100/api/health
# Expected: {"status":"ok",...}

# Confirm the support route is mounted (no auth here, so 400 is correct):
curl -s -X POST http://localhost:3100/api/support/sessions \
  -H 'content-type: application/json' -d '{}'
# Expected: {"error":"missing_product_key"}
```

### D. Create your company and Concierge employee

The fastest path is direct SQL via PGlite's CLI. Open a third terminal:

```sh
cd ~/Projects/Beacon

# Find your DB url. PGlite stores its data at data/pglite by default.
# We'll use Drizzle's psql-style CLI.
pnpm --filter @paperclipai/db exec drizzle-kit studio &
# This opens https://local.drizzle.studio in a browser. Use it as a GUI for
# the next steps, OR continue with the curl-based approach below.
```

**Either** use Drizzle Studio's UI to insert rows, **or** issue these inserts via the Paperclip API. Using the API is cleaner because it goes through validation:

```sh
# 1. Get your default company (Paperclip seeds one on first boot).
COMPANY_ID=$(curl -s http://localhost:3100/api/companies | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["companies"][0]["id"])')
echo "Company: $COMPANY_ID"

# 2. Create the Concierge agent.
AGENT_RESPONSE=$(curl -s -X POST "http://localhost:3100/api/companies/$COMPANY_ID/agents" \
  -H 'content-type: application/json' \
  -d '{
    "name": "Tailwind Support",
    "role": "support",
    "adapterType": "concierge",
    "adapterConfig": {
      "model": "claude-haiku-4-5-20251001",
      "maxTurnsPerSession": 40,
      "productKey": "tailwind"
    }
  }')
echo "$AGENT_RESPONSE" | python3 -m json.tool
AGENT_ID=$(echo "$AGENT_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
echo "Agent: $AGENT_ID"
```

> **If `POST /api/companies/:id/agents` returns 400 with adapter validation errors**: that route may not yet allow `adapterType: "concierge"` for board users — `concierge` is in `BUILTIN_ADAPTER_TYPES` but the validator might be enum-locked. If so, fall back to direct SQL via Drizzle Studio:
>
> ```sql
> INSERT INTO agents (company_id, name, role, adapter_type, adapter_config)
> VALUES (
>   '<COMPANY_ID>',
>   'Tailwind Support',
>   'support',
>   'concierge',
>   '{"model": "claude-haiku-4-5-20251001", "maxTurnsPerSession": 40, "productKey": "tailwind"}'::jsonb
> ) RETURNING id;
> ```

### E. Bind the agent to the `tailwind` product

There is no operator UI form for `support_widget_configs` yet (Phase 3 deliverable). Insert via Drizzle Studio or `psql`:

```sql
INSERT INTO support_widget_configs (
  company_id, agent_id, product_key, product_label,
  supabase_project_url,
  supabase_audience,
  allowed_origins,
  per_session_token_cap_usd_cents,
  per_user_daily_token_cap_usd_cents,
  per_ip_hourly_rate_limit
) VALUES (
  '<COMPANY_ID>',                                         -- from step D
  '<AGENT_ID>',                                           -- from step D
  'tailwind',
  'Tailwind',
  'https://<your-supabase-project-ref>.supabase.co',     -- e.g. https://abcd1234.supabase.co
  'authenticated',                                        -- Supabase default
  '["https://tailwind.com","https://www.tailwind.com","http://localhost:3000"]'::jsonb,
  100,    -- $1.00 per session
  500,    -- $5.00 per end-user per day
  10      -- 10 sessions per IP per hour
);
```

> Replace `<COMPANY_ID>`, `<AGENT_ID>`, and the Supabase project ref with real values. Add any other origins you serve Tailwind from (preview deployments on Vercel, staging, etc.).

**Verify:** the theme endpoint should now return real data:

```sh
curl -s http://localhost:3100/api/support/products/tailwind/theme | python3 -m json.tool
# Expected: {"productKey":"tailwind","productLabel":"Tailwind","theme":{},"enabled":{...}}
```

If you get `{"error":"product_not_found"}`, your insert didn't take — re-check `support_widget_configs`.

---

## Part 2 — Mac mini: expose Paperclip publicly via Tailscale Funnel

Vercel can't reach `localhost:3100` on a Mac mini behind home NAT. **Plain Tailscale won't work either** — only tailnet members would have access. Use **Funnel**, which gives a public HTTPS URL routed through Tailscale's edge.

### F. Authenticate the device

```sh
# If not already on the tailnet:
sudo tailscale up

# After this completes, find the device's tailnet name:
tailscale status | head -1
# Example output line: "100.64.x.x  mac-mini.tail-abc.ts.net  ..."
# The "mac-mini.tail-abc.ts.net" is your TAILNET_HOSTNAME.

export TAILNET_HOSTNAME=$(tailscale status --self --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
echo "Tailnet hostname: $TAILNET_HOSTNAME"
```

### G. Provision the TLS cert

This step is sometimes flaky on the first try — re-run if it errors out.

```sh
sudo tailscale cert "$TAILNET_HOSTNAME"
```

### H. Enable Funnel for port 3100

```sh
sudo tailscale funnel --bg --https=443 localhost:3100
sudo tailscale funnel status

# Verify from outside:
curl -s "https://$TAILNET_HOSTNAME/api/health"
# Expected: {"status":"ok",...}

# Smoke-test the support route from a "remote" perspective:
curl -s -X POST "https://$TAILNET_HOSTNAME/api/support/sessions" \
  -H 'content-type: application/json' -d '{}'
# Expected: {"error":"missing_product_key"}
```

### I. Make Funnel survive reboots (optional but recommended)

Without launchd, Funnel does NOT auto-restart after a Mac mini reboot. Drop in a launchd plist:

```sh
sudo tee /Library/LaunchDaemons/com.tailscale.paperclip-funnel.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.tailscale.paperclip-funnel</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/bin/tailscale</string>
      <string>funnel</string>
      <string>--https=443</string>
      <string>localhost:3100</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/var/log/paperclip-funnel.log</string>
    <key>StandardErrorPath</key><string>/var/log/paperclip-funnel.err</string>
</dict>
</plist>
EOF

sudo launchctl load -w /Library/LaunchDaemons/com.tailscale.paperclip-funnel.plist
```

> **If `tailscale` isn't at `/usr/local/bin/tailscale`**: run `which tailscale` and update the plist path. Apple Silicon Macs often have it at `/opt/homebrew/bin/tailscale` (Homebrew Tailscale) or `/Applications/Tailscale.app/Contents/MacOS/Tailscale` (App Store).

You also need the Paperclip server itself to survive reboots — set up a similar plist or a tmux/screen autostart, OR just remember to `cd ~/Projects/Beacon && pnpm dev` after each reboot until you migrate Paperclip off the Mac mini.

---

## Part 3 — Dev machine: integrate the widget into Tailwind

> **Switch context to your dev machine** (the one with `~/Projects/Tailwind`). The Mac mini is done — leave Paperclip running there.

### J. Install the widget package

The package isn't on npm yet. Two options:

**Option 1 — file: link (good for early dev, fast iteration):**

If your dev machine is the same as the Mac mini, just point at the workspace path:

```sh
cd ~/Projects/Tailwind
pnpm add file:../Beacon/packages/support-widget html2canvas
```

If your dev machine is separate, `rsync` the built widget over:

```sh
# On Mac mini:
cd ~/Projects/Beacon
pnpm --filter @paperclipai/support-widget build
# This produces packages/support-widget/dist/

# On dev machine (replace user@mac-mini with your tailnet name):
rsync -avz user@mac-mini.tail-abc.ts.net:~/Projects/Beacon/packages/support-widget/ \
  ./vendor/support-widget/
cd ~/Projects/Tailwind
pnpm add file:./vendor/support-widget html2canvas
```

**Option 2 — npm pack tarball (more isolated, slower iteration):**

```sh
# On Mac mini:
cd ~/Projects/Beacon/packages/support-widget
pnpm build
npm pack   # produces paperclipai-support-widget-0.1.0.tgz

# Copy that tarball to your dev machine, then:
cd ~/Projects/Tailwind
pnpm add ../path/to/paperclipai-support-widget-0.1.0.tgz html2canvas
```

### K. Set Vercel env vars

In the Tailwind project on Vercel (or `.env.local` for local dev):

```
NEXT_PUBLIC_PAPERCLIP_API_URL=https://<your-tailnet-hostname>.ts.net
```

> Use the same `TAILNET_HOSTNAME` you echoed in step F. **No trailing slash.**

For local Tailwind dev (`localhost:3000`), put this in `~/Projects/Tailwind/.env.local`. Restart `pnpm dev` after editing.

### L. Update CSP

Find Tailwind's existing CSP header — likely in `next.config.mjs`, in middleware at `src/middleware.ts`, or in a custom `_document` file. Add:

```
connect-src 'self' https://<your-tailnet-hostname>.ts.net;
```

Without this, the browser silently blocks the `fetch()` call to Paperclip and you'll see "Failed to fetch" with no obvious cause. If Tailwind has no CSP set, skip this step.

### M. Create the Support Widget component

```tsx
// src/components/SupportWidget.tsx
"use client";

import { useEffect } from "react";
import { mountSupportWidget } from "@paperclipai/support-widget";
import html2canvas from "html2canvas";
import { createBrowserClient } from "@supabase/ssr"; // or whatever you already use

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const apiUrl = process.env.NEXT_PUBLIC_PAPERCLIP_API_URL!;

export function SupportWidget() {
  useEffect(() => {
    if (!apiUrl || !supabaseUrl) return;
    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    let handle: { destroy: () => void } | null = null;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return; // not signed in — don't mount

      handle = mountSupportWidget({
        apiUrl,
        productKey: "tailwind",
        getAccessToken: async () => {
          const { data } = await supabase.auth.getSession();
          return data.session?.access_token ?? "";
        },
        container: document.body,
        onCapture: async () => {
          const canvas = await html2canvas(document.body, {
            useCORS: true,
            logging: false,
          });
          return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob_failed"))));
          });
        },
        onStateChange: (state) => {
          // Optional analytics hook. Fires on phase transitions.
          // console.log("[support]", state);
        },
      });
    })();

    return () => {
      handle?.destroy();
    };
  }, []);

  return null;
}
```

> Adjust the Supabase import to match what Tailwind already uses (`@supabase/ssr`, `@supabase/auth-helpers-nextjs`, etc.). The shape that matters: get the current access token, return it as a string.

### N. Mount in the authenticated layout

Find the layout for logged-in pages (probably `src/app/(authenticated)/layout.tsx` or similar). Add:

```tsx
import { SupportWidget } from "@/components/SupportWidget";

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SupportWidget />
    </>
  );
}
```

If Tailwind doesn't have a route group split between authenticated/anonymous, mount it in your top-level `RootLayout` and let the component itself bail out when there's no session (it already does).

### O. Handle Next.js peer dep quirks

Some Next.js versions require an extra hint to consume a `file:`-linked workspace package:

```js
// next.config.mjs
export default {
  // ... your existing config
  transpilePackages: ["@paperclipai/support-widget", "@paperclipai/shared"],
};
```

If you skip this and see `SyntaxError: Cannot use import statement outside a module` from inside the widget, this is the fix.

### P. Test locally

```sh
cd ~/Projects/Tailwind
pnpm dev
# Open http://localhost:3000, sign in, see the floating "?" button bottom-right.
```

Click it. You should see "Hi — I'm here to help. What were you trying to do, and what happened instead?". Type something. Watch tokens stream in.

---

## Part 4 — Verify the end-to-end loop

Three checks, in order. **All three must pass before you ship to Vercel production.**

### Check 1: Token verification works

```sh
# On the Mac mini, tail Paperclip logs:
tail -f ~/Projects/Beacon/logs/server.log     # path may differ; or just watch `pnpm dev` output

# On the dev machine, in browser dev tools console:
fetch(`${process.env.NEXT_PUBLIC_PAPERCLIP_API_URL}/api/support/sessions`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${(await window.supabase.auth.getSession()).data.session.access_token}`,
  },
  body: JSON.stringify({ productKey: "tailwind", initialContext: { url: location.href } })
}).then(r => r.json()).then(console.log)
```

Expected: `{"sessionId":"...","modelUsed":"claude-haiku-4-5-20251001","greeting":"Hi — ...","status":"active"}`.

If you see `{"error":"invalid_token"}`: your `supabase_project_url` in `support_widget_configs` is wrong, OR the token's `aud` claim doesn't match `supabase_audience`. Check by base64-decoding the JWT payload at jwt.io and looking at `aud` and `iss`.

### Check 2: A turn streams a real response

Open the widget, type "I tried to book a trailer and the checkout button did nothing." Watch tokens appear character-by-character. When the bot has enough info (usually within 2 turns), it calls a tool and you'll see a `Filing your report — we'll be in touch shortly.` banner.

### Check 3: The intake row is in the database

On the Mac mini:

```sh
psql "$DATABASE_URL" -c "
  SELECT s.id, s.status, s.close_reason, s.spend_usd_cents, s.turn_count,
         p.what_user_was_doing, p.what_happened, p.repro_steps
  FROM support_sessions s
  LEFT JOIN support_intake_packets p ON p.session_id = s.id
  ORDER BY s.opened_at DESC LIMIT 5;
"
```

Or with PGlite (Drizzle Studio's table browser, or `pnpm --filter @paperclipai/db exec tsx -e '...'`).

You should see the row with `close_reason = 'intake_submitted'` and the structured packet fields populated.

### If all three pass: deploy to Vercel.

```sh
cd ~/Projects/Tailwind
git add -A && git commit -m "Add Paperclip Support Concierge widget"
git push
# Vercel auto-deploys. Set NEXT_PUBLIC_PAPERCLIP_API_URL in the Vercel
# project's env settings if you haven't already.
```

---

## Troubleshooting

### Server side

| Symptom | Likely cause | Fix |
|---|---|---|
| `500 anthropic_api_key_missing` on first turn | `ANTHROPIC_API_KEY` not in process env | Add to `.env.local`, restart `pnpm dev` |
| `Migration 0084 failed: relation X already exists` | Migration ran partially before; tables exist but tracking row missing | Drop the duplicate tables manually, re-apply, OR migrations are idempotent (`IF NOT EXISTS`) so this should not happen — file an issue if it does |
| `403 origin_not_allowed` | The host's `Origin` header isn't in `support_widget_configs.allowed_origins` | Update the row to include the exact origin, including protocol and port |
| `403 widget_disabled` | `support_widget_configs.enabled.widget` is `false` | Update the row: `UPDATE support_widget_configs SET enabled = '{"widget":true,"email":false,"sms":false}'::jsonb WHERE product_key = 'tailwind';` |
| `429 rate_limited` during testing | In-memory token bucket — you tripped the per-IP cap | Either wait an hour, increase `per_ip_hourly_rate_limit`, or `pkill -f tsx` and restart Paperclip to reset the buckets |
| `402 session_cost_cap_exceeded` | The `per_session_token_cap_usd_cents` (default 100 = $1) is too low for your tests | Increase via `support_widget_configs` |
| Concierge gives a single short reply then nothing | Tools are not being called because the model thinks it should keep gathering info | Adjust the system prompt via `agents.adapter_config.systemPrompt` to tighten the "when to submit" criteria |

### Client side

| Symptom | Likely cause | Fix |
|---|---|---|
| Widget never appears | `useEffect` dependency wrong, or no Supabase session | Open dev tools console; the widget logs `[support-widget]` on mount errors |
| `Failed to fetch` with no further detail | CSP blocking `connect-src` to the tailnet host | Add the host to your CSP `connect-src` directive |
| `CORS blocked` | Origin not in allowlist OR preflight not handled | Server emits `Access-Control-Allow-Origin: <origin>` only when origin is allowlisted; check `support_widget_configs.allowed_origins` and the OPTIONS handler is matching |
| `Cannot use import statement outside a module` | Next.js doesn't transpile the workspace package | Add `transpilePackages: ["@paperclipai/support-widget", "@paperclipai/shared"]` to `next.config.mjs` |
| `Cannot read properties of undefined (reading 'access_token')` | User isn't signed in but the widget tried to mount anyway | The example component already guards on `data.session` — make sure your guard matches your auth helper |
| Streaming text appears all at once at the end | Compression is buffering the SSE stream | Most Funnel + Vercel paths handle this. If you proxy through anything else (Cloudflare, nginx), disable compression on `text/event-stream` |

### Tailscale Funnel

| Symptom | Fix |
|---|---|
| `tailscale funnel: not enabled in this tailnet` | Funnel must be allowed in your tailnet ACL. Edit at https://login.tailscale.com/admin/acls → add `"funnel": ["tag:server"]` or similar |
| Cert provisioning hangs | First run takes up to 30 seconds. If it errors, retry — it's flaky. If it keeps failing, check `tailscale status` shows the device as `idle` not `expired`. |
| URL works locally but not from outside the tailnet | You used `serve` not `funnel`. `serve` is tailnet-only. Re-run with `funnel`. |

---

## Operational notes (after the loop is working)

- **Mac mini sleeps** are the most common cause of widget downtime. System Preferences → Energy → "Prevent computer from sleeping when display is off" → ON.
- **Anthropic API outages** show up as `error` events in the SSE stream. The widget already shows "Something went wrong on our side." Users can retry.
- **Cost monitoring**: query `SELECT product_key, SUM(spend_usd_cents) FROM support_sessions WHERE opened_at > now() - interval '24 hours' GROUP BY product_key;` daily, or wait for the cost dashboard PR.
- **Prompt iteration**: the system prompt lives in `agents.adapter_config.systemPrompt`. Update with `UPDATE agents SET adapter_config = jsonb_set(adapter_config, '{systemPrompt}', '"new prompt here"'::jsonb) WHERE id = '...';`. New sessions pick it up immediately; in-flight sessions keep the old prompt until they end.
- **Disabling the widget temporarily**: `UPDATE support_widget_configs SET enabled = '{"widget":false,...}'::jsonb WHERE product_key = 'tailwind';`. The host page's mount call will now get `403 widget_disabled` and the launcher won't show.

---

## Definition of Done

- [ ] Mac mini runs Paperclip via `pnpm dev` and survives basic restart
- [ ] `curl https://<tailnet>.ts.net/api/health` returns `{"status":"ok"}` from outside the home network
- [ ] `support_widget_configs` row exists for `product_key = 'tailwind'` with the right Supabase URL and origin allowlist
- [ ] `agents` row exists with `adapter_type = 'concierge'`, role `'support'`, model configured
- [ ] Tailwind locally (`localhost:3000`) shows the floating launcher when signed in
- [ ] A test conversation produces a `support_sessions` row with `close_reason = 'intake_submitted'` and a corresponding `support_intake_packets` row
- [ ] Vercel deployment of Tailwind also shows the launcher and successfully chats
- [ ] You've intentionally tested the cost-cap path by setting `per_session_token_cap_usd_cents` to 1 cent, confirming the panel shows "This conversation has reached its limit."
- [ ] You've reset the cap back to a sane value before going home

---

## What's NOT in this deployment (and when to plan for them)

These are tracked as Phase 1B / Phase 2 and don't block the loop above, but you'll want them within the first 100 real users:

1. **Last-Event-ID mid-stream resume** — currently, a connection drop mid-assistant-token loses the partial response on the client side. Reload-resume works fine; live mid-stream doesn't.
2. **Issue auto-creation from intake packets** — packets sit on their own table; you currently have to triage them manually. The PR after Phase 1A will create an `issues` row so existing Paperclip employees can pick up triage.
3. **Outbound webhooks** for `intake_submitted` and `session_closed` so Tailwind can email users via Resend ("we got your report, ticket #ABC"). Right now users only see the in-widget acknowledgement.
4. **Operator UI for Concierge config** — model picker, prompt editor, origin allowlist editing, secret rotation. Without this you're updating `agents.adapter_config` and `support_widget_configs` via SQL.
5. **Test Concierge sandbox** — chat with your own Concierge as an operator before pushing prompt changes to live.
6. **Resend inbound-email + Twilio inbound-SMS handlers** — the routes exist as 501 stubs. Wire them up to make support work via email and SMS using the same Concierge employee.
7. **Move Paperclip off the Mac mini** to Fly.io / Railway / a small VPS once you're past the private-beta phase. The Mac mini's reliability ceiling is the same as your home internet's.

---

## Appendix A — Direct DB access on the Mac mini

PGlite stores data at `~/Projects/Beacon/data/pglite/`. To open it directly:

```sh
cd ~/Projects/Beacon
# Drizzle Studio (web UI):
pnpm --filter @paperclipai/db exec drizzle-kit studio
# Opens https://local.drizzle.studio in your default browser.

# Or run a one-shot SQL via tsx:
pnpm --filter @paperclipai/db exec tsx -e "
  import { client } from './packages/db/src/client.ts';
  const c = await client();
  const rows = await c.execute(\`SELECT id, name, role, adapter_type FROM agents\`);
  console.log(JSON.stringify(rows, null, 2));
"
```

If you set `DATABASE_URL` to a real Postgres (Supabase, RDS, etc.), use `psql "$DATABASE_URL"`.

---

## Appendix B — curl smoke tests

Save these as `~/Projects/Beacon/scripts/smoke-support.sh` and run after any change to the support routes:

```sh
#!/usr/bin/env bash
set -euo pipefail
API="${PAPERCLIP_API_URL:-http://localhost:3100}"
TOKEN="${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN to a real Supabase JWT}"

echo "1. Theme endpoint:"
curl -s "$API/api/support/products/tailwind/theme" | python3 -m json.tool

echo
echo "2. Open session:"
SESSION=$(curl -s -X POST "$API/api/support/sessions" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"productKey":"tailwind","initialContext":{"url":"https://test","routePath":"/"}}')
echo "$SESSION" | python3 -m json.tool
SESSION_ID=$(echo "$SESSION" | python3 -c 'import json,sys; print(json.load(sys.stdin)["sessionId"])')

echo
echo "3. Send a turn (raw SSE — Ctrl+C when complete):"
curl -N -X POST "$API/api/support/sessions/$SESSION_ID/turns" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"message":"My checkout button does nothing"}'
```

To get a `SUPABASE_ACCESS_TOKEN` for testing: sign into Tailwind in your browser, open dev tools, run `(await supabase.auth.getSession()).data.session.access_token` in the console, copy the string.

---

## Appendix C — When you finish, capture state

After the loop is working end-to-end, dump the live config so it's reproducible:

```sh
psql "$DATABASE_URL" -c "
  SELECT row_to_json(t) FROM (
    SELECT a.name, a.role, a.adapter_type, a.adapter_config,
           c.product_key, c.product_label, c.allowed_origins,
           c.per_session_token_cap_usd_cents,
           c.per_user_daily_token_cap_usd_cents,
           c.per_ip_hourly_rate_limit
    FROM agents a
    JOIN support_widget_configs c ON c.agent_id = a.id
    WHERE a.adapter_type = 'concierge'
  ) t;
" > ~/Projects/Beacon/scripts/concierge-config.snapshot.json
```

Commit that snapshot. If you ever wipe the database, you can re-create the rows from it.

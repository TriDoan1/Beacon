# Support Concierge — host integration guide

The Support Concierge is a live-chat agent that runs as a Paperclip employee and
talks directly with end-users of one of your products (e.g. Tailwind). It
gathers structured intake (what they were doing, what happened, repro steps,
context telemetry) and either creates a downstream issue, escalates to a human,
or politely closes the session if it isn't a bug.

This doc covers Phase 0: the schema, adapter, and HTTP API. The npm widget
package, operator-UI configuration form, and webhook delivery are tracked in
follow-up PRs.

---

## 1. What ships in Phase 0

- Drizzle schemas + migration `0084_conscious_longshot.sql` for
  `support_sessions`, `support_messages`, `support_intake_packets`,
  `support_end_users`, and `support_widget_configs`.
- `@paperclipai/adapter-concierge` — Anthropic SDK wrapper with three
  side-effect tools: `submit_intake_packet`, `request_human`,
  `not_a_bug_close`. Default tools are disabled.
- Server routes (mounted on `app`, **not** the `/api` operator-only router):
  - `POST   /api/support/sessions`
  - `POST   /api/support/sessions/:sessionId/turns` (SSE)
  - `GET    /api/support/sessions/:sessionId/replay?afterSeq=N`
  - `GET    /api/support/products/:productKey/theme`
  - `OPTIONS /api/support/*splat` (CORS preflight)
  - `POST   /api/support/inbound/email` (501 stub — Resend later)
  - `POST   /api/support/inbound/sms` (501 stub — Twilio later)
- Adapter type `concierge` registered in `BUILTIN_ADAPTER_TYPES`.

End-user authentication uses Supabase JWTs verified directly via the project's
JWKS endpoint. There is no shared HMAC secret to rotate.

---

## 2. Setting up a Concierge employee

For each product you want to surface support on, do the following inside
Paperclip (until the operator UI form lands, this is via direct DB rows or the
existing `POST /api/companies/:companyId/agents` endpoint):

1. **Create the agent** (the "Support" employee):
   ```jsonc
   {
     "name": "Tailwind Support",
     "role": "support",
     "adapterType": "concierge",
     "adapterConfig": {
       "model": "claude-haiku-4-5-20251001",       // configurable per agent
       "systemPrompt": null,                        // null = use default
       "greeting": null,                            // null = use default
       "maxTurnsPerSession": 40,
       "productKey": "tailwind"
     }
   }
   ```

2. **Insert a `support_widget_configs` row** linking that agent to a product:
   ```sql
   INSERT INTO support_widget_configs (
     company_id, agent_id, product_key, product_label,
     supabase_project_url, supabase_audience,
     allowed_origins,
     per_session_token_cap_usd_cents,
     per_user_daily_token_cap_usd_cents,
     per_ip_hourly_rate_limit
   ) VALUES (
     '<your company id>', '<the concierge agent id>', 'tailwind', 'Tailwind',
     'https://<project-ref>.supabase.co',
     'authenticated',
     '["https://tailwind.com","https://www.tailwind.com","http://localhost:3000"]'::jsonb,
     100,    -- $1.00 per session
     500,    -- $5.00 per end-user per day
     10      -- 10 sessions per IP per hour
   );
   ```

3. **Set `ANTHROPIC_API_KEY` in the Paperclip environment.** The Concierge
   adapter calls the Anthropic API directly; without this var the route returns
   `500 anthropic_api_key_missing`.

---

## 3. Hosting Paperclip on the Mac mini (Tailscale Funnel)

The widget on `tailwind.com` (Vercel) needs to reach Paperclip running on the
Mac mini. **Plain Tailscale won't work** — only tailnet members would be able to
reach it. Use **Tailscale Funnel**, which gives you a public HTTPS URL.

```sh
# Install Tailscale on the Mac mini
brew install --cask tailscale

# Authenticate the device into your tailnet
sudo tailscale up

# Enable HTTPS certs for your tailnet
sudo tailscale cert <machine>.<tailnet>.ts.net

# Forward Paperclip's port 3100 over Funnel
sudo tailscale funnel --bg --https=443 localhost:3100
sudo tailscale funnel status   # verify
```

Your public URL is now `https://<machine>.<tailnet>.ts.net`. Use it as
`NEXT_PUBLIC_PAPERCLIP_API_URL` on Tailwind.

> **Caveat for v1**: the Mac mini will sleep, restart, and reset its IP. Plan
> to migrate Paperclip to Fly.io / Railway / a small VPS before the widget goes
> to a meaningful audience.

---

## 4. Wiring it into Tailwind (Next.js 14)

The npm package ships in a follow-up PR. Until then you can drive the API
directly. Three steps:

### 4.1 Open a session

```ts
// src/app/(authenticated)/support/_session.ts
"use client";

import { createClient } from "@supabase/supabase-js";

export async function openSupportSession() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not_signed_in");

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_PAPERCLIP_API_URL}/api/support/sessions`,
    {
      method: "POST",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        productKey: "tailwind",
        initialContext: {
          url: window.location.href,
          routePath: window.location.pathname,
          userAgent: navigator.userAgent,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: navigator.language,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`open_session_${res.status}`);
  return res.json() as Promise<{
    sessionId: string;
    modelUsed: string;
    greeting?: string;
    status: "active";
  }>;
}
```

### 4.2 Stream a turn

```ts
export async function streamTurn(
  sessionId: string,
  message: string,
  onText: (delta: string) => void,
  onDone: (closeReason: string | null) => void,
) {
  const supabase = createClient(/* ... */);
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_PAPERCLIP_API_URL}/api/support/sessions/${sessionId}/turns`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session!.access_token}`,
      },
      body: JSON.stringify({ message }),
    },
  );
  if (!res.ok || !res.body) throw new Error(`turn_${res.status}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const eventLine = frame.split("\n").find((l) => l.startsWith("event: "));
      const dataLine = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!eventLine || !dataLine) continue;
      const eventName = eventLine.slice(7).trim();
      const data = JSON.parse(dataLine.slice(6));
      if (eventName === "text") onText(data.delta);
      if (eventName === "complete") onDone(data.closeReason);
    }
  }
}
```

### 4.3 Required CSP entries

If Tailwind sets a Content-Security-Policy, add:

- `connect-src https://<machine>.<tailnet>.ts.net`
- `frame-ancestors 'self'` (the widget mounts in-process, no iframe yet)

---

## 5. SSE event reference

The `POST /turns` endpoint emits these events, separated by `\n\n`:

| event              | data shape                                         | when                          |
|--------------------|----------------------------------------------------|-------------------------------|
| `text`             | `{ delta: string }`                                | each assistant token chunk    |
| `tool_call`        | `{ id, name, arguments }`                          | each tool the model invoked   |
| `session_will_close` | `{ tool: string }`                               | terminal tool was called      |
| `error`            | `{ message: string }`                              | LLM call or persistence error |
| `complete`         | `{ assistantMessageSeq, status, closeReason }`     | always last                   |

Each `complete` event carries an `id: <seq>` line, so on reconnect the client
should send `Last-Event-ID: <last-seq>` (Phase 1 will honor this on the replay
endpoint).

---

## 6. Limits and failure modes

- **Per-session token cap**: stored on `support_widget_configs`. When breached
  the route returns `402 session_cost_cap_exceeded` and closes the session
  with `closeReason = "cost_cap"`.
- **Per-user daily cap**: same idea, applied at session-open time. Returns
  `429 user_daily_cap_exceeded`.
- **Per-IP hourly limit**: in-memory token bucket. Returns
  `429 rate_limited`.
- **Origin not allowlisted**: `403 origin_not_allowed`.
- **Supabase token invalid/expired**: `401 invalid_token`.
- **`ANTHROPIC_API_KEY` missing on the Paperclip server**: `500
  anthropic_api_key_missing`.

When Paperclip is unreachable (Mac mini reboot, Funnel down), Tailwind should
degrade to a "save and email" form so users aren't stranded — handled in the
widget package PR.

---

## 7. Embedding `@paperclipai/support-widget` (recommended)

The `packages/support-widget/` workspace package replaces the manual fetch +
SSE parsing from §4 with a single mount call. While we're not on npm yet,
Tailwind can consume it via `file:` link or `npm pack` tarball.

### 7.1 Install

From the Paperclip repo:

```sh
pnpm --filter @paperclipai/support-widget build
```

Then in Tailwind's `package.json`, point at the built package:

```json
{
  "dependencies": {
    "@paperclipai/support-widget": "file:../Paperclip/packages/support-widget"
  }
}
```

### 7.2 Mount

```tsx
// src/components/SupportWidget.tsx
"use client";
import { useEffect } from "react";
import { mountSupportWidget } from "@paperclipai/support-widget";
import html2canvas from "html2canvas";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export function SupportWidget() {
  useEffect(() => {
    let handle: { destroy: () => void } | null = null;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      handle = mountSupportWidget({
        apiUrl: process.env.NEXT_PUBLIC_PAPERCLIP_API_URL!,
        productKey: "tailwind",
        getAccessToken: async () => {
          const { data } = await supabase.auth.getSession();
          return data.session?.access_token ?? "";
        },
        container: document.body,
        onCapture: async () => {
          const canvas = await html2canvas(document.body);
          return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("blob_failed"))));
          });
        },
      });
    })();
    return () => handle?.destroy();
  }, []);
  return null;
}
```

Mount it once in your authenticated layout. The launcher floats over every
page; click opens the panel; the conversation persists across reloads via
`localStorage` (only the session id — transcript always re-fetches from
`/replay`).

### 7.3 Theming

The widget fetches `/api/support/products/:productKey/theme` on mount and
applies any returned `primaryColor`, `accentColor`, `fontFamily` as CSS custom
properties on the host element. Theme passed via the `theme` prop overrides
the API response field-by-field. Other tokens (`--sw-bg`, `--sw-text`,
`--sw-radius`, etc.) can be overridden by setting CSS custom properties on the
mount container before calling `mountSupportWidget`.

### 7.4 Programmatic control

```ts
const handle = mountSupportWidget({ /* ... */, showLauncher: false });
handle.open();             // open the panel
handle.close();            // close (session stays active)
handle.getState();         // { phase, sessionId, closeReason, errorCode }
handle.destroy();          // tear down completely
```

Pass `onStateChange` to receive state transitions (useful for analytics).

### 7.5 What ships in this PR

- Shadow DOM mount with full CSS isolation
- Floating launcher button + chat panel (mobile sheet at <640px)
- Streaming assistant responses with per-turn tool-call indicators
- Friendly status banners for closed/error/offline states
- localStorage session resume across reloads
- Theme fetched from API + prop overrides
- Screenshot upload via `onCapture` hook (host implements capture, widget
  uploads to `/api/support/sessions/:id/assets`)
- 18 unit tests covering SSE parsing, session manager error mapping, and
  storage scoping per `productKey`

### 7.6 What's still missing (tracked in follow-ups)

- **`Last-Event-ID` mid-stream resume.** Phase 1 reconnects only between
  completed turns. A dropped connection mid-assistant-response loses that
  partial response on the client side.
- **Issue auto-creation** from `submit_intake_packet` so existing Paperclip
  employees can pick up triage.
- **Outbound webhooks** (`intake_submitted`, `session_closed`) so Tailwind
  can email users via Resend without polling.
- **Resend inbound-email + Twilio inbound-SMS handlers** to make the 501
  stubs real.
- **Operator UI**: Concierge config form (model picker, prompt editor,
  origin allowlist, secret rotation, budget caps) and a "Test Concierge"
  sandbox.
- **20-scenario eval harness** for prompt iteration.
- **Upstash Redis-backed rate limiting** (currently in-memory).
- **Playwright E2E**: launch → message → tool call → close paths against a
  fake host page.

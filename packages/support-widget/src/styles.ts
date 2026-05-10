import type { SupportWidgetTheme } from "@paperclipai/shared";

/**
 * CSS injected into the Shadow Root. Kept as a template string to avoid build
 * tooling for CSS imports. Theme tokens are mapped to CSS custom properties
 * on the host element so callers can override at runtime.
 */
export const SHADOW_CSS = `
:host {
  /* defaults — overridden by themeToCustomProperties */
  --sw-primary: #2563eb;
  --sw-primary-contrast: #ffffff;
  --sw-bg: #ffffff;
  --sw-bg-muted: #f3f4f6;
  --sw-text: #111827;
  --sw-text-muted: #6b7280;
  --sw-border: #e5e7eb;
  --sw-radius: 12px;
  --sw-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  --sw-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-family: var(--sw-font);
  color: var(--sw-text);
}

* { box-sizing: border-box; }

.launcher {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483646;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: var(--sw-primary);
  color: var(--sw-primary-contrast);
  cursor: pointer;
  box-shadow: var(--sw-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  line-height: 1;
  transition: transform 120ms ease;
}
.launcher:hover { transform: translateY(-1px); }
.launcher:focus-visible { outline: 2px solid var(--sw-primary-contrast); outline-offset: 2px; }

.panel {
  position: fixed;
  bottom: 92px;
  right: 24px;
  width: 380px;
  max-width: calc(100vw - 32px);
  height: 560px;
  max-height: calc(100vh - 120px);
  z-index: 2147483647;
  background: var(--sw-bg);
  border: 1px solid var(--sw-border);
  border-radius: var(--sw-radius);
  box-shadow: var(--sw-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (max-width: 640px) {
  .panel {
    bottom: 0;
    right: 0;
    left: 0;
    top: 0;
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
    border: none;
  }
}

.header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--sw-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.header h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.header .close {
  background: transparent;
  border: none;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: var(--sw-text-muted);
  padding: 4px;
}
.header .close:hover { color: var(--sw-text); }

.transcript {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.message {
  max-width: 85%;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.message.user {
  align-self: flex-end;
  background: var(--sw-primary);
  color: var(--sw-primary-contrast);
  border-bottom-right-radius: 4px;
}
.message.assistant {
  align-self: flex-start;
  background: var(--sw-bg-muted);
  color: var(--sw-text);
  border-bottom-left-radius: 4px;
}
.message.system {
  align-self: center;
  background: transparent;
  color: var(--sw-text-muted);
  font-size: 12px;
  font-style: italic;
}
.message .pending-cursor {
  display: inline-block;
  width: 6px;
  height: 14px;
  vertical-align: middle;
  background: currentColor;
  margin-left: 2px;
  animation: sw-blink 900ms steps(2) infinite;
  opacity: 0.6;
}
@keyframes sw-blink { 50% { opacity: 0; } }

.tool-banner {
  align-self: stretch;
  background: var(--sw-bg-muted);
  border: 1px dashed var(--sw-border);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--sw-text-muted);
}

.composer {
  border-top: 1px solid var(--sw-border);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--sw-bg);
}
.composer .row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.composer textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--sw-border);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 14px;
  background: var(--sw-bg);
  color: var(--sw-text);
  min-height: 36px;
  max-height: 140px;
  outline: none;
}
.composer textarea:focus { border-color: var(--sw-primary); }
.composer textarea:disabled { opacity: 0.6; cursor: not-allowed; }
.composer button.icon {
  background: transparent;
  border: 1px solid var(--sw-border);
  border-radius: 8px;
  width: 36px;
  height: 36px;
  cursor: pointer;
  font-size: 16px;
  color: var(--sw-text-muted);
}
.composer button.icon:hover:not(:disabled) { color: var(--sw-text); border-color: var(--sw-text-muted); }
.composer button.icon:disabled { opacity: 0.4; cursor: not-allowed; }
.composer button.send {
  background: var(--sw-primary);
  color: var(--sw-primary-contrast);
  border: none;
  border-radius: 8px;
  height: 36px;
  padding: 0 14px;
  font-weight: 600;
  cursor: pointer;
  font-size: 14px;
}
.composer button.send:disabled { opacity: 0.5; cursor: not-allowed; }
.composer .hint {
  font-size: 11px;
  color: var(--sw-text-muted);
}

.banner {
  padding: 12px 16px;
  border-top: 1px solid var(--sw-border);
  font-size: 13px;
  background: var(--sw-bg-muted);
  color: var(--sw-text-muted);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.banner.success { color: #047857; background: #ecfdf5; }
.banner.error { color: #b91c1c; background: #fef2f2; }
.banner button {
  align-self: flex-start;
  background: transparent;
  border: 1px solid currentColor;
  color: inherit;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
`;

export function themeToCustomProperties(theme: SupportWidgetTheme | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!theme) return out;
  if (theme.primaryColor) out["--sw-primary"] = theme.primaryColor;
  if (theme.accentColor) out["--sw-primary"] = theme.accentColor; // accent supersedes if both
  if (theme.fontFamily) out["--sw-font"] = theme.fontFamily;
  return out;
}

/**
 * Tiny localStorage wrapper. Persists only the session id — the message
 * transcript is always re-fetched from the server's /replay endpoint so the
 * client is never the source of truth.
 */

const STORAGE_PREFIX = "support-widget:sessionId:";

export function loadStoredSessionId(productKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + productKey);
  } catch {
    return null;
  }
}

export function storeSessionId(productKey: string, sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + productKey, sessionId);
  } catch {
    // localStorage may be disabled in private mode — best effort.
  }
}

export function clearStoredSessionId(productKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + productKey);
  } catch {
    // best effort
  }
}

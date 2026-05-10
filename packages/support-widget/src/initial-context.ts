import type { SupportSessionInitialContext } from "@paperclipai/shared";

/**
 * Capture browser-side context that the Concierge can use without asking the
 * user. The host passes through any explicit fields it wants to override.
 */
export function captureInitialContext(
  override: SupportSessionInitialContext | undefined,
): SupportSessionInitialContext {
  if (typeof window === "undefined") return override ?? {};
  const auto: SupportSessionInitialContext = {
    url: window.location.href,
    routePath: window.location.pathname,
    userAgent: window.navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    timeZone: tryTimeZone(),
    locale: window.navigator.language,
  };
  return { ...auto, ...override };
}

function tryTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

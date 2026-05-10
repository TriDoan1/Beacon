import { createRemoteJWKSet, jwtVerify, type JWTVerifyResult } from "jose";
import { logger } from "../middleware/logger.js";

/**
 * Verifies a Supabase access token using the project's JWKS endpoint.
 *
 * Tailwind (or any host product) hands the user's Supabase access token to the
 * Concierge widget. The widget posts it to /api/support/sessions to open or
 * resume a session. We verify the token's signature against the Supabase
 * project's published JWKS so we never need a shared secret.
 *
 * Per-project JWKS URLs and audience claims are stored on
 * support_widget_configs and looked up by productKey before verification.
 */

export interface SupabaseEndUserClaims {
  sub: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  aud?: string;
  iss?: string;
  exp?: number;
}

export interface VerifySupabaseTokenInput {
  token: string;
  jwksUrl: string;
  expectedIssuer?: string;
  expectedAudience?: string;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(jwksUrl: string) {
  let cached = jwksCache.get(jwksUrl);
  if (!cached) {
    cached = createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 60_000 });
    jwksCache.set(jwksUrl, cached);
  }
  return cached;
}

export async function verifySupabaseEndUserToken(
  input: VerifySupabaseTokenInput,
): Promise<SupabaseEndUserClaims> {
  const jwks = getJwks(input.jwksUrl);
  let result: JWTVerifyResult;
  try {
    result = await jwtVerify(input.token, jwks, {
      issuer: input.expectedIssuer,
      audience: input.expectedAudience,
    });
  } catch (err) {
    logger.debug({ err }, "support: supabase token verification failed");
    throw new Error("invalid_supabase_token");
  }
  const payload = result.payload as Record<string, unknown>;
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) throw new Error("invalid_supabase_token");
  return {
    sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    user_metadata:
      payload.user_metadata && typeof payload.user_metadata === "object"
        ? (payload.user_metadata as Record<string, unknown>)
        : undefined,
    aud: typeof payload.aud === "string" ? payload.aud : undefined,
    iss: typeof payload.iss === "string" ? payload.iss : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
  };
}

export function deriveSupabaseJwksUrl(projectUrl: string): string {
  const trimmed = projectUrl.replace(/\/+$/, "");
  return `${trimmed}/auth/v1/.well-known/jwks.json`;
}

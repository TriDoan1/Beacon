import type {
  SupportSessionInitialContext,
  SupportSessionOpenResponse,
  SupportSessionReplayResponse,
  SupportWidgetTheme,
} from "@paperclipai/shared";
import { consumeSseStream, type ParsedSseFrame } from "./sse-client.js";
import type { AssetUploadResponse } from "./types.js";

export interface ApiClientOptions {
  apiUrl: string;
  productKey: string;
  getAccessToken: () => string | Promise<string>;
}

export class SupportApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(`${status}_${code}`);
    this.status = status;
    this.code = code;
  }
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${trimmed}${suffix}`;
}

export class SupportApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  private async authHeader(): Promise<Record<string, string>> {
    const token = await this.opts.getAccessToken();
    if (!token) throw new SupportApiError(401, "missing_token");
    return { authorization: `Bearer ${token}` };
  }

  async getTheme(): Promise<{ productLabel: string; theme: SupportWidgetTheme; enabled: { widget: boolean; email: boolean; sms: boolean } }> {
    const res = await fetch(joinUrl(this.opts.apiUrl, `/api/support/products/${encodeURIComponent(this.opts.productKey)}/theme`), {
      method: "GET",
      credentials: "omit",
    });
    if (!res.ok) {
      const code = (await safeJson(res))?.error ?? `http_${res.status}`;
      throw new SupportApiError(res.status, code);
    }
    return res.json();
  }

  async openSession(initialContext: SupportSessionInitialContext): Promise<SupportSessionOpenResponse> {
    const res = await fetch(joinUrl(this.opts.apiUrl, "/api/support/sessions"), {
      method: "POST",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        ...(await this.authHeader()),
      },
      body: JSON.stringify({
        productKey: this.opts.productKey,
        initialContext,
      }),
    });
    if (!res.ok) {
      const code = (await safeJson(res))?.error ?? `http_${res.status}`;
      throw new SupportApiError(res.status, code);
    }
    return res.json();
  }

  async replay(sessionId: string, afterSeq?: number): Promise<SupportSessionReplayResponse> {
    const url = new URL(joinUrl(this.opts.apiUrl, `/api/support/sessions/${sessionId}/replay`));
    if (typeof afterSeq === "number") url.searchParams.set("afterSeq", String(afterSeq));
    const res = await fetch(url.toString(), {
      method: "GET",
      credentials: "omit",
      headers: { ...(await this.authHeader()) },
    });
    if (!res.ok) {
      const code = (await safeJson(res))?.error ?? `http_${res.status}`;
      throw new SupportApiError(res.status, code);
    }
    return res.json();
  }

  async sendTurn(
    sessionId: string,
    message: string,
    onFrame: (frame: ParsedSseFrame) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(joinUrl(this.opts.apiUrl, `/api/support/sessions/${sessionId}/turns`), {
      method: "POST",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        ...(await this.authHeader()),
      },
      body: JSON.stringify({ message }),
      signal,
    });
    if (!res.ok) {
      const code = (await safeJson(res))?.error ?? `http_${res.status}`;
      throw new SupportApiError(res.status, code);
    }
    await consumeSseStream({ response: res, onFrame, signal });
  }

  async uploadAsset(sessionId: string, blob: Blob, filename: string): Promise<AssetUploadResponse> {
    const form = new FormData();
    form.append("file", blob, filename);
    const res = await fetch(joinUrl(this.opts.apiUrl, `/api/support/sessions/${sessionId}/assets`), {
      method: "POST",
      credentials: "omit",
      headers: { ...(await this.authHeader()) },
      body: form,
    });
    if (!res.ok) {
      const code = (await safeJson(res))?.error ?? `http_${res.status}`;
      throw new SupportApiError(res.status, code);
    }
    return res.json();
  }
}

async function safeJson(res: Response): Promise<{ error?: string } | null> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return null;
  }
}

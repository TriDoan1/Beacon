import type {
  SupportSessionInitialContext,
  SupportSessionOpenResponse,
  SupportSessionReplayMessage,
  SupportSessionReplayResponse,
  SupportWidgetTheme,
} from "@paperclipai/shared";

export type {
  SupportSessionInitialContext,
  SupportSessionOpenResponse,
  SupportSessionReplayMessage,
  SupportSessionReplayResponse,
  SupportWidgetTheme,
};

export interface MountSupportWidgetOptions {
  /** Public URL of the Paperclip server, e.g. https://paperclip.tailnet.ts.net */
  apiUrl: string;
  /** Product key registered on the Paperclip side (matches support_widget_configs.product_key) */
  productKey: string;
  /**
   * Returns the current Supabase access token. Called fresh on every API call
   * so token rotation is handled by the host app, not the widget.
   */
  getAccessToken: () => string | Promise<string>;
  /** Element to mount the widget into. Usually `document.body`. */
  container: HTMLElement;
  /** Optional initial-context override; merged onto auto-detected fields. */
  initialContext?: SupportSessionInitialContext;
  /**
   * If provided, enables the screenshot affordance. The host implements
   * capture (e.g. via html2canvas) and returns a Blob. The widget uploads it
   * to /api/support/sessions/:id/assets and references the asset id in the
   * next user turn.
   */
  onCapture?: () => Promise<Blob>;
  /** Theme overrides; merged on top of the theme returned from the API. */
  theme?: SupportWidgetTheme;
  /**
   * Called whenever the widget transitions between major lifecycle states.
   * Useful for analytics or for custom UI on the host page.
   */
  onStateChange?: (state: WidgetPublicState) => void;
  /** When false, the launcher button is hidden and you must call open() yourself. */
  showLauncher?: boolean;
}

export type SessionPhase =
  | "idle"
  | "opening"
  | "active"
  | "streaming"
  | "closed"
  | "error"
  | "offline";

export interface WidgetPublicState {
  phase: SessionPhase;
  sessionId: string | null;
  closeReason: string | null;
  errorCode: string | null;
}

export interface MountedWidgetHandle {
  /** Open the chat panel (if `showLauncher` was false, this is the only way). */
  open: () => void;
  /** Close the panel without ending the session. */
  close: () => void;
  /** Tear the widget down completely and remove it from the DOM. */
  destroy: () => void;
  /** Inspect current state. */
  getState: () => WidgetPublicState;
}

export interface InternalMessage {
  id: string;
  seq: number;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[] | null;
  /** Only true while a streaming assistant message is being assembled. */
  pending?: boolean;
}

export interface AssetUploadResponse {
  assetId: string;
  contentType: string;
  byteSize: number;
}

export type SupportSessionTransport = "widget" | "email" | "sms";

export type SupportSessionStatus = "active" | "abandoned" | "closed" | "escalated";

export type SupportSessionCloseReason =
  | "intake_submitted"
  | "human_requested"
  | "not_a_bug"
  | "abandoned"
  | "cost_cap"
  | "rate_limit"
  | "operator_closed"
  | "error";

export type SupportMessageRole = "user" | "assistant" | "tool" | "system";

export interface SupportMessageToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface SupportMessageToolResult {
  toolCallId: string;
  ok: boolean;
  output: unknown;
  errorMessage?: string;
}

export interface SupportMessageTransportMetadata {
  emailMessageId?: string;
  emailFromAddress?: string;
  smsSid?: string;
  smsFromNumber?: string;
  widgetClientEventId?: string;
}

export interface SupportSessionInitialContext {
  url?: string;
  routePath?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
  timeZone?: string;
  locale?: string;
  consoleErrors?: SupportIntakeConsoleError[];
  networkErrors?: SupportIntakeNetworkError[];
  hostMetadata?: Record<string, unknown>;
}

export interface SupportIntakeBrowserInfo {
  userAgent?: string;
  platform?: string;
  language?: string;
  viewport?: { width: number; height: number };
  url?: string;
  routePath?: string;
  timeZone?: string;
}

export interface SupportIntakeConsoleError {
  level: "error" | "warn" | "info" | "log";
  message: string;
  source?: string;
  timestamp: string;
}

export interface SupportIntakeNetworkError {
  url: string;
  method: string;
  status: number;
  timestamp: string;
}

export interface SupportWidgetTheme {
  primaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  mode?: "light" | "dark" | "auto";
  logoUrl?: string;
  greetingHeadline?: string;
  greetingSubtext?: string;
  launcherLabel?: string;
}

export interface SupportTokenClaims {
  sub: string;
  email?: string;
  name?: string;
  productKey: string;
  iss?: string;
  aud?: string;
  exp: number;
}

export interface SupportSessionOpenRequest {
  productKey: string;
  initialContext?: SupportSessionInitialContext;
}

export interface SupportSessionOpenResponse {
  sessionId: string;
  modelUsed: string;
  greeting?: string;
  theme: SupportWidgetTheme;
  status: SupportSessionStatus;
}

export interface SupportSessionTurnRequest {
  message: string;
  clientEventId?: string;
}

export interface SupportSessionReplayMessage {
  id: string;
  seq: number;
  role: SupportMessageRole;
  content: string;
  toolCalls?: SupportMessageToolCall[] | null;
  createdAt: string;
}

export interface SupportSessionReplayResponse {
  sessionId: string;
  status: SupportSessionStatus;
  closeReason: SupportSessionCloseReason | null;
  modelUsed: string;
  messages: SupportSessionReplayMessage[];
}

export interface SupportIntakePacketBody {
  whatUserWasDoing: string;
  whatHappened: string;
  reproSteps: string[];
  affectedFeature?: string;
  screenshotAssetId?: string;
  attachmentAssetIds?: string[];
  browserInfo?: SupportIntakeBrowserInfo;
  consoleErrors?: SupportIntakeConsoleError[];
  networkErrors?: SupportIntakeNetworkError[];
}

export interface SupportConciergeAdapterConfig {
  model: string;
  systemPrompt?: string;
  greeting?: string;
  maxTurnsPerSession?: number;
  productKey?: string;
}

import type { SessionPhase, InternalMessage } from "../types.js";
import { Composer } from "./Composer.js";
import { Transcript } from "./Transcript.js";

interface PanelProps {
  productLabel: string;
  phase: SessionPhase;
  greeting: string | null;
  messages: InternalMessage[];
  closeReason: string | null;
  errorCode: string | null;
  attachAvailable: boolean;
  uploadingAttachment: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  onAttach: () => void;
  onRetry: () => void;
}

export function Panel(props: PanelProps) {
  const composerDisabled = props.phase === "closed" || props.phase === "error" || props.phase === "offline";
  const pending = props.phase === "streaming" || props.phase === "opening" || props.uploadingAttachment;

  return (
    <div className="panel" role="dialog" aria-label={`${props.productLabel} support chat`}>
      <header className="header">
        <h1>{props.productLabel} support</h1>
        <button type="button" className="close" onClick={props.onClose} aria-label="Close support chat">
          ×
        </button>
      </header>
      <Transcript greeting={props.greeting} messages={props.messages} />
      <StatusBanner
        phase={props.phase}
        closeReason={props.closeReason}
        errorCode={props.errorCode}
        onRetry={props.onRetry}
      />
      <Composer
        disabled={composerDisabled}
        pending={pending}
        onSend={props.onSend}
        onAttach={props.attachAvailable ? props.onAttach : undefined}
        attachLabel="Attach screenshot"
      />
    </div>
  );
}

function StatusBanner({
  phase,
  closeReason,
  errorCode,
  onRetry,
}: {
  phase: SessionPhase;
  closeReason: string | null;
  errorCode: string | null;
  onRetry: () => void;
}) {
  if (phase === "closed") {
    return (
      <div className="banner success">
        {closeMessage(closeReason)}
        <button type="button" onClick={onRetry}>
          Start a new conversation
        </button>
      </div>
    );
  }
  if (phase === "offline") {
    return (
      <div className="banner error">
        Support is offline right now. Please try again in a moment.
        <button type="button" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div className="banner error">
        {errorMessage(errorCode)}
        <button type="button" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  return null;
}

function closeMessage(reason: string | null): string {
  switch (reason) {
    case "intake_submitted":
      return "We got your report. We'll follow up shortly.";
    case "human_requested":
      return "A human will pick this up and get back to you soon.";
    case "not_a_bug":
      return "Hope that helped — let us know if anything else comes up.";
    case "cost_cap":
      return "This conversation has reached its limit. We've notified our team.";
    default:
      return "Conversation closed.";
  }
}

function errorMessage(code: string | null): string {
  switch (code) {
    case "invalid_token":
      return "Your session expired. Please refresh the page.";
    case "rate_limited":
      return "Too many sessions in a short window. Please try again in an hour.";
    case "user_daily_cap_exceeded":
      return "You've hit today's support limit. We'll be back tomorrow.";
    case "origin_not_allowed":
      return "Support isn't available from this domain.";
    case "anthropic_api_key_missing":
      return "Support is misconfigured. Please contact us via email.";
    default:
      return "Something went wrong on our side.";
  }
}

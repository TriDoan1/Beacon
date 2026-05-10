import { useCallback, useEffect, useState } from "react";
import type { SupportWidgetTheme } from "@paperclipai/shared";
import { SupportApiClient, SupportApiError } from "../api-client.js";
import { SessionManager } from "../session-manager.js";
import { Launcher } from "./Launcher.js";
import { Panel } from "./Panel.js";

export interface WidgetProps {
  api: SupportApiClient;
  manager: SessionManager;
  productLabel: string;
  showLauncher: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  onCapture?: () => Promise<Blob>;
}

export function Widget(props: WidgetProps) {
  const [, force] = useState(0);
  useEffect(() => {
    // Subscribe to session manager state changes via re-render
    // (the manager calls our onChange in its options).
    return () => {};
  }, []);

  const state = props.manager.getState();
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  // Trigger ensureSession on first open
  useEffect(() => {
    if (props.open && state.phase === "idle") {
      void props.manager.ensureSession();
    }
  }, [props.open, state.phase, props.manager]);

  const handleSend = useCallback(
    (text: string) => {
      void props.manager.sendUserMessage(text);
    },
    [props.manager],
  );

  const handleAttach = useCallback(async () => {
    if (!props.onCapture || !state.sessionId) return;
    setUploadingAttachment(true);
    try {
      const blob = await props.onCapture();
      const upload = await props.api.uploadAsset(state.sessionId, blob, "screenshot.png");
      // We don't auto-send a follow-up message; the user types their describe-it text.
      // The asset id is surfaced via window event so a host can read it if it wants
      // to show a thumbnail. The Concierge currently learns about the upload through
      // the user's textual mention; future work threads asset ids into submit_intake.
      window.dispatchEvent(
        new CustomEvent("paperclip-support:asset-uploaded", { detail: upload }),
      );
    } catch (err) {
      // Swallow: surface a small status next to the composer in a follow-up.
      console.error("[support-widget] attach failed", err);
    } finally {
      setUploadingAttachment(false);
    }
  }, [props.onCapture, props.api, state.sessionId]);

  return (
    <>
      {props.showLauncher && !props.open ? (
        <Launcher onClick={() => props.setOpen(true)} label={`Support — ${props.productLabel}`} />
      ) : null}
      {props.open ? (
        <Panel
          productLabel={props.productLabel}
          phase={state.phase}
          greeting={state.greeting}
          messages={state.messages}
          closeReason={state.closeReason}
          errorCode={state.errorCode}
          attachAvailable={!!props.onCapture}
          uploadingAttachment={uploadingAttachment}
          onClose={() => props.setOpen(false)}
          onSend={handleSend}
          onAttach={() => void handleAttach()}
          onRetry={() => void props.manager.retry()}
        />
      ) : null}
    </>
  );
}

// Re-export so callers can `instanceof` if they need to.
export { SupportApiError };

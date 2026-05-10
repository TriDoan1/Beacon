import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { SupportApiClient } from "./api-client.js";
import { SessionManager } from "./session-manager.js";
import { captureInitialContext } from "./initial-context.js";
import { Widget } from "./components/Widget.js";
import { SHADOW_CSS, themeToCustomProperties } from "./styles.js";
import type { MountSupportWidgetOptions, MountedWidgetHandle, WidgetPublicState } from "./types.js";

/**
 * Mount the Support Concierge widget. Returns a handle for programmatic
 * control. Call `.destroy()` on unmount to clean up the Shadow DOM and
 * cancel any in-flight network calls.
 */
export function mountSupportWidget(options: MountSupportWidgetOptions): MountedWidgetHandle {
  const host = document.createElement("div");
  host.setAttribute("data-paperclip-support-widget", "");
  // Apply theme custom properties to the host element so children inside
  // Shadow DOM inherit them.
  applyThemeProps(host, options.theme);
  options.container.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const styleTag = document.createElement("style");
  styleTag.textContent = SHADOW_CSS;
  shadow.appendChild(styleTag);
  const mountPoint = document.createElement("div");
  shadow.appendChild(mountPoint);

  const api = new SupportApiClient({
    apiUrl: options.apiUrl,
    productKey: options.productKey,
    getAccessToken: options.getAccessToken,
  });

  let productLabel = options.productKey;
  let mergedTheme = options.theme ?? {};
  let publicState: WidgetPublicState = {
    phase: "idle",
    sessionId: null,
    closeReason: null,
    errorCode: null,
  };

  const manager = new SessionManager({
    api,
    productKey: options.productKey,
    initialContext: captureInitialContext(options.initialContext),
    onChange: () => {
      publicState = manager.getPublicState();
      render();
    },
    onPublicStateChange: (state) => {
      publicState = state;
      options.onStateChange?.(state);
    },
  });

  let open = false;
  const root: Root = createRoot(mountPoint);

  function render() {
    root.render(
      <RenderHost
        api={api}
        manager={manager}
        productLabel={productLabel}
        showLauncher={options.showLauncher !== false}
        open={open}
        setOpen={(value) => {
          open = value;
          render();
        }}
        onCapture={options.onCapture}
      />,
    );
  }

  // Fetch theme + label asynchronously and re-render when ready.
  void api
    .getTheme()
    .then((info) => {
      productLabel = info.productLabel;
      mergedTheme = { ...info.theme, ...(options.theme ?? {}) };
      applyThemeProps(host, mergedTheme);
      render();
    })
    .catch(() => {
      // Non-fatal — keep the productKey as label and continue.
      render();
    });

  render();

  return {
    open: () => {
      open = true;
      render();
    },
    close: () => {
      open = false;
      render();
    },
    destroy: () => {
      manager.abortCurrentTurn();
      try {
        root.unmount();
      } catch {
        // double-unmount is harmless
      }
      host.remove();
    },
    getState: () => publicState,
  };
}

function RenderHost(props: {
  api: SupportApiClient;
  manager: SessionManager;
  productLabel: string;
  showLauncher: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  onCapture?: () => Promise<Blob>;
}) {
  // Force a useState to satisfy the React rule that the root must render a
  // component (not just a function call). The session manager already drives
  // re-renders via its onChange callback.
  const [, setTick] = useState(0);
  // Bind a one-time subscription to bump useState when the manager mutates;
  // this is redundant with the explicit render() call from mount.tsx but keeps
  // React happy when nested children call setState during commit.
  void setTick;
  return (
    <Widget
      api={props.api}
      manager={props.manager}
      productLabel={props.productLabel}
      showLauncher={props.showLauncher}
      open={props.open}
      setOpen={props.setOpen}
      onCapture={props.onCapture}
    />
  );
}

function applyThemeProps(host: HTMLElement, theme: MountSupportWidgetOptions["theme"]) {
  const props = themeToCustomProperties(theme);
  for (const [key, value] of Object.entries(props)) {
    host.style.setProperty(key, value);
  }
}

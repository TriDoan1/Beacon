// @vitest-environment jsdom

import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarSection } from "./SidebarSection";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.PointerEvent) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).PointerEvent = MouseEvent;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function openSectionMenu(container: HTMLElement) {
  const trigger = container.querySelector('button[aria-label="Projects section actions"]');
  expect(trigger).not.toBeNull();

  await act(async () => {
    trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await flushReact();
}

describe("SidebarSection", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    const currentRoot = root;
    if (currentRoot) {
      await act(async () => {
        currentRoot.unmount();
      });
    }
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("keeps static and collapsible section labels on the same text column", async () => {
    const currentRoot = createRoot(container);
    root = currentRoot;

    await act(async () => {
      currentRoot.render(
        <div>
          <SidebarSection label="Work">
            <a href="/issues">Issues</a>
          </SidebarSection>
          <SidebarSection label="Projects" collapsible={{ open: true, onOpenChange: vi.fn() }}>
            <a href="/projects">Projects</a>
          </SidebarSection>
        </div>,
      );
    });
    await flushReact();

    const workLabel = Array.from(container.querySelectorAll("span"))
      .find((element) => element.textContent === "Work");
    const projectsLabel = Array.from(container.querySelectorAll("span"))
      .find((element) => element.textContent === "Projects");

    expect(workLabel?.previousElementSibling?.className).toContain("w-3");
    expect(projectsLabel?.previousElementSibling?.tagName.toLowerCase()).toBe("svg");
    expect(projectsLabel?.previousElementSibling?.getAttribute("class")).toContain("w-3");
  });

  it("renders configured menu actions and radio choices", async () => {
    const onAction = vi.fn();
    const onRadioValueChange = vi.fn();
    const currentRoot = createRoot(container);
    root = currentRoot;

    await act(async () => {
      currentRoot.render(
        <SidebarSection
          label="Projects"
          menu={{
            ariaLabel: "Projects section actions",
            actions: [
              { type: "item", label: "New project", onSelect: onAction },
              { type: "item", label: "Browse projects", href: "/projects" },
              { type: "separator" },
            ],
            radioChoices: [
              { value: "top", label: "Top" },
              { value: "alphabetical", label: "Alphabetical" },
            ],
            radioValue: "top",
            onRadioValueChange,
          }}
        >
          <a href="/projects">Projects</a>
        </SidebarSection>,
      );
    });
    await flushReact();

    await openSectionMenu(container);

    const newProjectItem = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'))
      .find((element) => element.textContent?.includes("New project"));
    expect(newProjectItem).toBeTruthy();
    const browseLink = Array.from(document.body.querySelectorAll("a"))
      .find((element) => element.textContent?.includes("Browse projects"));
    expect(browseLink?.getAttribute("href")).toBe("/projects");

    const alphabeticalItem = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-radio-item"]'))
      .find((element) => element.textContent?.includes("Alphabetical"));
    expect(alphabeticalItem).toBeTruthy();

    await act(async () => {
      alphabeticalItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRadioValueChange).toHaveBeenCalledWith("alphabetical");

    await openSectionMenu(container);
    const reopenedNewProjectItem = Array.from(document.body.querySelectorAll('[data-slot="dropdown-menu-item"]'))
      .find((element) => element.textContent?.includes("New project"));

    await act(async () => {
      reopenedNewProjectItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MemoryBinding, MemoryResolvedBinding } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../context/ToastContext";
import { ProjectMemorySettings } from "./ProjectMemorySettings";

const memoryApiMocks = vi.hoisted(() => ({
  listBindings: vi.fn(),
  getProjectBinding: vi.fn(),
  setProjectBinding: vi.fn(),
}));

vi.mock("../api/memory", () => ({
  memoryApi: memoryApiMocks,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function tick() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function createBinding(overrides: Partial<MemoryBinding> = {}): MemoryBinding {
  return {
    id: "binding-qmd",
    companyId: "company-1",
    key: "qmd-default",
    name: "QMD default",
    providerKey: "qmd_memory",
    config: {},
    enabled: true,
    createdAt: new Date("2026-04-20T00:00:00.000Z"),
    updatedAt: new Date("2026-04-20T00:00:00.000Z"),
    ...overrides,
  };
}

function createResolvedBinding(overrides: Partial<MemoryResolvedBinding> = {}): MemoryResolvedBinding {
  return {
    companyId: "company-1",
    targetType: "company",
    targetId: "company-1",
    binding: createBinding(),
    source: "company_default",
    checkedTargetTypes: ["project", "company"],
    ...overrides,
  };
}

describe("ProjectMemorySettings", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    memoryApiMocks.listBindings.mockReset();
    memoryApiMocks.getProjectBinding.mockReset();
    memoryApiMocks.setProjectBinding.mockReset();
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
  });

  it("shows inherited company memory and saves a project override", async () => {
    const binding = createBinding();
    memoryApiMocks.listBindings.mockResolvedValue([binding]);
    memoryApiMocks.getProjectBinding.mockResolvedValue(createResolvedBinding());
    memoryApiMocks.setProjectBinding.mockResolvedValue({
      id: "target-project",
      companyId: "company-1",
      bindingId: binding.id,
      targetType: "project",
      targetId: "project-1",
      createdAt: new Date("2026-04-20T00:00:00.000Z"),
      updatedAt: new Date("2026-04-20T00:00:00.000Z"),
    });

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <ProjectMemorySettings companyId="company-1" projectId="project-1" />
          </ToastProvider>
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await tick();
      await tick();
    });

    expect(container.textContent).toContain("QMD default (qmd_memory)");
    expect(container.textContent).toContain("Source: Company default");

    const select = container.querySelector("select");
    expect(select).not.toBeNull();

    await act(async () => {
      select!.value = binding.id;
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save override")
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await tick();
    });

    expect(memoryApiMocks.setProjectBinding).toHaveBeenCalledWith("project-1", binding.id);

    await act(async () => {
      root.unmount();
    });
  });
});

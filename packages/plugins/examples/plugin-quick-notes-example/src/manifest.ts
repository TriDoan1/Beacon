import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "paperclipai.plugin-quick-notes-example";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Quick Notes (Example)",
  description:
    "First-party example plugin: company-scoped note library backed by a plugin database namespace. Demonstrates scoped API routes, a database namespace, dashboard widget, and a plugin page.",
  author: "Paperclip",
  categories: ["workspace", "ui"],
  capabilities: [
    "api.routes.register",
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "companies.read",
    "ui.dashboardWidget.register",
    "ui.page.register",
    "ui.sidebar.register",
    "instance.settings.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  database: {
    namespaceSlug: "quick_notes",
    migrationsDir: "migrations",
  },
  apiRoutes: [
    {
      routeKey: "list",
      method: "GET",
      path: "/notes",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
    {
      routeKey: "create",
      method: "POST",
      path: "/notes",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "body", key: "companyId" },
    },
    {
      routeKey: "delete",
      method: "DELETE",
      path: "/notes/:id",
      auth: "board-or-agent",
      capability: "api.routes.register",
      companyResolution: { from: "query", key: "companyId" },
    },
  ],
  ui: {
    slots: [
      {
        type: "page",
        id: "quick-notes-page",
        displayName: "Quick Notes",
        exportName: "QuickNotesPage",
        routePath: "quick-notes",
      },
      {
        type: "sidebar",
        id: "quick-notes-sidebar-link",
        displayName: "Quick Notes",
        exportName: "QuickNotesSidebarLink",
      },
      {
        type: "dashboardWidget",
        id: "quick-notes-widget",
        displayName: "Quick Notes",
        exportName: "QuickNotesDashboardWidget",
      },
      {
        type: "settingsPage",
        id: "quick-notes-settings",
        displayName: "Quick Notes",
        exportName: "QuickNotesSettingsPage",
      },
    ],
  },
};

export default manifest;

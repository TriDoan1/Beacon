import { describe, expect, it } from "vitest";
import { pluginManifestV1Schema } from "@paperclipai/shared";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest, { PLUGIN_ID } from "../src/manifest.js";
import plugin, {
  type NoteListResult,
  type NoteRecord,
  createNote,
  deleteNote,
} from "../src/worker.js";

interface NoteRow {
  id: string;
  company_id: string;
  title: string;
  body: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

function makeInMemoryNotesDb() {
  const rows: NoteRow[] = [];
  return {
    rows,
    namespace: "plugin_quick_notes_test",
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      if (!sql.includes("FROM plugin_quick_notes_test.notes")) return [];
      const companyId = params?.[0] as string;
      let filtered = rows.filter((row) => row.company_id === companyId);
      if (sql.includes("LIKE $2")) {
        const like = (params?.[1] as string) ?? "";
        const inner = like.startsWith("%") && like.endsWith("%") ? like.slice(1, -1) : like;
        const needle = inner.replace(/\\(.)/g, "$1").toLowerCase();
        filtered = filtered.filter(
          (row) =>
            row.title.toLowerCase().includes(needle) || row.body.toLowerCase().includes(needle),
        );
      }
      const tagParamIndex = sql.match(/\$(\d+) = ANY\(tags\)/)?.[1];
      if (tagParamIndex) {
        const tag = params?.[Number(tagParamIndex) - 1] as string;
        filtered = filtered.filter((row) => row.tags.includes(tag));
      }
      filtered = [...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at));
      const limitParamIndex = sql.match(/LIMIT \$(\d+)/)?.[1];
      if (limitParamIndex) {
        const limit = params?.[Number(limitParamIndex) - 1] as number;
        filtered = filtered.slice(0, limit);
      }
      return filtered as unknown as T[];
    },
    async execute(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
      if (sql.startsWith("INSERT INTO plugin_quick_notes_test.notes")) {
        const [id, companyId, title, body, tags, createdAt] = params as [
          string,
          string,
          string,
          string,
          string[],
          string,
        ];
        rows.push({
          id,
          company_id: companyId,
          title,
          body,
          tags: [...tags],
          created_at: createdAt,
          updated_at: createdAt,
        });
        return { rowCount: 1 };
      }
      if (sql.startsWith("DELETE FROM plugin_quick_notes_test.notes")) {
        const [companyId, id] = params as [string, string];
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i]!.company_id === companyId && rows[i]!.id === id) rows.splice(i, 1);
        }
        return { rowCount: before - rows.length };
      }
      return { rowCount: 0 };
    },
  };
}

function makeHarness() {
  const harness = createTestHarness({ manifest });
  const db = makeInMemoryNotesDb();
  harness.ctx.db = db;
  return { harness, db };
}

describe("plugin-quick-notes-example manifest", () => {
  it("declares the expected core surface capabilities", () => {
    const parsed = pluginManifestV1Schema.parse(manifest);
    expect(parsed.id).toBe(PLUGIN_ID);
    expect(parsed.capabilities).toEqual(
      expect.arrayContaining([
        "api.routes.register",
        "database.namespace.migrate",
        "database.namespace.read",
        "database.namespace.write",
        "ui.page.register",
        "ui.dashboardWidget.register",
      ]),
    );
    expect(parsed.database).toMatchObject({
      namespaceSlug: "quick_notes",
      migrationsDir: "migrations",
    });
    expect(parsed.apiRoutes).toEqual([
      expect.objectContaining({ routeKey: "list", method: "GET" }),
      expect.objectContaining({ routeKey: "create", method: "POST" }),
      expect.objectContaining({ routeKey: "delete", method: "DELETE" }),
    ]);
    expect(parsed.ui?.slots ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "quick-notes-page", type: "page" }),
        expect.objectContaining({ id: "quick-notes-widget", type: "dashboardWidget" }),
      ]),
    );
  });
});

describe("plugin-quick-notes-example worker", () => {
  it("creates, lists, and deletes notes via registered handlers", async () => {
    const companyId = "22222222-2222-2222-2222-222222222222";
    const { harness } = makeHarness();
    await plugin.definition.setup(harness.ctx);

    const created = await harness.performAction<NoteRecord>("create", {
      companyId,
      title: "Hello World",
      body: "This is my first note.",
      tags: ["Docs", "Demo", "demo"],
    });
    expect(created.companyId).toBe(companyId);
    expect(created.title).toBe("Hello World");
    expect(created.tags).toEqual(["docs", "demo"]);

    const second = await harness.performAction<NoteRecord>("create", {
      companyId,
      title: "Second Note",
      tags: ["demo"],
    });

    const allListed = await harness.getData<NoteListResult>("list", { companyId });
    expect(allListed.databaseNamespace).toBe("plugin_quick_notes_test");
    expect(allListed.notes.map((n) => n.title).sort()).toEqual(["Hello World", "Second Note"]);

    const filtered = await harness.getData<NoteListResult>("list", {
      companyId,
      tag: "docs",
    });
    expect(filtered.notes.map((n) => n.title)).toEqual(["Hello World"]);

    const searched = await harness.getData<NoteListResult>("list", {
      companyId,
      search: "second",
    });
    expect(searched.notes.map((n) => n.title)).toEqual(["Second Note"]);

    const deletion = await harness.performAction<{ deleted: boolean; id: string }>("delete", {
      companyId,
      id: second.id,
    });
    expect(deletion).toEqual({ deleted: true, id: second.id });

    const after = await harness.getData<NoteListResult>("list", { companyId });
    expect(after.notes.map((n) => n.title)).toEqual(["Hello World"]);
  });

  it("caps tag count exactly at MAX_TAGS", async () => {
    const companyId = "88888888-8888-8888-8888-888888888888";
    const { harness, db } = makeHarness();
    await plugin.definition.setup(harness.ctx);

    const sixteenTags = Array.from({ length: 16 }, (_, i) => `t${i}`);
    const created = await harness.performAction<NoteRecord>("create", {
      companyId,
      title: "Tagged note",
      tags: sixteenTags,
    });
    expect(created.tags).toHaveLength(16);

    await expect(
      harness.performAction("create", {
        companyId,
        title: "Too many tags",
        tags: [...sixteenTags, "extra"],
      }),
    ).rejects.toThrow(/at most 16 tags/);

    expect(db.rows).toHaveLength(1);
  });

  it("requires a title", async () => {
    const { harness } = makeHarness();
    await plugin.definition.setup(harness.ctx);
    await expect(
      harness.performAction("create", {
        companyId: "33333333-3333-3333-3333-333333333333",
        title: "",
      }),
    ).rejects.toThrow(/title.*required/);
  });

  it("validates malformed tags before touching the database", async () => {
    const { harness, db } = makeHarness();
    await plugin.definition.setup(harness.ctx);
    await expect(
      harness.performAction("create", {
        companyId: "55555555-5555-5555-5555-555555555555",
        title: "Bad tags note",
        tags: ["good", "Bad Tag!!!"],
      }),
    ).rejects.toThrow(/lowercase letters, digits, hyphens, or underscores/);
    expect(db.rows).toHaveLength(0);
  });

  it("dispatches the scoped API routes through the same handlers", async () => {
    const companyId = "66666666-6666-6666-6666-666666666666";
    const { harness } = makeHarness();
    await plugin.definition.setup(harness.ctx);

    const created = await plugin.definition.onApiRequest?.({
      routeKey: "create",
      method: "POST",
      path: "/notes",
      params: {},
      query: {},
      body: { companyId, title: "API Note", body: "Created via API" },
      actor: { actorType: "user", actorId: "board", userId: "board", agentId: null, runId: null },
      companyId,
      headers: {},
    });
    expect(created).toMatchObject({ status: 201 });
    expect(created?.body).toMatchObject({ title: "API Note" });

    const noteId = (created?.body as NoteRecord).id;

    const listed = await plugin.definition.onApiRequest?.({
      routeKey: "list",
      method: "GET",
      path: "/notes",
      params: {},
      query: { search: "API" },
      body: null,
      actor: { actorType: "user", actorId: "board", userId: "board", agentId: null, runId: null },
      companyId,
      headers: {},
    });
    expect(listed?.body).toMatchObject({
      notes: [expect.objectContaining({ title: "API Note" })],
    });

    const removed = await plugin.definition.onApiRequest?.({
      routeKey: "delete",
      method: "DELETE",
      path: `/notes/${noteId}`,
      params: { id: noteId },
      query: { companyId },
      body: null,
      actor: { actorType: "user", actorId: "board", userId: "board", agentId: null, runId: null },
      companyId,
      headers: {},
    });
    expect(removed).toMatchObject({ status: 200, body: { deleted: true } });
  });

  it("returns 404 when deleting a non-existent note", async () => {
    const companyId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const { harness } = makeHarness();
    await plugin.definition.setup(harness.ctx);

    const result = await plugin.definition.onApiRequest?.({
      routeKey: "delete",
      method: "DELETE",
      path: "/notes/00000000-0000-0000-0000-000000000000",
      params: { id: "00000000-0000-0000-0000-000000000000" },
      query: { companyId },
      body: null,
      actor: { actorType: "user", actorId: "board", userId: "board", agentId: null, runId: null },
      companyId,
      headers: {},
    });
    expect(result?.status).toBe(404);
  });
});

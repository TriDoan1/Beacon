import { randomUUID } from "node:crypto";
import {
  definePlugin,
  runWorker,
  type PluginApiRequestInput,
  type PluginApiResponse,
  type PluginContext,
} from "@paperclipai/plugin-sdk";

export interface NoteRecord {
  id: string;
  companyId: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  title: string;
  body?: string | null;
  tags?: string[] | null;
}

export interface NoteListResult {
  databaseNamespace: string;
  notes: NoteRecord[];
}

const MAX_TAGS = 16;
const MAX_TAG_LENGTH = 32;
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 10_000;
const MAX_NOTES_PER_LIST = 200;

function tableName(namespace: string): string {
  return `${namespace}.notes`;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTitle(value: unknown): string {
  const raw = asNonEmptyString(value);
  if (!raw) throw new Error("`title` is required");
  return raw.length > MAX_TITLE_LENGTH ? raw.slice(0, MAX_TITLE_LENGTH) : raw;
}

function normalizeBody(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "string") throw new Error("`body` must be a string when provided");
  if (value.length > MAX_BODY_LENGTH) {
    throw new Error(`\`body\` must be ${MAX_BODY_LENGTH} characters or fewer`);
  }
  return value;
}

function normalizeTags(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("`tags` must be an array of strings when provided");
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") throw new Error("`tags` must contain only strings");
    const cleaned = entry.trim().toLowerCase();
    if (!cleaned) continue;
    if (cleaned.length > MAX_TAG_LENGTH) {
      throw new Error(`tag "${entry}" exceeds ${MAX_TAG_LENGTH} characters`);
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(cleaned)) {
      throw new Error(
        `tag "${entry}" must use lowercase letters, digits, hyphens, or underscores`,
      );
    }
    if (seen.has(cleaned)) continue;
    if (tags.length >= MAX_TAGS) throw new Error(`notes accept at most ${MAX_TAGS} tags`);
    seen.add(cleaned);
    tags.push(cleaned);
  }
  return tags;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

interface NoteRow {
  id: string;
  company_id: string;
  title: string;
  body: string;
  tags: string[];
  created_at: string | Date;
  updated_at: string | Date;
}

function rowToNote(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    title: row.title,
    body: row.body,
    tags: Array.isArray(row.tags) ? [...row.tags] : [],
    createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString(),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : row.updated_at.toISOString(),
  };
}

async function listNotes(
  ctx: PluginContext,
  companyId: string,
  search: string | null,
  tag: string | null,
  limit: number,
): Promise<NoteRecord[]> {
  const params: unknown[] = [companyId];
  let where = "company_id = $1";
  if (search) {
    params.push(`%${escapeLikePattern(search.toLowerCase())}%`);
    const idx = params.length;
    where +=
      ` AND (lower(title) LIKE $${idx} ESCAPE '\\'` +
      ` OR lower(body) LIKE $${idx} ESCAPE '\\')`;
  }
  if (tag) {
    params.push(tag);
    where += ` AND $${params.length} = ANY(tags)`;
  }
  params.push(Math.min(Math.max(limit, 1), MAX_NOTES_PER_LIST));
  const rows = await ctx.db.query<NoteRow>(
    `SELECT id, company_id, title, body, tags, created_at, updated_at
     FROM ${tableName(ctx.db.namespace)}
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(rowToNote);
}

export async function createNote(
  ctx: PluginContext,
  companyId: string,
  input: NoteInput,
): Promise<NoteRecord> {
  const title = normalizeTitle(input.title);
  const body = normalizeBody(input.body);
  const tags = normalizeTags(input.tags);
  const id = randomUUID();
  const now = new Date().toISOString();

  await ctx.db.execute(
    `INSERT INTO ${tableName(ctx.db.namespace)}
       (id, company_id, title, body, tags, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [id, companyId, title, body, tags, now],
  );

  return { id, companyId, title, body, tags, createdAt: now, updatedAt: now };
}

export async function deleteNote(
  ctx: PluginContext,
  companyId: string,
  id: string,
): Promise<{ deleted: boolean; id: string }> {
  const result = await ctx.db.execute(
    `DELETE FROM ${tableName(ctx.db.namespace)} WHERE company_id = $1 AND id = $2`,
    [companyId, id],
  );
  return { deleted: result.rowCount > 0, id };
}

let listHandler:
  | ((
      companyId: string,
      search: string | null,
      tag: string | null,
      limit: number,
    ) => Promise<NoteListResult>)
  | null = null;
let createHandler: ((companyId: string, input: NoteInput) => Promise<NoteRecord>) | null = null;
let deleteHandler:
  | ((companyId: string, id: string) => Promise<{ deleted: boolean; id: string }>)
  | null = null;

const plugin = definePlugin({
  async setup(ctx) {
    listHandler = (companyId, search, tag, limit) =>
      listNotes(ctx, companyId, search, tag, limit).then((notes) => ({
        databaseNamespace: ctx.db.namespace,
        notes,
      }));
    createHandler = (companyId, input) => createNote(ctx, companyId, input);
    deleteHandler = (companyId, id) => deleteNote(ctx, companyId, id);

    ctx.data.register("list", async (params) => {
      const companyId = asNonEmptyString(params.companyId);
      if (!companyId) throw new Error("companyId is required");
      const search = asNonEmptyString(params.search)?.toLowerCase() ?? null;
      const tag = asNonEmptyString(params.tag)?.toLowerCase() ?? null;
      const limit = typeof params.limit === "number" ? params.limit : 50;
      if (!listHandler) throw new Error("Quick Notes plugin not ready");
      return listHandler(companyId, search, tag, limit);
    });

    ctx.actions.register("create", async (params) => {
      const companyId = asNonEmptyString(params.companyId);
      if (!companyId) throw new Error("companyId is required");
      if (!createHandler) throw new Error("Quick Notes plugin not ready");
      return createHandler(companyId, {
        title: typeof params.title === "string" ? params.title : "",
        body: typeof params.body === "string" ? params.body : null,
        tags: Array.isArray(params.tags) ? (params.tags as unknown[] as string[]) : null,
      });
    });

    ctx.actions.register("delete", async (params) => {
      const companyId = asNonEmptyString(params.companyId);
      const id = asNonEmptyString(params.id);
      if (!companyId || !id) throw new Error("companyId and id are required");
      if (!deleteHandler) throw new Error("Quick Notes plugin not ready");
      return deleteHandler(companyId, id);
    });
  },

  async onApiRequest(input: PluginApiRequestInput): Promise<PluginApiResponse> {
    switch (input.routeKey) {
      case "list": {
        if (!listHandler) return { status: 503, body: { error: "Quick Notes plugin not ready" } };
        const search = asNonEmptyString(input.query.search)?.toLowerCase() ?? null;
        const tag = asNonEmptyString(input.query.tag)?.toLowerCase() ?? null;
        const limitRaw = asNonEmptyString(input.query.limit);
        const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
        const limit = Number.isFinite(parsedLimit) ? parsedLimit : 50;
        return { body: await listHandler(input.companyId, search, tag, limit) };
      }
      case "create": {
        if (!createHandler) return { status: 503, body: { error: "Quick Notes plugin not ready" } };
        const body = (input.body ?? {}) as Record<string, unknown>;
        try {
          const note = await createHandler(input.companyId, {
            title: typeof body.title === "string" ? body.title : "",
            body: typeof body.body === "string" ? body.body : null,
            tags: Array.isArray(body.tags) ? (body.tags as unknown[] as string[]) : null,
          });
          return { status: 201, body: note };
        } catch (error) {
          return {
            status: 400,
            body: { error: error instanceof Error ? error.message : "Invalid note" },
          };
        }
      }
      case "delete": {
        if (!deleteHandler) return { status: 503, body: { error: "Quick Notes plugin not ready" } };
        const id = input.params.id;
        if (!id) return { status: 400, body: { error: "id is required" } };
        const companyId = asNonEmptyString(input.query.companyId) ?? input.companyId;
        const result = await deleteHandler(companyId, id);
        return { status: result.deleted ? 200 : 404, body: result };
      }
      default:
        return { status: 404, body: { error: `Unknown quick-notes route: ${input.routeKey}` } };
    }
  },

  async onHealth() {
    return {
      status: "ok",
      message: "Quick Notes plugin worker is running",
      details: {
        surfaces: ["scoped-api-route", "database-namespace", "page", "dashboard-widget"],
      },
    };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

import {
  usePluginAction,
  usePluginData,
  type PluginPageProps,
  type PluginSettingsPageProps,
  type PluginSidebarProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { useState, useMemo, type CSSProperties, type FormEvent } from "react";

interface NoteRecord {
  id: string;
  companyId: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface NoteListResult {
  databaseNamespace: string;
  notes: NoteRecord[];
}

const containerStyle: CSSProperties = {
  display: "grid",
  gap: 16,
  font: "13px system-ui, sans-serif",
  color: "#111827",
  padding: 16,
  maxWidth: 760,
};

const cardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: 12,
  background: "#fff",
};

const inputStyle: CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "6px 8px",
  font: "inherit",
  width: "100%",
};

const buttonStyle: CSSProperties = {
  border: "1px solid #1f2937",
  background: "#111827",
  color: "#fff",
  borderRadius: 6,
  padding: "6px 10px",
  font: "inherit",
  cursor: "pointer",
};

const subtleButtonStyle: CSSProperties = {
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  borderRadius: 6,
  padding: "4px 8px",
  font: "inherit",
  cursor: "pointer",
};

const tagStyle: CSSProperties = {
  display: "inline-block",
  border: "1px solid #cbd5f5",
  background: "#eef2ff",
  color: "#3730a3",
  borderRadius: 999,
  padding: "1px 8px",
  marginRight: 4,
  fontSize: 11,
};

function parseTagInput(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function NotesList({
  result,
  onDelete,
  loading,
}: {
  result: NoteListResult | null;
  onDelete: (id: string) => Promise<void>;
  loading: boolean;
}) {
  if (loading) return <div>Loading notes…</div>;
  if (!result) return null;
  if (result.notes.length === 0) {
    return <div style={{ color: "#6b7280" }}>No notes yet.</div>;
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {result.notes.map((note) => (
        <div key={note.id} style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <strong>{note.title}</strong>
            <button
              type="button"
              style={subtleButtonStyle}
              onClick={() => {
                void onDelete(note.id);
              }}
            >
              Delete
            </button>
          </div>
          {note.tags.length > 0 ? (
            <div style={{ marginTop: 6 }}>
              {note.tags.map((tag) => (
                <span key={tag} style={tagStyle}>
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {note.body ? (
            <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{note.body}</div>
          ) : null}
          <div style={{ marginTop: 6, color: "#9ca3af", fontSize: 11 }}>
            {formatDate(note.createdAt)}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotesSurface({ companyId }: { companyId: string }) {
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [title, setTitle] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [body, setBody] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const listParams = useMemo(
    () => ({ companyId, search: search.trim() || null, tag: tag.trim() || null }),
    [companyId, search, tag],
  );

  const { data, loading, error, refresh } = usePluginData<NoteListResult>("list", listParams);
  const create = usePluginAction("create");
  const remove = usePluginAction("delete");

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    try {
      await create({
        companyId,
        title,
        body: body || null,
        tags: parseTagInput(tagsRaw),
      });
      setTitle("");
      setBody("");
      setTagsRaw("");
      refresh();
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Failed to add note");
    }
  }

  async function handleDelete(id: string) {
    setErrorMessage(null);
    try {
      await remove({ companyId, id });
      refresh();
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "Failed to delete note");
    }
  }

  return (
    <div style={containerStyle}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Quick Notes</h1>
        <div style={{ color: "#6b7280" }}>
          Company-scoped note library backed by a plugin database namespace.
        </div>
      </header>

      <form onSubmit={handleCreate} style={{ ...cardStyle, display: "grid", gap: 8 }}>
        <strong>Add note</strong>
        <input
          style={inputStyle}
          required
          type="text"
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          style={inputStyle}
          placeholder="Tags (comma or space separated)"
          value={tagsRaw}
          onChange={(event) => setTagsRaw(event.target.value)}
        />
        <textarea
          style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
          placeholder="Body (optional)"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div>
          <button type="submit" style={buttonStyle}>
            Save
          </button>
        </div>
        {errorMessage ? <div style={{ color: "#b91c1c" }}>{errorMessage}</div> : null}
      </form>

      <div style={{ ...cardStyle, display: "grid", gap: 8 }}>
        <strong>Search</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={inputStyle}
            placeholder="Search title or body"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <input
            style={{ ...inputStyle, maxWidth: 180 }}
            placeholder="Filter by tag"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
          />
        </div>
      </div>

      {error ? <div style={{ color: "#b91c1c" }}>{error.message}</div> : null}
      <NotesList result={data ?? null} onDelete={handleDelete} loading={loading} />
    </div>
  );
}

function MissingCompanyNotice({ surface }: { surface: string }) {
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <strong>{surface}</strong>
        <div style={{ color: "#6b7280", marginTop: 4 }}>
          Open this plugin from a company workspace — notes are scoped per company.
        </div>
      </div>
    </div>
  );
}

export function QuickNotesPage({ context }: PluginPageProps) {
  if (!context.companyId) return <MissingCompanyNotice surface="Quick Notes" />;
  return <NotesSurface companyId={context.companyId} />;
}

export function QuickNotesSettingsPage({ context }: PluginSettingsPageProps) {
  const companyId = context.companyId ?? "";
  const { data, loading, error } = usePluginData<NoteListResult>(
    "list",
    companyId ? { companyId, limit: 1 } : undefined,
  );
  if (!companyId) return <MissingCompanyNotice surface="Quick Notes settings" />;
  return (
    <div style={containerStyle}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Quick Notes settings</h1>
      <div style={cardStyle}>
        <div style={{ display: "grid", gap: 4 }}>
          <div>
            <strong>Database namespace:</strong>{" "}
            <code>{loading ? "…" : (data?.databaseNamespace ?? "not configured")}</code>
          </div>
          {error ? <div style={{ color: "#b91c1c" }}>{error.message}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function QuickNotesDashboardWidget({ context }: PluginWidgetProps) {
  const companyId = context.companyId;
  const { data, loading, error } = usePluginData<NoteListResult>(
    "list",
    companyId ? { companyId, limit: 5 } : undefined,
  );

  if (!companyId) return null;
  if (loading) return <div style={{ font: "12px system-ui, sans-serif" }}>Loading notes…</div>;
  if (error) return <div style={{ color: "#b91c1c" }}>Notes error: {error.message}</div>;
  const notes = data?.notes ?? [];

  return (
    <div style={{ display: "grid", gap: 6, font: "13px system-ui, sans-serif" }}>
      <strong>Recent notes</strong>
      {notes.length === 0 ? (
        <div style={{ color: "#6b7280" }}>No notes yet.</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {notes.map((note) => (
            <li key={note.id}>{note.title}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function QuickNotesSidebarLink(_props: PluginSidebarProps) {
  return <span>Quick Notes</span>;
}

CREATE TABLE plugin_quick_notes_b34a9f8617.notes (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notes_company_idx
  ON plugin_quick_notes_b34a9f8617.notes (company_id, created_at DESC);

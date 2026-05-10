CREATE TABLE IF NOT EXISTS "support_end_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"external_id" text NOT NULL,
	"email" text,
	"name" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_widget_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"product_label" text NOT NULL,
	"supabase_project_url" text,
	"supabase_jwks_url" text,
	"supabase_audience" text,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"webhook_url" text,
	"webhook_signing_secret" text,
	"theme" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"per_session_token_cap_usd_cents" integer DEFAULT 100 NOT NULL,
	"per_user_daily_token_cap_usd_cents" integer DEFAULT 500 NOT NULL,
	"per_ip_hourly_rate_limit" integer DEFAULT 10 NOT NULL,
	"per_session_max_turns" integer DEFAULT 40 NOT NULL,
	"enabled" jsonb DEFAULT '{"widget":true,"email":false,"sms":false}'::jsonb NOT NULL,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"end_user_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"transport" text DEFAULT 'widget' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"close_reason" text,
	"sdk_session_id" text,
	"model_used" text NOT NULL,
	"linked_issue_id" uuid,
	"taken_over_by_user_id" text,
	"input_tokens_used" integer DEFAULT 0 NOT NULL,
	"output_tokens_used" integer DEFAULT 0 NOT NULL,
	"spend_usd_cents" integer DEFAULT 0 NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"initial_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"tool_calls" jsonb,
	"tool_results" jsonb,
	"transport_metadata" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_intake_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"what_user_was_doing" text NOT NULL,
	"what_happened" text NOT NULL,
	"repro_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_feature" text,
	"screenshot_asset_id" uuid,
	"attachment_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"browser_info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"console_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"network_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"linked_issue_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_end_users_company_id_companies_id_fk') THEN
		ALTER TABLE "support_end_users" ADD CONSTRAINT "support_end_users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_widget_configs_company_id_companies_id_fk') THEN
		ALTER TABLE "support_widget_configs" ADD CONSTRAINT "support_widget_configs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_widget_configs_agent_id_agents_id_fk') THEN
		ALTER TABLE "support_widget_configs" ADD CONSTRAINT "support_widget_configs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_sessions_company_id_companies_id_fk') THEN
		ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_sessions_agent_id_agents_id_fk') THEN
		ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_sessions_end_user_id_support_end_users_id_fk') THEN
		ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_end_user_id_support_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."support_end_users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_sessions_linked_issue_id_issues_id_fk') THEN
		ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_linked_issue_id_issues_id_fk" FOREIGN KEY ("linked_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_messages_company_id_companies_id_fk') THEN
		ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_messages_session_id_support_sessions_id_fk') THEN
		ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_session_id_support_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."support_sessions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_intake_packets_company_id_companies_id_fk') THEN
		ALTER TABLE "support_intake_packets" ADD CONSTRAINT "support_intake_packets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_intake_packets_session_id_support_sessions_id_fk') THEN
		ALTER TABLE "support_intake_packets" ADD CONSTRAINT "support_intake_packets_session_id_support_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."support_sessions"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_intake_packets_screenshot_asset_id_assets_id_fk') THEN
		ALTER TABLE "support_intake_packets" ADD CONSTRAINT "support_intake_packets_screenshot_asset_id_assets_id_fk" FOREIGN KEY ("screenshot_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_intake_packets_linked_issue_id_issues_id_fk') THEN
		ALTER TABLE "support_intake_packets" ADD CONSTRAINT "support_intake_packets_linked_issue_id_issues_id_fk" FOREIGN KEY ("linked_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_end_users_company_product_external_idx" ON "support_end_users" USING btree ("company_id","product_key","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_end_users_company_product_idx" ON "support_end_users" USING btree ("company_id","product_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_widget_configs_company_product_idx" ON "support_widget_configs" USING btree ("company_id","product_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_widget_configs_company_agent_idx" ON "support_widget_configs" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_sessions_company_status_idx" ON "support_sessions" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_sessions_company_product_status_idx" ON "support_sessions" USING btree ("company_id","product_key","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_sessions_end_user_opened_at_idx" ON "support_sessions" USING btree ("end_user_id","opened_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_sessions_linked_issue_idx" ON "support_sessions" USING btree ("linked_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "support_messages_session_seq_idx" ON "support_messages" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_messages_company_session_idx" ON "support_messages" USING btree ("company_id","session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_intake_packets_company_session_idx" ON "support_intake_packets" USING btree ("company_id","session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_intake_packets_linked_issue_idx" ON "support_intake_packets" USING btree ("linked_issue_id");

CREATE TABLE "dashboards_boards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"rank" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards_widgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"title" text,
	"config" jsonb NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"w" integer NOT NULL,
	"h" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dashboards_boards_space_id_idx" ON "dashboards_boards" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "dashboards_boards_user_id_idx" ON "dashboards_boards" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "dashboards_widgets_dashboard_id_idx" ON "dashboards_widgets" USING btree ("dashboard_id");
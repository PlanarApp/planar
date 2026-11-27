-- PLNRAPP-890: the workspace connection to github.com (personal token encrypted with server-kit crypto)
CREATE TABLE "github_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"token_enc" text NOT NULL,
	"connected_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "follows" (
	"follower_id" text,
	"following_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "follows_pkey" PRIMARY KEY("follower_id","following_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" serial PRIMARY KEY,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"demons" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"uid" text PRIMARY KEY,
	"username" text NOT NULL,
	"avatar_url" text DEFAULT '' NOT NULL,
	"theme" text DEFAULT 'monochrome' NOT NULL,
	"password_hash" text NOT NULL,
	"password_salt" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lists_user_id_idx" ON "lists" ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_idx" ON "users" (lower("username"));--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_uid_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("uid") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_users_uid_fkey" FOREIGN KEY ("following_id") REFERENCES "users"("uid") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_user_id_users_uid_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("uid") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_uid_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("uid") ON DELETE CASCADE;
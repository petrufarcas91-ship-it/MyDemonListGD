import { pgTable, serial, text, timestamp, jsonb, primaryKey, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type Demon = {
  id: string;
  levelId: string;
  name: string;
  creator: string;
  verifier: string;
  difficulty: string;
  videoUrl: string;
};

export const users = pgTable(
  "users",
  {
    uid: text().primaryKey(),
    username: text().notNull(),
    avatarUrl: text("avatar_url").notNull().default(""),
    theme: text().notNull().default("monochrome"),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    token: text().primaryKey(),
    userId: text("user_id").notNull().references(() => users.uid, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

// `id` is the public, shareable list ID players use to look a list up.
export const lists = pgTable(
  "lists",
  {
    id: serial().primaryKey(),
    userId: text("user_id").notNull().references(() => users.uid, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text().notNull().default(""),
    demons: jsonb().$type<Demon[]>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("lists_user_id_idx").on(t.userId)],
);

export const follows = pgTable(
  "follows",
  {
    followerId: text("follower_id").notNull().references(() => users.uid, { onDelete: "cascade" }),
    followingId: text("following_id").notNull().references(() => users.uid, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followingId] })],
);

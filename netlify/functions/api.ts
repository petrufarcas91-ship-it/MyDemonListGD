import type { Config } from "@netlify/functions";
import { randomBytes, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { follows, lists, sessions, users, type Demon } from "../../db/schema.js";

const THEMES = ["monochrome", "crimson", "emerald", "violet", "gold", "light"];
const DIFFICULTIES = ["Extreme Demon", "Insane Demon", "Hard Demon", "Medium Demon", "Easy Demon"];

const json = (data: unknown, status = 200) => Response.json(data, { status });
const error = (message: string, status = 400) => json({ error: message }, status);

function hashPassword(password: string, saltHex?: string) {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
  return { hash, salt: salt.toString("hex") };
}

// Public shape of a user — never includes password data
function publicUser(u: typeof users.$inferSelect) {
  return { uid: u.uid, username: u.username, avatarUrl: u.avatarUrl, theme: u.theme, createdAt: u.createdAt.getTime() };
}

function publicList(l: typeof lists.$inferSelect) {
  return {
    id: l.id,
    userId: l.userId,
    title: l.title,
    description: l.description,
    demons: l.demons,
    createdAt: l.createdAt.getTime(),
    updatedAt: l.updatedAt.getTime(),
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function sanitizeDemons(input: unknown): Demon[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 500).map((d: any) => ({
    id: str(d?.id, 64) || "d-" + randomBytes(6).toString("hex"),
    levelId: str(d?.levelId, 32),
    name: str(d?.name, 120),
    creator: str(d?.creator, 120),
    verifier: str(d?.verifier, 120),
    difficulty: DIFFICULTIES.includes(d?.difficulty) ? d.difficulty : "Extreme Demon",
    videoUrl: str(d?.videoUrl, 500),
  }));
}

async function getSessionUser(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.uid))
    .where(eq(sessions.token, token));
  return row ? row.user : null;
}

async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({ token, userId });
  return token;
}

async function findOwnedList(id: number, userId: string) {
  const [list] = await db.select().from(lists).where(eq(lists.id, id));
  if (!list) return { status: 404 as const };
  if (list.userId !== userId) return { status: 403 as const };
  return { list };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [resource, param] = parts;
  const method = req.method;
  const body = method === "POST" || method === "PUT" ? await req.json().catch(() => ({})) : {};

  try {
    // Full public community snapshot: users (no secrets), lists, follows
    if (resource === "state" && method === "GET") {
      const [allUsers, allLists, allFollows] = await Promise.all([
        db.select().from(users),
        db.select().from(lists).orderBy(desc(lists.createdAt)),
        db.select().from(follows),
      ]);
      return json({
        users: allUsers.map(publicUser),
        lists: allLists.map(publicList),
        follows: allFollows.map((f) => ({ followerId: f.followerId, followingId: f.followingId, timestamp: f.createdAt.getTime() })),
      });
    }

    if (resource === "register" && method === "POST") {
      const username = str(body.username, 32);
      const password = typeof body.password === "string" ? body.password : "";
      const avatarUrl = str(body.avatarUrl, 500);
      if (username.length < 2) return error("Username must be at least 2 characters long.");
      if (password.length < 4) return error("Password must be at least 4 characters long.");

      const [existing] = await db.select({ uid: users.uid }).from(users).where(sql`lower(${users.username}) = lower(${username})`);
      if (existing) return error("Username is already taken. Please choose another.", 409);

      const { hash, salt } = hashPassword(password);
      const uid = "usr_" + randomBytes(8).toString("hex");
      const [user] = await db
        .insert(users)
        .values({ uid, username, avatarUrl, passwordHash: hash, passwordSalt: salt })
        .returning();
      const token = await createSession(user.uid);
      return json({ token, user: publicUser(user) }, 201);
    }

    if (resource === "login" && method === "POST") {
      const username = str(body.username, 32);
      const password = typeof body.password === "string" ? body.password : "";
      const [user] = await db.select().from(users).where(sql`lower(${users.username}) = lower(${username})`);
      if (!user) return error("Account not found. Please register first.", 404);
      const { hash } = hashPassword(password, user.passwordSalt);
      if (!timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"))) {
        return error("Incorrect password.", 401);
      }
      const token = await createSession(user.uid);
      return json({ token, user: publicUser(user) });
    }

    // Everything below requires a logged-in user
    const me = await getSessionUser(req);

    if (resource === "me" && method === "GET") {
      if (!me) return error("Not logged in", 401);
      return json({ user: publicUser(me) });
    }

    if (!me) return error("Please log in first.", 401);

    if (resource === "logout" && method === "POST") {
      const token = (req.headers.get("authorization") || "").slice(7);
      await db.delete(sessions).where(eq(sessions.token, token));
      return json({ ok: true });
    }

    if (resource === "me" && method === "PUT") {
      const avatarUrl = str(body.avatarUrl, 500);
      const theme = THEMES.includes(body.theme) ? body.theme : me.theme;
      const [user] = await db.update(users).set({ avatarUrl, theme }).where(eq(users.uid, me.uid)).returning();
      return json({ user: publicUser(user) });
    }

    if (resource === "lists") {
      if (method === "POST" && !param) {
        const title = str(body.title, 120);
        if (!title) return error("List title is required.");
        const [list] = await db
          .insert(lists)
          .values({ userId: me.uid, title, description: str(body.description, 1000) })
          .returning();
        return json({ list: publicList(list) }, 201);
      }

      const id = Number(param);
      if (!Number.isInteger(id) || id <= 0) return error("Invalid list ID.", 404);
      const owned = await findOwnedList(id, me.uid);
      if (owned.status === 404) return error("Demon list not found.", 404);
      if (owned.status === 403) return error("You can only edit your own lists.", 403);

      if (method === "PUT") {
        const updates: Partial<typeof lists.$inferInsert> = { updatedAt: new Date() };
        if (body.title !== undefined) {
          const title = str(body.title, 120);
          if (!title) return error("List title is required.");
          updates.title = title;
        }
        if (body.description !== undefined) updates.description = str(body.description, 1000);
        if (body.demons !== undefined) updates.demons = sanitizeDemons(body.demons);
        const [list] = await db.update(lists).set(updates).where(eq(lists.id, id)).returning();
        return json({ list: publicList(list) });
      }

      if (method === "DELETE") {
        await db.delete(lists).where(eq(lists.id, id));
        return json({ ok: true });
      }
    }

    // Toggle following another player
    if (resource === "follows" && param && method === "POST") {
      if (param === me.uid) return error("You cannot follow yourself!");
      const [target] = await db.select({ uid: users.uid }).from(users).where(eq(users.uid, param));
      if (!target) return error("Player not found.", 404);

      const where = and(eq(follows.followerId, me.uid), eq(follows.followingId, param));
      const deleted = await db.delete(follows).where(where).returning();
      if (deleted.length > 0) return json({ following: false });
      await db.insert(follows).values({ followerId: me.uid, followingId: param }).onConflictDoNothing();
      return json({ following: true });
    }

    return error("Not found", 404);
  } catch (err) {
    console.error(err);
    return error("Something went wrong. Please try again.", 500);
  }
};

export const config: Config = {
  path: "/api/*",
};

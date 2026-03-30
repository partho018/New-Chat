import * as client from "openid-client";
import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@workspace/api-zod";

export const ISSUER_URL = process.env.ISSUER_URL ?? "https://replit.com/oidc";
export const SESSION_COOKIE = "sid";
// 365 days — users stay logged in permanently until they explicitly logout
export const SESSION_TTL = 365 * 24 * 60 * 60 * 1000;

export interface SessionData {
  user: AuthUser;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

let oidcConfig: client.Configuration | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    oidcConfig = await client.discovery(
      new URL(ISSUER_URL),
      process.env.REPL_ID!,
    );
  }
  return oidcConfig;
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }

  return row.sess as unknown as SessionData;
}

export async function updateSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(
  res: Response,
  sid?: string,
): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.cookies?.[SESSION_COOKIE];
}

export async function getSessionFromCookie(cookieHeader: string): Promise<string | null> {
  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((part) => {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  });
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  const session = await getSession(sid);
  return session?.user?.id ?? null;
}

export async function getUserById(userId: string): Promise<SessionData["user"] | null> {
  const [row] = await db
    .select()
    .from(sessionsTable);

  for (const r of await db.select().from(sessionsTable)) {
    const sess = r.sess as unknown as SessionData;
    if (sess?.user?.id === userId) {
      return sess.user;
    }
  }
  return null;
}

export async function upsertUser(userData: {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
}): Promise<void> {
  const { usersTable } = await import("@workspace/db");
  await db
    .insert(usersTable)
    .values({
      id: userData.id,
      email: userData.email ?? undefined,
      firstName: userData.firstName ?? undefined,
      lastName: userData.lastName ?? undefined,
      profileImageUrl: userData.profileImageUrl ?? undefined,
    })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        email: userData.email ?? undefined,
        firstName: userData.firstName ?? undefined,
        lastName: userData.lastName ?? undefined,
        profileImageUrl: userData.profileImageUrl ?? undefined,
        updatedAt: new Date(),
      },
    });

  const { userStatusTable } = await import("@workspace/db");
  await db
    .insert(userStatusTable)
    .values({ userId: userData.id, isOnline: false })
    .onConflictDoNothing();
}

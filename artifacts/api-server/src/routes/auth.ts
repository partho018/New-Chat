import bcrypt from "bcryptjs";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  createSession,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

async function upsertUserStatus(userId: string) {
  try {
    const { userStatusTable } = await import("@workspace/db");
    await db
      .insert(userStatusTable)
      .values({ userId, isOnline: false })
      .onConflictDoNothing();
  } catch (e) {
    // ignore
  }
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json({
    isAuthenticated: req.isAuthenticated(),
    user: req.isAuthenticated() ? req.user : null,
  });
});

// Register with email + password
router.post("/auth/register", async (req: Request, res: Response) => {
  const { email, password, username } = req.body;

  if (!email || !password || !username) {
    res.status(400).json({ error: "Email, password এবং নাম দেওয়া আবশ্যক।" });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।" });
    return;
  }

  try {
    const existing = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "এই ইমেইল দিয়ে আগেই একটি অ্যাকাউন্ট আছে।" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [user] = await db
      .insert(usersTable)
      .values({
        email: email.toLowerCase(),
        username,
        firstName: username,
        passwordHash,
      })
      .returning();

    await upsertUserStatus(user.id);

    const sessionData: SessionData = {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      },
    };

    const sid = await createSession(sessionData);
    setSessionCookie(res, sid);

    res.status(201).json({
      success: true,
      token: sid,
      sessionToken: sid,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        profileImageUrl: user.profileImageUrl,
      },
    });
  } catch (err) {
    req.log?.error?.({ err }, "Register error");
    res.status(500).json({ error: "রেজিস্ট্রেশন ব্যর্থ হয়েছে।" });
  }
});

// Login with email + password
router.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "ইমেইল ও পাসওয়ার্ড দেওয়া আবশ্যক।" });
    return;
  }

  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);

    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "ইমেইল বা পাসওয়ার্ড ভুল।" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "ইমেইল বা পাসওয়ার্ড ভুল।" });
      return;
    }

    await upsertUserStatus(user.id);

    const sessionData: SessionData = {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      },
    };

    const sid = await createSession(sessionData);
    setSessionCookie(res, sid);

    res.json({
      success: true,
      token: sid,
      sessionToken: sid,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        profileImageUrl: user.profileImageUrl,
      },
    });
  } catch (err) {
    req.log?.error?.({ err }, "Login error");
    res.status(500).json({ error: "লগইন ব্যর্থ হয়েছে।" });
  }
});

// Change password (requires auth)
router.put("/auth/change-password", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password required." }); return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters." }); return;
  }

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
    if (!user || !user.passwordHash) {
      res.status(404).json({ error: "User not found." }); return;
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Current password is incorrect." }); return;
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, user.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to change password." });
  }
});

// Logout
router.post("/auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ success: true });
});

router.get("/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.redirect("/");
});

export default router;

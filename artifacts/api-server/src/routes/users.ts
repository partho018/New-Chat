import bcrypt from "bcryptjs";
import { Router, type IRouter } from "express";
import { db, usersTable, userStatusTable } from "@workspace/db";
import { eq, ilike, or, ne } from "drizzle-orm";

const router: IRouter = Router();

function formatUser(user: any, status: any) {
  return {
    id: user.id,
    username: user.email,
    displayName: status?.displayName || (user.firstName ? `${user.firstName} ${user.lastName || ""}`.trim() : null),
    avatarUrl: status?.avatarUrl || user.profileImageUrl,
    isOnline: status?.isOnline ?? false,
    lastSeen: status?.lastSeen?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

router.get("/users/search", async (req: any, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const q = (req.query.q as string || "").trim();
  if (!q || q.length < 1) {
    res.json([]);
    return;
  }
  const currentUserId = req.user.id as string;
  const pattern = `%${q}%`;
  try {
    const [users, statuses] = await Promise.all([
      db.select().from(usersTable).where(
        or(
          ilike(usersTable.email, pattern),
          ilike(usersTable.firstName, pattern),
        )
      ).limit(20),
      db.select().from(userStatusTable),
    ]);
    const statusMap = new Map(statuses.map((s) => [s.userId, s]));
    const results = users
      .filter(u => u.id !== currentUserId)
      .map(u => formatUser(u, statusMap.get(u.id)));
    res.json(results);
  } catch (err) {
    console.error("User search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/users", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [users, statuses] = await Promise.all([
    db.select().from(usersTable),
    db.select().from(userStatusTable),
  ]);
  const statusMap = new Map(statuses.map((s) => [s.userId, s]));

  res.json(users.map((u) => formatUser(u, statusMap.get(u.id))));
});

router.get("/users/:userId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

  const [[user], [status]] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, userId)),
    db.select().from(userStatusTable).where(eq(userStatusTable.userId, userId)),
  ]);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(formatUser(user, status));
});

router.patch("/users/me/profile", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;
  const { displayName, avatarUrl } = req.body;

  await db
    .insert(userStatusTable)
    .values({ userId, displayName, avatarUrl, isOnline: true })
    .onConflictDoUpdate({
      target: userStatusTable.userId,
      set: {
        ...(displayName !== undefined && { displayName }),
        ...(avatarUrl !== undefined && { avatarUrl }),
      },
    });

  if (displayName !== undefined) {
    await db
      .update(usersTable)
      .set({ firstName: displayName })
      .where(eq(usersTable.id, userId));
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const [status] = await db.select().from(userStatusTable).where(eq(userStatusTable.userId, userId));

  res.json(formatUser(user, status));
});

router.patch("/users/me/password", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userId = req.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "বর্তমান ও নতুন পাসওয়ার্ড দেওয়া আবশ্যক।" });
    return;
  }

  if (newPassword.length < 6) {
    res.status(400).json({ error: "নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !user.passwordHash) {
    res.status(404).json({ error: "ব্যবহারকারী পাওয়া যায়নি।" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "বর্তমান পাসওয়ার্ড ভুল।" });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, userId));

  res.json({ success: true, message: "পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে।" });
});

export default router;

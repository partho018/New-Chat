import { Router, type IRouter } from "express";
import multer from "multer";
import { db, usersTable, userStatusTable, storiesTable, storyViewsTable, storyReactionsTable } from "@workspace/db";
import { eq, and, gt, desc, inArray } from "drizzle-orm";
import { uploadToCloudinary, deleteFromCloudinary } from "../lib/cloudinary";

const router: IRouter = Router();
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

function storyExpiresAt() {
  const d = new Date();
  d.setHours(d.getHours() + 24);
  return d;
}

// GET /stories — all active stories (24h) from contacts
router.get("/stories", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const now = new Date();

  const rawStories = await db
    .select({
      id: storiesTable.id,
      userId: storiesTable.userId,
      type: storiesTable.type,
      content: storiesTable.content,
      mediaUrl: storiesTable.mediaUrl,
      backgroundColor: storiesTable.backgroundColor,
      textColor: storiesTable.textColor,
      duration: storiesTable.duration,
      createdAt: storiesTable.createdAt,
      expiresAt: storiesTable.expiresAt,
      displayName: userStatusTable.displayName,
      userAvatar: userStatusTable.avatarUrl,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    })
    .from(storiesTable)
    .leftJoin(userStatusTable, eq(storiesTable.userId, userStatusTable.userId))
    .leftJoin(usersTable, eq(storiesTable.userId, usersTable.id))
    .where(gt(storiesTable.expiresAt, now))
    .orderBy(desc(storiesTable.createdAt));

  const allStories = rawStories.map(s => ({
    ...s,
    userName: s.displayName || (s.firstName ? `${s.firstName} ${s.lastName || ""}`.trim() : null) || s.email || "Unknown",
  }));

  // For each story, get views and reactions with viewer details
  const storyIds = allStories.map(s => s.id);
  let viewsWithUser: any[] = [];
  let reactions: any[] = [];
  if (storyIds.length) {
    // Join both userStatusTable AND usersTable so we always have a real name fallback
    viewsWithUser = await db
      .select({
        storyId: storyViewsTable.storyId,
        viewerId: storyViewsTable.viewerId,
        viewerDisplayName: userStatusTable.displayName,
        viewerAvatarUrl: userStatusTable.avatarUrl,
        viewerFirstName: usersTable.firstName,
        viewerLastName: usersTable.lastName,
        viewerEmail: usersTable.email,
      })
      .from(storyViewsTable)
      .leftJoin(userStatusTable, eq(storyViewsTable.viewerId, userStatusTable.userId))
      .leftJoin(usersTable, eq(storyViewsTable.viewerId, usersTable.id))
      .where(inArray(storyViewsTable.storyId, storyIds));
    reactions = await db.select().from(storyReactionsTable).where(inArray(storyReactionsTable.storyId, storyIds));
  }

  const result = allStories.map(s => {
    const storyReactions = reactions.filter(r => r.storyId === s.id);
    return {
      ...s,
      views: viewsWithUser.filter(v => v.storyId === s.id).map(v => {
        // Best available name: displayName → firstName+lastName → email username
        const name = v.viewerDisplayName
          || (v.viewerFirstName ? `${v.viewerFirstName} ${v.viewerLastName || ""}`.trim() : null)
          || (v.viewerEmail ? v.viewerEmail.split("@")[0] : null)
          || "User";
        // Find this viewer's reaction on this story (if any)
        const reaction = storyReactions.find(r => r.userId === v.viewerId);
        return {
          storyId: v.storyId,
          viewerId: v.viewerId,
          viewerName: name,
          viewerAvatar: v.viewerAvatarUrl,
          reaction: reaction ? reaction.emoji : null,
        };
      }),
      viewCount: viewsWithUser.filter(v => v.storyId === s.id).length,
      reactions: storyReactions,
      hasViewed: viewsWithUser.some(v => v.storyId === s.id && v.viewerId === req.user!.id),
    };
  });

  res.json(result);
});

// POST /stories — create text story
router.post("/stories", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { type = "text", content, backgroundColor, textColor } = req.body;

  const [story] = await db.insert(storiesTable).values({
    userId: req.user!.id,
    type,
    content: content || null,
    backgroundColor: backgroundColor || "#1a1a2e",
    textColor: textColor || "#ffffff",
    expiresAt: storyExpiresAt(),
  }).returning();

  const [status] = await db.select().from(userStatusTable).where(eq(userStatusTable.userId, req.user!.id));
  res.json({ ...story, userName: status?.displayName, userAvatar: status?.avatarUrl, views: [], reactions: [], hasViewed: false, viewCount: 0 });
});

// POST /stories/media — create photo/video story
router.post("/stories/media", memUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }

  const isVideo = req.file.mimetype.startsWith("video/");
  const isAudio = req.file.mimetype.startsWith("audio/");

  let resourceType: "image" | "video" | "raw" = "image";
  if (isVideo) resourceType = "video";
  else if (isAudio) resourceType = "raw";

  const { url, publicId } = await uploadToCloudinary(req.file.buffer, {
    folder: "private-chat/stories",
    resourceType,
  });

  const storyType = isVideo ? "video" : isAudio ? "voice" : "image";

  const [story] = await db.insert(storiesTable).values({
    userId: req.user!.id,
    type: storyType,
    mediaUrl: url,
    mediaPublicId: publicId,
    content: req.body.content || null,
    backgroundColor: req.body.backgroundColor || "#000000",
    textColor: req.body.textColor || "#ffffff",
    expiresAt: storyExpiresAt(),
  }).returning();

  const [status] = await db.select().from(userStatusTable).where(eq(userStatusTable.userId, req.user!.id));
  res.json({ ...story, userName: status?.displayName, userAvatar: status?.avatarUrl, views: [], reactions: [], hasViewed: false, viewCount: 0 });
});

// POST /stories/:id/view — mark story as viewed
router.post("/stories/:id/view", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const storyId = parseInt(req.params.id);
  const viewerId = req.user!.id;

  const existing = await db.select().from(storyViewsTable)
    .where(and(eq(storyViewsTable.storyId, storyId), eq(storyViewsTable.viewerId, viewerId)));

  if (!existing.length) {
    await db.insert(storyViewsTable).values({ storyId, viewerId });
  }
  res.json({ ok: true });
});

// POST /stories/:id/react — react to story
router.post("/stories/:id/react", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const storyId = parseInt(req.params.id);
  const { emoji } = req.body;
  const userId = req.user!.id;

  const existing = await db.select().from(storyReactionsTable)
    .where(and(eq(storyReactionsTable.storyId, storyId), eq(storyReactionsTable.userId, userId)));

  if (existing.length) {
    await db.update(storyReactionsTable).set({ emoji }).where(eq(storyReactionsTable.id, existing[0].id));
  } else {
    await db.insert(storyReactionsTable).values({ storyId, userId, emoji });
  }
  res.json({ ok: true });
});

// DELETE /stories/:id
router.delete("/stories/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const storyId = parseInt(req.params.id);

  const [story] = await db.select().from(storiesTable)
    .where(and(eq(storiesTable.id, storyId), eq(storiesTable.userId, req.user!.id)));

  if (!story) { res.status(404).json({ error: "Story not found" }); return; }

  if (story.mediaPublicId) {
    const rt = story.type === "video" ? "video" : "image";
    await deleteFromCloudinary(story.mediaPublicId, rt);
  }

  await db.delete(storiesTable).where(eq(storiesTable.id, storyId));
  res.json({ ok: true });
});

export default router;

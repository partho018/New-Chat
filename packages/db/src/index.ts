import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  serial,
  jsonb,
} from "drizzle-orm/pg-core";

const sql = neon(process.env.NEON_DATABASE_URL!);
export const db = drizzle(sql);

export const usersTable = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").unique(),
  username: text("username"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  passwordHash: text("password_hash"),
  profileImageUrl: text("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const userStatusTable = pgTable("user_status", {
  userId: text("user_id").primaryKey(),
  isOnline: boolean("is_online").default(false).notNull(),
  lastSeen: timestamp("last_seen"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
});

export const sessionsTable = pgTable("sessions", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  isGroup: boolean("is_group").default(false).notNull(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const conversationParticipantsTable = pgTable(
  "conversation_participants",
  {
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
  }
);

export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  senderId: text("sender_id").notNull(),
  content: text("content"),
  messageType: text("message_type").default("text").notNull(),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  duration: integer("duration"),
  replyToId: integer("reply_to_id"),
  isDeleted: boolean("is_deleted").default(false).notNull(),
  edited: boolean("edited").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messageSeenTable = pgTable("message_seen", {
  messageId: integer("message_id")
    .notNull()
    .references(() => messagesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
});

export const messageDeliveredTable = pgTable("message_delivered", {
  messageId: integer("message_id")
    .notNull()
    .references(() => messagesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
});

export const messageReactionsTable = pgTable("message_reactions", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id")
    .notNull()
    .references(() => messagesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  emoji: text("emoji").notNull(),
});

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").unique().notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
});

export const storiesTable = pgTable("stories", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  content: text("content"),
  mediaUrl: text("media_url"),
  mediaPublicId: text("media_public_id"),
  backgroundColor: text("background_color"),
  textColor: text("text_color"),
  duration: integer("duration"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const storyViewsTable = pgTable("story_views", {
  storyId: integer("story_id")
    .notNull()
    .references(() => storiesTable.id, { onDelete: "cascade" }),
  viewerId: text("viewer_id").notNull(),
});

export const storyReactionsTable = pgTable("story_reactions", {
  id: serial("id").primaryKey(),
  storyId: integer("story_id")
    .notNull()
    .references(() => storiesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  emoji: text("emoji").notNull(),
});

export const expoPushTokensTable = pgTable("expo_push_tokens", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  token: text("token").unique().notNull(),
});

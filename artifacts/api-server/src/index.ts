import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { setupSocketIO } from "./lib/socket";
import { initRouterWithIO } from "./routes";
import { db } from "@workspace/db";
import { userStatusTable } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  path: "/api/socket.io",
  cors: {
    origin: true,
    credentials: true,
  },
  maxHttpBufferSize: 25 * 1024 * 1024, // 25MB for ephemeral media
});

setupSocketIO(io);
initRouterWithIO(io);

httpServer.listen(port, async () => {
  logger.info({ port }, "Server listening");

  // Reset all users to offline on startup
  try {
    await db.update(userStatusTable).set({ isOnline: false, lastSeen: new Date() });
  } catch (err) {
    logger.warn({ err }, "Could not reset user statuses on startup");
  }
});

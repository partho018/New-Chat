import { Router, type IRouter } from "express";
import { Server as SocketIOServer } from "socket.io";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import conversationsRouter from "./conversations";
import messagesRouter, { setIO } from "./messages";
import uploadRouter from "./upload";
import pushRouter from "./push";
import expoPushRouter from "./expo-push";
import storiesRouter from "./stories";
import iceServersRouter from "./ice-servers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(conversationsRouter);
router.use(messagesRouter);
router.use(uploadRouter);
router.use(pushRouter);
router.use(expoPushRouter);
router.use(storiesRouter);
router.use(iceServersRouter);

export function initRouterWithIO(io: SocketIOServer) {
  setIO(io);
}

export default router;

import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as pinoHttp from "pino-http";
import type { IncomingMessage, ServerResponse } from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import router from "./routes";
import { logger } from "./lib/logger";
import { authMiddleware } from "./middlewares/authMiddleware";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp.pinoHttp({
    logger,
    serializers: {
      req(req: IncomingMessage & { id?: unknown; url?: string }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: ServerResponse) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(authMiddleware);

app.use("/api", router);

const webAppDist = path.resolve(__dirname, "../../web-app/dist");
if (fs.existsSync(webAppDist)) {
  app.use(express.static(webAppDist));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(webAppDist, "index.html"));
  });
} else {
  app.get("/{*path}", (_req, res) => {
    res.json({ status: "API server running", version: "1.0.0" });
  });
}

export default app;

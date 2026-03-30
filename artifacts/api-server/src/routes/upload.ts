import { Router, type IRouter } from "express";
import multer from "multer";
import sharp from "sharp";
import { uploadToCloudinary, deleteFromCloudinary } from "../lib/cloudinary";

const router: IRouter = Router();

const memStorage = multer.memoryStorage();

const upload = multer({
  storage: memStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

const avatarUpload = multer({
  storage: memStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

function getResourceType(mimetype: string): "image" | "video" | "raw" {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "video"; // Cloudinary uses "video" for audio
  return "raw";
}

// General file upload → Cloudinary (chat images, video, voice)
router.post("/upload", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  try {
    const resourceType = getResourceType(req.file.mimetype);

    const { url, publicId } = await uploadToCloudinary(req.file.buffer, {
      folder: "private-chat/messages",
      resourceType,
    });

    res.json({
      url,
      publicId,
      fileName: req.file.originalname,
      fileSize: req.file.size,
    });
  } catch (err) {
    console.error("File upload error:", err);
    res.status(500).json({ error: "File upload failed" });
  }
});

// Avatar upload — resize, convert to WebP, then upload to Cloudinary
router.post("/upload/avatar", avatarUpload.single("file"), async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  try {
    const optimizedBuffer = await sharp(req.file.buffer, { failOn: "none" })
      .rotate()
      .resize(400, 400, { fit: "cover", position: "centre" })
      .webp({ quality: 85 })
      .toBuffer();

    const { url, publicId } = await uploadToCloudinary(optimizedBuffer, {
      folder: "private-chat/avatars",
      publicId: `avatar_${req.user!.id}`,
      resourceType: "image",
    });

    res.json({
      url,
      publicId,
      optimized: true,
      format: "webp",
      dimensions: "400x400",
    });
  } catch (err) {
    console.error("Avatar upload error:", err);
    res.status(500).json({ error: "Image upload failed" });
  }
});

// Delete a file from Cloudinary (optional cleanup endpoint)
router.delete("/upload/file", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const publicId = req.query.publicId as string;
    const resourceType = (req.query.type as "image" | "video" | "raw") || "image";
    if (!publicId) { res.status(400).json({ error: "publicId required" }); return; }
    await deleteFromCloudinary(publicId, resourceType);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;

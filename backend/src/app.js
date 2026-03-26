const express = require("express");
const multer = require("multer");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { PORT, resolvedUploadsRoot, JWT_SECRET, JWT_EXPIRES_IN } = require("./config/env");
const { pool } = require("./config/db");
const { buildUploadPaths, ensureUploadDirs } = require("./config/paths");
const { createAuthMiddleware } = require("./middleware/auth");
const { createDbGuards } = require("./utils/db-guards");
const { createAuthService } = require("./services/auth-service");
const { newId, nowIso } = require("./utils/ids");

function createBaseAppRuntime() {
  const app = express();

  const uploadPaths = buildUploadPaths(resolvedUploadsRoot);
  ensureUploadDirs(uploadPaths);

  const uploadsRoot = uploadPaths.uploadsRoot;
  const questionUploadsDir = uploadPaths.questionUploadsDir;
  const materialImageDir = uploadPaths.materialImageDir;
  const materialVideoDir = uploadPaths.materialVideoDir;
  const materialThumbDir = uploadPaths.materialThumbDir;
  const materialAppDir = uploadPaths.materialAppDir;

  const makeDiskUpload = (destinationDir, fileSize, allowFile) =>
    multer({
      storage: multer.diskStorage({
        destination: function (_req, _file, cb) { cb(null, destinationDir); },
        filename: function (_req, file, cb) {
          const safeBase = path.basename(file.originalname || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
          const ext = path.extname(safeBase).slice(0, 20);
          const stem = path.basename(safeBase, ext).slice(0, 60) || "file";
          cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}_${stem}${ext}`);
        },
      }),
      limits: { fileSize },
      fileFilter: function (_req, file, cb) {
        try {
          if (!allowFile(file)) return cb(new Error("invalid_file_type"));
          cb(null, true);
        } catch (e) {
          cb(e);
        }
      },
    });

  const materialImageUpload = makeDiskUpload(materialImageDir, 10 * 1024 * 1024, (file) => String(file.mimetype || "").startsWith("image/"));
  const materialThumbUpload = makeDiskUpload(materialThumbDir, 10 * 1024 * 1024, (file) => String(file.mimetype || "").startsWith("image/"));
  const materialVideoUpload = makeDiskUpload(materialVideoDir, 250 * 1024 * 1024, (file) => /^video\/(mp4|webm|ogg)/.test(String(file.mimetype || "")));
  const materialAppUpload = makeDiskUpload(materialAppDir, 20 * 1024 * 1024, (file) => {
    const mime = String(file.mimetype || "").toLowerCase();
    const ext = path.extname(file.originalname || "").toLowerCase();
    return mime === "text/html" || ext === ".html" || ext === ".htm";
  });

  const questionUpload = multer({
    storage: multer.diskStorage({
      destination: function (_req, _file, cb) {
        cb(null, questionUploadsDir);
      },
      filename: function (_req, file, cb) {
        const ext = path.extname(file.originalname || "").slice(0, 16);
        cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}${ext}`);
      },
    }),
    limits: {
      fileSize: 5 * 1024 * 1024,
    },
  });

  app.use(helmet({ crossOriginResourcePolicy: false }));

  const corsOrigins = String(process.env.CORS_ORIGIN || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("cors_not_allowed"));
    },
  }));
  app.use(express.json({ limit: "10mb" }));

  app.use((req, _res, next) => {
  	if (req.url === "/api") req.url = "/";
  	else if (req.url.startsWith("/api/")) req.url = req.url.slice(4);
  	next();
	});

  const { tableAvailable, isMissingRelationError, isPermissionError, isSafeSchemaError } = createDbGuards(pool);
  const { requireAuth, requireRole } = createAuthMiddleware({ jwt, jwtSecret: JWT_SECRET });
  const authService = createAuthService({
    pool,
    bcrypt,
    jwt,
    jwtSecret: JWT_SECRET,
    jwtExpiresIn: JWT_EXPIRES_IN,
  });

  return {
    app,
    pool,
    PORT,
    JWT_SECRET,
    uploadsRoot,
    questionUploadsDir,
    materialImageUpload,
    materialThumbUpload,
    materialVideoUpload,
    materialAppUpload,
    questionUpload,
    tableAvailable,
    isMissingRelationError,
    isPermissionError,
    isSafeSchemaError,
    requireAuth,
    requireRole,
    authService,
    newId,
    nowIso,
  };
}

module.exports = {
  createBaseAppRuntime,
};

function createUploadFactories({
  multer,
  path,
  questionUploadsDir,
  materialImageDir,
  materialThumbDir,
  materialVideoDir,
  materialAppDir,
}) {
  const makeDiskUpload = (destinationDir, fileSize, allowFile) =>
    multer({
      storage: multer.diskStorage({
        destination: function (_req, _file, cb) {
          cb(null, destinationDir);
        },
        filename: function (_req, file, cb) {
          const safeBase = path
            .basename(file.originalname || "file")
            .replace(/[^a-zA-Z0-9._-]/g, "_")
            .slice(0, 80);
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

  const materialImageUpload = makeDiskUpload(
    materialImageDir,
    10 * 1024 * 1024,
    (file) => String(file.mimetype || "").startsWith("image/")
  );

  const materialThumbUpload = makeDiskUpload(
    materialThumbDir,
    10 * 1024 * 1024,
    (file) => String(file.mimetype || "").startsWith("image/")
  );

  const materialVideoUpload = makeDiskUpload(
    materialVideoDir,
    250 * 1024 * 1024,
    (file) => /^video\/(mp4|webm|ogg)/.test(String(file.mimetype || ""))
  );

  const materialAppUpload = makeDiskUpload(
    materialAppDir,
    20 * 1024 * 1024,
    (file) => {
      const mime = String(file.mimetype || "").toLowerCase();
      const ext = path.extname(file.originalname || "").toLowerCase();
      return mime === "text/html" || ext === ".html" || ext === ".htm";
    }
  );

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
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  return {
    makeDiskUpload,
    materialImageUpload,
    materialThumbUpload,
    materialVideoUpload,
    materialAppUpload,
    questionUpload,
  };
}

module.exports = {
  createUploadFactories,
};

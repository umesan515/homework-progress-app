const fs = require("fs");
const path = require("path");

function buildUploadPaths(baseDir) {
  const uploadsRoot = baseDir;
  const questionUploadsDir = path.join(uploadsRoot, "questions");
  const materialUploadsDir = path.join(uploadsRoot, "materials");
  const materialImageDir = path.join(materialUploadsDir, "images");
  const materialVideoDir = path.join(materialUploadsDir, "videos");
  const materialThumbDir = path.join(materialUploadsDir, "thumbs");
  const materialAppDir = path.join(materialUploadsDir, "apps");

  return {
    uploadsRoot,
    questionUploadsDir,
    materialUploadsDir,
    materialImageDir,
    materialVideoDir,
    materialThumbDir,
    materialAppDir,
  };
}

function ensureUploadDirs(paths) {
  const dirs = [
    paths.questionUploadsDir,
    paths.materialUploadsDir,
    paths.materialImageDir,
    paths.materialVideoDir,
    paths.materialThumbDir,
    paths.materialAppDir,
  ];

  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_e) {
      // ignore
    }
  }
}

module.exports = {
  buildUploadPaths,
  ensureUploadDirs,
};

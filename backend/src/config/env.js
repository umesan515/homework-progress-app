const path = require("path");

const uploadsRootEnv = process.env.UPLOAD_DIR || "uploads";
const resolvedUploadsRoot = path.isAbsolute(uploadsRootEnv)
  ? uploadsRootEnv
  : path.join(__dirname, "..", "..", uploadsRootEnv);

const JWT_SECRET = process.env.JWT_SECRET || "DEV_SECRET_CHANGE_ME";
const JWT_EXPIRES_IN = "14d";
const PORT = Number(process.env.PORT || 4000);

module.exports = {
  uploadsRootEnv,
  resolvedUploadsRoot,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  PORT,
};

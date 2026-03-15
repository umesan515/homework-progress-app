const fs = require('fs');
const path = require('path');
const bcrypt = require("bcrypt");

const root = process.cwd();
const serverPath = path.join(root, 'server.js');
const backupPath = path.join(root, 'server.js.phase2-backup');

function ensureExists(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    throw new Error(`missing_required_file: ${rel}`);
  }
}

[
  'src/config/env.js',
  'src/config/db.js',
  'src/config/paths.js',
  'src/middleware/auth.js',
  'src/utils/ids.js',
  'src/utils/db-guards.js',
  'server.js',
].forEach(ensureExists);

let code = fs.readFileSync(serverPath, 'utf8');
const original = code;

function replaceOnce(description, pattern, replacement) {
  const next = code.replace(pattern, replacement);
  if (next === code) {
    throw new Error(`patch_failed:${description}`);
  }
  code = next;
}

replaceOnce(
  'require block',
  /const express = require\("express"\);[\s\S]*?const crypto = require\("crypto"\);/,
  `const express = require("express");\nconst multer = require("multer");\nconst path = require("path");\nconst fs = require("fs");\nconst dotenv = require("dotenv");\nconst cors = require("cors");\nconst helmet = require("helmet");\nconst bcrypt = require("bcrypt");\nconst jwt = require("jsonwebtoken");\n\nconst { PORT, resolvedUploadsRoot, JWT_SECRET, JWT_EXPIRES_IN } = require("./src/config/env");\nconst { pool } = require("./src/config/db");\nconst { buildUploadPaths, ensureUploadDirs } = require("./src/config/paths");\nconst { createAuthMiddleware } = require("./src/middleware/auth");\nconst { newId, nowIso } = require("./src/utils/ids");\nconst { createDbGuards } = require("./src/utils/db-guards");`
);

replaceOnce(
  'upload path setup',
  /const uploadsRootEnv = process\.env\.UPLOAD_DIR \|\| "uploads";[\s\S]*?for \(const dir of \[materialUploadsDir, materialImageDir, materialVideoDir, materialThumbDir, materialAppDir\]\) \{\s*try \{ fs\.mkdirSync\(dir, \{ recursive: true \}\); \} catch \(_e\) \{\}\s*\}/,
  `const uploadPaths = buildUploadPaths(resolvedUploadsRoot);\nensureUploadDirs(uploadPaths);\n\n// --- uploads (question images) ---\nconst uploadsRoot = uploadPaths.uploadsRoot;\nconst questionUploadsDir = uploadPaths.questionUploadsDir;\nconst materialUploadsDir = uploadPaths.materialUploadsDir;\nconst materialImageDir = uploadPaths.materialImageDir;\nconst materialVideoDir = uploadPaths.materialVideoDir;\nconst materialThumbDir = uploadPaths.materialThumbDir;\nconst materialAppDir = uploadPaths.materialAppDir;`
);

replaceOnce(
  'jwt/db/guards block',
  /const JWT_SECRET = process\.env\.JWT_SECRET \|\| "DEV_SECRET_CHANGE_ME";[\s\S]*?function isSafeSchemaError\(e\) \{\s*return isMissingRelationError\(e\) \|\| isPermissionError\(e\);\s*\}/,
  `const { tableAvailable, isMissingRelationError, isPermissionError, isSafeSchemaError } = createDbGuards(pool);\nconst { requireAuth, requireRole } = createAuthMiddleware({ jwt, jwtSecret: JWT_SECRET });`
);

replaceOnce(
  'nowIso/newId block',
  /const nowIso = \(\) => new Date\(\)\.toISOString\(\);[\s\S]*?function newId\(prefix\) \{[\s\S]*?\n\}/,
  `// moved to ./src/utils/ids`
);

replaceOnce(
  'requireAuth/requireRole block',
  /function requireAuth\(req, res, next\) \{[\s\S]*?function requireRole\(role\) \{[\s\S]*?\n\}/,
  `// moved to ./src/middleware/auth`
);

if (code === original) {
  throw new Error('patch_failed:no_changes');
}

fs.writeFileSync(backupPath, original, 'utf8');
fs.writeFileSync(serverPath, code, 'utf8');

console.log('Patched server.js successfully');
console.log(`Backup created: ${path.basename(backupPath)}`);

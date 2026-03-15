const fs = require('fs');
const path = require('path');

const root = process.cwd();
const serverPath = path.join(root, 'server.js');
const backupPath = path.join(root, 'server.js.phase4-backup');

function ensureExists(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    throw new Error(`missing_required_file: ${rel}`);
  }
}

[
  'src/services/auth-service.js',
  'src/routes/auth.routes.js',
  'server.js',
].forEach(ensureExists);

let code = fs.readFileSync(serverPath, 'utf8');
const original = code;

if (code.includes('createAuthRouter') || code.includes('createAuthService')) {
  throw new Error('patch_failed:already_applied_or_conflicting_changes');
}

function replaceOnce(description, pattern, replacement) {
  const next = code.replace(pattern, replacement);
  if (next === code) {
    throw new Error(`patch_failed:${description}`);
  }
  code = next;
}

replaceOnce(
  'add auth requires',
  /const \{ createDbGuards \} = require\("\.\/src\/utils\/db-guards"\);/,
  `const { createDbGuards } = require("./src/utils/db-guards");\nconst { createAuthService } = require("./src/services/auth-service");\nconst { createAuthRouter } = require("./src/routes/auth.routes");`
);

replaceOnce(
  'add auth init',
  /const \{ requireAuth, requireRole \} = createAuthMiddleware\(\{ jwt, jwtSecret: JWT_SECRET \}\);/,
  `const { requireAuth, requireRole } = createAuthMiddleware({ jwt, jwtSecret: JWT_SECRET });\nconst authService = createAuthService({\n  pool,\n  bcrypt,\n  jwt,\n  jwtSecret: JWT_SECRET,\n  jwtExpiresIn: JWT_EXPIRES_IN,\n});\nconst authRouter = createAuthRouter({ authService, requireAuth, requireRole });`
);

replaceOnce(
  'mount auth router before health',
  /app\.get\("\/health", async \(_req, res\) => \{/,
  `app.use("/auth", authRouter);\n\napp.get("/health", async (_req, res) => {`
);

replaceOnce(
  'remove auth helper block',
  /function signToken\(user\) \{[\s\S]*?async function ensureDevAccounts\(\) \{[\s\S]*?__devAccountsReady = true;\s*\}\s*/,
  `// moved to ./src/services/auth-service\n\n`
);

replaceOnce(
  'remove auth routes block',
  /\/\*\*[\s\S]*?\* Auth[\s\S]*?\*\/\s*app\.post\("\/auth\/login",[\s\S]*?app\.post\("\/auth\/register-student",[\s\S]*?\n\}\);\s*/,
  `/**\n * -----------\n * Auth\n * -----------\n */\n\n// moved to ./src/routes/auth.routes.js\n\n`
);

if (code === original) {
  throw new Error('patch_failed:no_changes');
}

fs.writeFileSync(backupPath, original, 'utf8');
fs.writeFileSync(serverPath, code, 'utf8');

console.log('Patched server.js successfully');
console.log(`Backup created: ${path.basename(backupPath)}`);

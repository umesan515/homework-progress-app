const fs = require('fs');
const path = require('path');

const root = process.cwd();
const serverPath = path.join(root, 'server.js');
const backupPath = path.join(root, 'server.js.phase3-backup');

function ensureExists(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    throw new Error(`missing_required_file: ${rel}`);
  }
}

[
  'src/uploads/factories.js',
  'src/services/runtime-migrations.js',
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
  'add phase3 requires',
  /const \{ createDbGuards \} = require\("\.\/src\/utils\/db-guards"\);/,
  `const { createDbGuards } = require("./src/utils/db-guards");\nconst { createUploadFactories } = require("./src/uploads/factories");\nconst { createRuntimeMigrations } = require("./src/services/runtime-migrations");`
);

replaceOnce(
  'extract upload factories block',
  /const makeDiskUpload = \(destinationDir, fileSize, allowFile\) =>[\s\S]*?const questionUpload = multer\(\{[\s\S]*?limits: \{ fileSize: 5 \* 1024 \* 1024, \/\/ 5MB\s*\},\s*\}\);/,
  `const {\n  materialImageUpload,\n  materialThumbUpload,\n  materialVideoUpload,\n  materialAppUpload,\n  questionUpload,\n} = createUploadFactories({\n  multer,\n  path,\n  questionUploadsDir,\n  materialImageDir,\n  materialThumbDir,\n  materialVideoDir,\n  materialAppDir,\n});`
);

replaceOnce(
  'extract runtime migrations block',
  /let __bookClassesReady = false;[\s\S]*?async function ensureBookClassesTable\(\) \{[\s\S]*?__bookClassesReady = true;\s*\}/,
  `const { ensureMaterialsTables, ensureBookClassesTable } = createRuntimeMigrations(pool);`
);

if (code === original) {
  throw new Error('patch_failed:no_changes');
}

fs.writeFileSync(backupPath, original, 'utf8');
fs.writeFileSync(serverPath, code, 'utf8');

console.log('Patched server.js successfully');
console.log(`Backup created: ${path.basename(backupPath)}`);

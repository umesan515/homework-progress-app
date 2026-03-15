const crypto = require("crypto");

const nowIso = () => new Date().toISOString();

function newId(prefix) {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${suffix}`;
}

module.exports = {
  nowIso,
  newId,
};

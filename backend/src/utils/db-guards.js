function createDbGuards(pool) {
  async function tableAvailable(tableName) {
    try {
      const target = String(tableName || "").includes(".")
        ? String(tableName)
        : `public.${String(tableName)}`;
      const r = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [target]);
      return !!r.rows?.[0]?.exists;
    } catch (_e) {
      return false;
    }
  }

  function isMissingRelationError(e) {
    return String(e?.code || "") === "42P01";
  }

  function isPermissionError(e) {
    return String(e?.code || "") === "42501";
  }

  function isSafeSchemaError(e) {
    return isMissingRelationError(e) || isPermissionError(e);
  }

  return {
    tableAvailable,
    isMissingRelationError,
    isPermissionError,
    isSafeSchemaError,
  };
}

module.exports = {
  createDbGuards,
};

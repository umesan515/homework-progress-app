function createAuthMiddleware({ jwt, jwtSecret }) {
  function requireAuth(req, res, next) {
    const h = req.headers.authorization || "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: "missing_token" });

    try {
      const payload = jwt.verify(m[1], jwtSecret);
      req.user = payload;
      next();
    } catch (_e) {
      return res.status(401).json({ error: "invalid_token" });
    }
  }

  function requireRole(role) {
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: "missing_token" });
      if (req.user.role !== role) return res.status(403).json({ error: "forbidden" });
      next();
    };
  }

  return {
    requireAuth,
    requireRole,
  };
}

module.exports = {
  createAuthMiddleware,
};

function createAuthMiddleware({ jwt, jwtSecret }) {
  function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: "missing_token" });

    try {
      const payload = jwt.verify(match[1], jwtSecret);
      req.user = payload;
      next();
    } catch (_error) {
      return res.status(401).json({ error: "invalid_token" });
    }
  }

  function requireRole(role) {
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: "missing_token" });

      if (req.user.role === role) {
        next();
        return;
      }

      if (role === "teacher" && req.user.role === "admin") {
        next();
        return;
      }

      return res.status(403).json({ error: "forbidden" });
    };
  }

  return { requireAuth, requireRole };
}

module.exports = { createAuthMiddleware };

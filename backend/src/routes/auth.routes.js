const express = require("express");

function createAuthRouter({ authService, requireAuth, requireRole }) {
  const router = express.Router();

  router.post("/login", async (req, res) => {
    try {
      const { loginId, password } = req.body ?? {};
      if (!loginId || !password) return res.status(400).json({ error: "missing_body" });

      const result = await authService.login(loginId, password);
      return res.json(result);
    } catch (e) {
      if (e?.status && e?.code) {
        return res.status(e.status).json({ error: e.code });
      }
      console.error("[POST /auth/login]", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  router.post("/register-student", requireAuth, requireRole("teacher"), async (req, res) => {
    const { loginId, password, classId, displayName } = req.body ?? {};
    if (!loginId || !password) return res.status(400).json({ error: "missing_body" });

    try {
      const result = await authService.registerStudent({ loginId, password, classId, displayName });
      return res.json(result);
    } catch (e) {
      console.error("[POST /auth/register-student]", e);
      return res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}

module.exports = {
  createAuthRouter,
};

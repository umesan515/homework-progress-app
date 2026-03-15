function registerBaseRoutes({ app, authRouter, teacherCoreRouter, teacherMaterialsRouter, pool, nowIso }) {
  app.use("/auth", authRouter);
  app.use("/teacher", teacherCoreRouter);
  app.use("/teacher", teacherMaterialsRouter);

  app.get("/health", async (_req, res) => {
    try {
      const r = await pool.query("SELECT 1 AS ok");
      res.json({ ok: true, db: r.rows[0].ok === 1, time: nowIso() });
    } catch (e) {
      console.error("[health]", e);
      res.status(500).json({ ok: false, error: "db_connect_failed" });
    }
  });
}

module.exports = {
  registerBaseRoutes,
};

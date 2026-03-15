const { createTeacherMaterialsRouter } = require("../../routes/teacher-materials.routes");

function createMaterialsModule({ pool, requireAuth, requireRole, deps }) {
  return createTeacherMaterialsRouter({ pool, requireAuth, requireRole, deps });
}

module.exports = {
  createMaterialsModule,
};

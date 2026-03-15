const { createTeacherCoreRouter } = require("../../routes/teacher-core.routes");

function createTeacherModule({ pool, bcrypt, requireAuth, requireRole, deps }) {
  return createTeacherCoreRouter({ pool, bcrypt, requireAuth, requireRole, deps });
}

module.exports = {
  createTeacherModule,
};

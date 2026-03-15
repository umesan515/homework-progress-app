const { createAuthRouter } = require("../../routes/auth.routes");

function createAuthModule({ authService, requireAuth, requireRole }) {
  return createAuthRouter({ authService, requireAuth, requireRole });
}

module.exports = {
  createAuthModule,
};

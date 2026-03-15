const { createAuthModule } = require("./auth");
const { createTeacherModule } = require("./teacher");
const { createMaterialsModule } = require("./materials");
const { registerBaseRoutes } = require("../routes");

function createAndRegisterModules({
  app,
  pool,
  nowIso,
  authService,
  requireAuth,
  requireRole,
  bcrypt,
  deps,
}) {
  const authRouter = createAuthModule({ authService, requireAuth, requireRole });

  const teacherCoreRouter = createTeacherModule({
    pool,
    bcrypt,
    requireAuth,
    requireRole,
    deps: {
      detectUserColumns: deps.detectUserColumns,
      ensureSchoolClassesTable: deps.ensureSchoolClassesTable,
      readSchoolClassesStore: deps.readSchoolClassesStore,
      writeSchoolClassesStore: deps.writeSchoolClassesStore,
      upsertSchoolClass: deps.upsertSchoolClass,
      findUserByUid: deps.findUserByUid,
      findAnyUserByLoginId: deps.findAnyUserByLoginId,
      upsertStudentUser: deps.upsertStudentUser,
      updateStudentUser: deps.updateStudentUser,
      upsertUserAuth: deps.upsertUserAuth,
      removeMemoryAuthUserByUid: deps.removeMemoryAuthUserByUid,
      removeSchoolClassFromStore: deps.removeSchoolClassFromStore,
      tableAvailable: deps.tableAvailable,
      isSafeSchemaError: deps.isSafeSchemaError,
    },
  });

  const teacherMaterialsRouter = createMaterialsModule({
    pool,
    requireAuth,
    requireRole,
    deps: {
      newId: deps.newId,
      ensureMaterialsTables: deps.ensureMaterialsTables,
      listTeacherMaterials: deps.listTeacherMaterials,
      readMaterialById: deps.readMaterialById,
      normalizeMaterialClassIds: deps.normalizeMaterialClassIds,
      normalizeSubject: deps.normalizeSubject,
      isValidMaterialType: deps.isValidMaterialType,
      isValidInteractiveKind: deps.isValidInteractiveKind,
      isSafeSchemaError: deps.isSafeSchemaError,
    },
  });

  registerBaseRoutes({
    app,
    authRouter,
    teacherCoreRouter,
    teacherMaterialsRouter,
    pool,
    nowIso,
  });
}

module.exports = { createAndRegisterModules };

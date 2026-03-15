# Public repository checklist

## Done in this bundle

- `.gitignore` strengthened for env files, uploads, build artifacts
- Backend moved to env-driven config (`DATABASE_URL` or `PG*`, `JWT_SECRET`, `CORS_ORIGIN`, `UPLOAD_DIR`)
- Added `backend/.env.example`
- Added `frontend/.env.example`
- Added `docker/.env.example`
- Added README for public setup
- Added `helmet` and `dotenv` to backend dependencies
- Docker compose no longer contains hard-coded sample secrets
- Frontend teacher question deletion now uses the shared `NEXT_PUBLIC_API_BASE` setting

## Check before making the repo public

1. Confirm real `.env` files are NOT tracked by git.
2. Confirm `backend/uploads/` is not tracked by git.
3. Rotate any secrets that may have been used previously in local development.
4. Set a strong `JWT_SECRET` in production.
5. Set `CORS_ORIGIN` to your actual front-end URL in production.
6. If you already committed secrets in the past, rewrite git history before publishing.

## Important note

The uploaded zip did not contain `frontend/package.json`, so that file could not be reviewed or updated in this pass.
Before publishing, confirm that the frontend package file exists locally and that it does not contain private values.

# Tsunami Studio API — development

This is an **unpublished server-side foundation**, not yet a live generator.
The GitHub Pages front end remains in local demo mode until deployment.

## Infrastructure
Cloudflare Workers + D1 + private R2 bucket. Telegram login is verified on the server using initData HMAC-SHA256. Never put BOT_TOKEN into public HTML or GitHub.

## Deploy (when account is ready)
1. Create Cloudflare account. Install Wrangler and sign in.
2. Create D1 database `tsunami-studio-db`, insert its database ID in wrangler.toml.
3. Create R2 bucket `tsunami-studio-photos` (R2 may require payment details).
4. Apply database migration `npx wrangler d1 execute tsunami-studio-db --remote --file=./schema.sql`.
5. Set secret: `npx wrangler secret put BOT_TOKEN`.
6. Deploy from `backend/`: `npx wrangler deploy`.
7. Configure FRONTEND_ORIGIN to the deployed GitHub Pages origin.
8. Put deployed API URL into front end only after testing.

Endpoints:
- GET /health
- GET /me, GET /jobs : Telegram initData authenticated.
- POST /jobs : generation intentionally disabled and returns 503 GENERATION_NOT_CONFIGURED. It **never deducts paid credits**.
- POST /drafts : authenticated private photo upload (multipart: photo, template_id, consent=true). Requires configured R2. Returns draft id, never charges tokens or generates video.
- DELETE /drafts/:id : deletes an owned draft and its stored source image.
- Drafts are not yet automatically expired; configure retention and privacy disclosures before collecting real personal photos.
- POST /demo/orders : authenticated test order with no photo upload, no credits, no generation.

## Before production
Implement provider-specific asynchronous video jobs, file retention/deletion, rate limits, Telegram Stars payment invoices and verification, refund workflow, privacy notice, support and admin logging. DO NOT enable paid checkout before this.

## Verification
Run `npm test` in `backend/`. The GitHub Actions workflow runs these tests on PRs. Current schema is for a **new** database; if you already initialized D1 using an earlier schema, migrate the CHECK constraint before deploying drafts.

## Security / user-data caveats
Never publish the R2 bucket or add a public read URL for user photos. Add automated image retention, deletion-on-user-request, and request-abuse protection before public launch. `GET /jobs` currently reveals only metadata, not image files. No provider keys or bot tokens should ever be committed.

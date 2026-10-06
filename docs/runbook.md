# Runbook

Production: `https://insights.johnedeh.com` (Vercel project `insights-mcp`, Neon branch `main`). Admin: `/admin` (Google sign-in, `ADMIN_EMAILS`).

## 1. Something is wrong right now
1. **Stop the bleeding**: `/admin` -> Global kill switch -> on (with a message). Every tool call then returns "paused" within ~10 s. Sign-in and `/account` keep working.
2. **Look**: `vercel logs --scope edeh-jaycees-projects` (project `insights-mcp`), `/admin/usage` (error rate, per-tool latency), `/admin/audit`.
3. **Roll back a bad deploy**: Vercel dashboard -> Deployments -> previous Ready deployment -> Promote to Production (or `vercel rollback`). Code rollbacks do not undo DB migrations: migrations here are additive, so old code keeps working.
4. Turn the kill switch off when fixed.

## 2. Suspected token or data compromise
1. Kill switch on.
2. Revoke every OAuth token (AI clients must re-authorize):
   `update oauth_tokens set revoked_at = now() where revoked_at is null;`
   (Neon SQL editor, branch `main`, or `psql` with the prod URL.)
3. Invalidate all web sessions: rotate `SESSION_SECRET` (section 4); everyone signs in again.
4. If Google refresh tokens may have leaked: rotate `TOKEN_ENC_KEYS` is NOT enough (attacker holds ciphertext only if they also had the key). Rotate the key anyway, then in `/admin` disconnect affected users, or ask users to revoke at `myaccount.google.com/permissions`. As a last resort delete the OAuth client in Google Cloud (all Google tokens for it die) and create a new one (section 5).
5. Record what happened in `STATUS.md` (Log) and tell affected users (GDPR/privacy policy promise).

## 3. Routine operations
- **Deploy**: merge/push to `main` -> Vercel builds and deploys production. Branch pushes make previews (previews have no secrets: they only prove the build).
- **Migrate DB**: edit `src/server/db/schema.ts` -> `npm run db:generate` -> `npm run db:migrate` (dev branch) -> test -> `npm run db:migrate:prod` (prints the target host first). Additive changes only while old code may still run.
- **Grant team access**: `/admin/grants`. **Invite**: `/admin/invites`.
- **Cron** (Vercel Cron, daily): `/api/cron/trial-notices` 09:00 UTC, `/api/cron/cleanup` 03:00 UTC. Manual run: `curl -H "Authorization: Bearer $CRON_SECRET" https://insights.johnedeh.com/api/cron/cleanup` (get the secret from Vercel env; do not paste it into chat or docs).

## 4. Rotating secrets
| Secret | How | Impact |
|---|---|---|
| `TOKEN_ENC_KEYS` / `TOKEN_ENC_CURRENT` | Add a new version to the JSON map (`openssl rand -base64 32`), set `TOKEN_ENC_CURRENT` to it, redeploy. Existing tokens are re-encrypted lazily when used. Remove the old version only when `select count(*) from google_connections where enc_key_version = <old>;` is 0. | None for users |
| `SESSION_SECRET` | Set a new value (`openssl rand -hex 32`), redeploy | All users signed out of the web UI; AI client tokens unaffected |
| `GOOGLE_CLIENT_SECRET` | Google Cloud console -> Auth Platform -> Clients -> add a new secret, update Vercel env, redeploy, then disable the old secret | None if done in that order |
| `RESEND_API_KEY` | Create a new key in Resend, update env, redeploy, delete the old key | None |
| `CRON_SECRET` | New value (>= 16 chars) in Vercel env, redeploy | None (Vercel sends the new value) |
| Neon password | Neon console -> Roles -> reset; Vercel integration updates env; redeploy | Brief errors during the swap |

Always set env with `vercel env add NAME production --force [--sensitive]` fed from stdin, never inline in chat. Values copied from `.env.local` may be wrapped in quotes by `vercel env pull`: strip them (the app now refuses quote-wrapped values and names the variable).

## 5. Common failures
| Symptom | Likely cause / fix |
|---|---|
| "Your account was not found. Please reconnect the connector." | User row deleted; sign in again at `/account` |
| "Please reconnect Google" / `reconnect_required` | Google revoked the grant or `invalid_grant`; user signs in again |
| "Too many requests" | Plan limits in `src/config/plans.ts` (trial 20/min, 200/day) |
| Approve page says cross-origin rejected | Regression of the Referrer-Policy/Origin fix: see `src/server/oauth/authorize.ts` `isSameOriginPost` |
| Google error `invalid_client` on sign-in | `GOOGLE_CLIENT_ID/SECRET` wrong or wrapped in quotes in Vercel env |
| Google "redirect_uri_mismatch" | Redirect URI not registered on the OAuth client (needs `https://<host>/api/connect/google/callback`) |
| 429 on `/oauth/register` | Per-IP registration throttle (10/h); wait or raise `REGISTER_LIMIT` in `src/server/security/anon-ratelimit.ts` |
| Neon cold start latency | Compute scales to zero; first request after idle is slower |
| Cron returns 503 | `CRON_SECRET` not set in the environment |

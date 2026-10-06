# Moving from the PoC to the real brand

Principle: nothing brand-, account- or host-specific is hard-coded. Everything below is configuration, DNS and accounts. See ARCHITECTURE §12 for the reasoning. Tick items off in `STATUS.md` (task 8.5).

## What changes and what it costs users
| Change | Users must reconnect? |
|---|---|
| New domain / new MCP URL | **Yes**: each AI client must be re-pointed at the new URL (new connector) |
| New Google OAuth client (new Cloud project) | **Yes**: everyone signs in with Google again (new consent, new refresh token) |
| Same domain + same Google client, new hosting (Vercel -> Azure) | No |
| New brand name / logo only | No |
| Rotating `TOKEN_ENC_KEYS` / `SESSION_SECRET` | No / web sessions only |

Plan the order so users reconnect **once**: do domain + Google project together, announce a date, keep the PoC URL alive (read-only notice) for a few weeks.

## Checklist
1. **Domain**: register the brand domain on Cloudflare. DNS: `A <host> 76.76.21.21` (Vercel) with the proxy off, or the target platform's record. Update `PUBLIC_BASE_URL`.
2. **Google**: in a company-owned Cloud project (Workspace organization), enable Analytics Data API, Analytics Admin API, Search Console API. Auth Platform: External; app name, logo, support email on the brand domain, homepage/privacy/terms URLs, authorized domain; scopes `analytics.readonly`, `webmasters.readonly`, `openid`, `userinfo.email`, `userinfo.profile`. Create a Web client with redirect URI `https://<brand-host>/api/connect/google/callback`. Verify the domain in Search Console. **Submit for verification** (sensitive scope `analytics.readonly`: needs a demo video and the live privacy page; ~10 business days). Update `GOOGLE_CLIENT_ID/SECRET`.
3. **Email**: new Resend domain and `MAIL_FROM`; real mailboxes (Zoho, or Cloudflare Email Routing as fallback); set `SUPPORT_EMAIL`.
4. **Hosting**: move the Vercel project to the company team (Pro plan; Hobby is non-commercial), or deploy the container to Azure (`Dockerfile`; schedule the two cron endpoints with the platform scheduler and `CRON_SECRET`).
5. **Database**: `pg_dump` Neon branch `main` -> restore into the new database (or transfer the Neon project to the company org). Re-run `npm run db:migrate:prod` against it to confirm no pending migrations. Create a `dev` branch (schema only).
6. **Secrets**: generate new `TOKEN_ENC_KEYS` (keep the old version in the map until `enc_key_version` counts are 0), `SESSION_SECRET`, `CRON_SECRET`. Set everything with `vercel env add ... --sensitive`.
7. **Brand**: `BRAND_NAME`, taglines/paths in `src/config/brand.ts`, logo in Google consent screen and landing page, privacy/terms text (lawyer-approved), `ADMIN_EMAILS` for the company admins.
8. **Clients**: re-register the connector in Claude, ChatGPT, Cursor etc. with the new URL; update `docs/clients.md`; submit to directories once verified.
9. **Cleanup**: remove personal credentials and accounts from every service; update `docs/credentials-registry.md` (names only, no secrets); log the cutover in `STATUS.md`.

## Rollback
Keep the old environment intact until the new one has served real traffic for a week. DNS and env are the only switches; the database is the only state.

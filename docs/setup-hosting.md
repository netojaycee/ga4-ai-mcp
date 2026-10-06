# Hosting setup (PoC)

Done 2026-10-06.

| Item | Value |
|---|---|
| Vercel team / project | `edeh-jaycees-projects` (personal, Hobby) / `insights-mcp` |
| Linked locally | `.vercel/project.json` (gitignored) |
| Production URL | `https://insights.johnedeh.com` |
| DNS | Cloudflare zone `johnedeh.com`: `A insights → 76.76.21.21`, **DNS only** (proxy off, so streaming/SSE is not interfered with) |
| Neon | Resource `insights-mcp-db`, created through the Vercel Marketplace integration; env vars injected into the Vercel project |
| Neon org | `Edeh Jaycee's projects` |

## Environment variables
- Local: `.env.local` (gitignored). Pulled DB vars with `vercel env pull`. Google client ID/secret and dev secrets set locally.
- Vercel **production**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (sensitive), `TOKEN_ENC_KEYS` (sensitive, **different from local**), `TOKEN_ENC_CURRENT`, `SESSION_SECRET` (sensitive, **different from local**), `BRAND_NAME`, `TRIAL_DAYS`, `PUBLIC_BASE_URL=https://insights.johnedeh.com`, plus Neon vars from the integration.
- Not yet set anywhere: `ADMIN_EMAILS`, `RESEND_API_KEY`, `MAIL_FROM`.

## Databases (separated 2026-10-06)
- Neon project `insights-mcp-db` (id `patient-union-05531403`, org managed through the Vercel integration).
- Branch `main` = **production** (Vercel env `DATABASE_URL`, `DATABASE_URL_UNPOOLED`).
- Branch `dev` = local development, created **schema only** (no production data), auto-delete **Never**. Its URLs live in `.env.development.local` (gitignored), which `next dev` loads ahead of `.env.local`.
- Migrations: `npm run db:migrate` hits dev; `npm run db:migrate:prod` hits production. Apply a new migration to dev first, test, then prod.
- When real users exist, never branch dev from `main` with data unless using Neon's anonymize option.

## Notes and caveats
- Hobby plan is non-commercial. Move to Pro or Azure before company-wide use (ARCHITECTURE §11).
- Only the Neon plain Postgres is used. Vendor skills in `.agents/skills/` are reference only (see CLAUDE.md).
- The Vercel CLI offered a project-specific DNS record ("dns_change_recommended"). Optional; the A record works.
- `johnedeh.com` and `www` belong to the separate `johnedeh` portfolio project. Don't touch those.

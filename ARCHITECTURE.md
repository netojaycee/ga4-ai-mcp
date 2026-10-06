# ARCHITECTURE

> **Reading guide (2026-10-06):** sections 1-13 are the original design. **Section 14 at the end records what was actually built and every place it differs.** When the two disagree, section 14 is right.


Working codename: **`ga-mcp`** (placeholder, product name TBD). All brand-specific values live in one place (`src/config/brand.ts` + env) so renaming is a config change, not a refactor. See [§12 Portability](#12-portability--moving-to-the-real-brand).

## 1. What we are building

A **hosted, multi-user MCP server** that lets any MCP-compatible AI client (ChatGPT, Claude, Cursor, VS Code Copilot, Windsurf, Gemini CLI, etc.) read a user's **Google Analytics 4** and **Google Search Console** data after a one-click "Sign in with Google". No terminal, no service accounts, no local install for the end user.

Plus a small **admin dashboard** so the owner can manage users, plans and trials by hand.

```
 AI client (ChatGPT / Claude / Cursor / ...)
        │  MCP over HTTPS (Streamable HTTP) + OAuth 2.1 (PKCE, DCR)
        ▼
 ┌───────────────────────────── our service (Next.js on Vercel) ─────────────────────────────┐
 │  /mcp                      MCP resource server (tools)                                    │
 │  /.well-known/*            OAuth discovery metadata (RFC 9728 + RFC 8414)                 │
 │  /oauth/register           Dynamic Client Registration (RFC 7591)                         │
 │  /oauth/authorize,/token   Our OAuth authorization server for MCP clients                 │
 │  /connect/google/*         Upstream: Google OAuth (user grants GA4 + GSC read-only)       │
 │  /admin                    Admin dashboard (owner only)                                   │
 │  /                         Minimal landing + setup instructions + privacy/terms stubs     │
 └───────────────┬───────────────────────────────────────────────┬───────────────────────────┘
                 │ Postgres (Neon)                               │ Google APIs (user's token)
                 ▼                                               ▼
   users, plans, clients, tokens(hashed),            GA4 Data API, GA4 Admin API,
   google refresh tokens (AES-GCM encrypted),        Search Console API
   usage_events, audit_log
```

**Two OAuth layers (the key concept):**
1. **Client ↔ us**: the AI client logs into *our* server. We are the authorization server. We issue our own opaque tokens.
2. **Us ↔ Google**: during step 1 we send the user to Google to consent. We store the Google refresh token encrypted and use it server-side. **Google tokens are never given to the AI client.**

## 2. Scope

### MVP (in scope)
- Multi-user from day one; **read-only** Google scopes.
- Tools for GA4 and Search Console (see §6).
- Works with any MCP client that supports remote servers + OAuth.
- Admin dashboard: list users, set plan (`internal` / `trial` / `paid` / `suspended`), set trial end, revoke connections, see usage, audit log.
- Per-user rate limits and daily quotas by plan.
- Email via Resend (domain `mail.johnedeh.com`) for invites/trial notices.

### Out of scope for MVP (later)
- Billing/checkout (Paddle/Lemon Squeezy/Stripe), write access to GA4/GSC, scheduled reports, in-chat UI widgets (Apps SDK), logo/branding polish, Google OAuth verification, ChatGPT Apps directory submission.

## 3. Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict), Node 24 | Verify installed versions at scaffold |
| Framework | Next.js (App Router) | One app hosts MCP, OAuth, admin, landing |
| MCP | Official `@modelcontextprotocol/sdk` (Streamable HTTP, stateless). `mcp-handler` from Vercel may be used as a thin adapter | Verify current API against installed package docs; do not rely on memory |
| DB | Postgres on **Neon** (Vercel Marketplace) | Free tier OK for MVP |
| ORM | Drizzle (`node-postgres` / `pg`) | Migrations in `drizzle/` |
| Validation | Zod 4 | All tool inputs, env, external responses |
| Google | `googleapis` / `@google-analytics/data` / `@google-analytics/admin` | Use the user's refresh token |
| Crypto | Node `crypto` AES-256-GCM, versioned keys | Tokens at rest |
| Email | Resend | Sender on `mail.johnedeh.com` (already verified) |
| Admin UI | Same Next.js app, shadcn/ui + Tailwind | Admin login = Google sign-in + `ADMIN_EMAILS` allowlist |
| Rate limiting | Postgres counters (no Redis for MVP) | Upstash later if needed |
| Observability | Vercel logs + `usage_events` table; Sentry free tier optional | No PII in logs |
| Tests | Vitest (unit), MCP Inspector (manual), Playwright optional | |
| DNS/proxy | Cloudflare | Subdomain of `johnedeh.com` |
| Hosting | **Vercel** now; Azure later (portable, see §12) | See §11 risk about Hobby tier |

## 4. Hosting and domains (proof-of-concept phase)

- App at **`insights.johnedeh.com`** (decided 2026-10-05; set in `PUBLIC_BASE_URL`). Google Cloud project is owned by `netojaycee@gmail.com` for the PoC.
- Cloudflare DNS → Vercel (DNS-only/grey cloud is simplest for Vercel; avoid proxy features that break SSE/streaming).
- Branded mailboxes via Zoho when needed (fallback: Cloudflare Email Routing). Transactional mail via Resend on `mail.johnedeh.com`.
- Google "authorized domain" = `johnedeh.com` (verify in Search Console).

## 5. Data model (Drizzle / Postgres)

| Table | Key columns |
|---|---|
| `users` | id, email, google_sub (unique), name, plan (`internal`\|`trial`\|`paid`\|`suspended`), trial_ends_at, notes, created_at, last_seen_at |
| `google_connections` | id, user_id, google_sub, google_email, refresh_token_enc, enc_key_version, scopes[], status (`active`\|`revoked`\|`error`), connected_at, last_refresh_at |
| `oauth_clients` | client_id, client_name, redirect_uris[], token_endpoint_auth_method, created_at (from DCR) |
| `oauth_auth_codes` | code_hash, client_id, user_id, redirect_uri, code_challenge(S256), resource, scope, expires_at, used_at |
| `oauth_tokens` | token_hash, kind (`access`\|`refresh`), client_id, user_id, resource, scope, expires_at, revoked_at, parent_id |
| `usage_events` | id, user_id, client_id, tool, ok, latency_ms, rows, created_at (no query contents beyond tool name + property id) |
| `rate_counters` | user_id, window_key, count |
| `audit_log` | id, actor, action, target, meta jsonb, created_at (admin actions, connects, revokes) |
| `admin_sessions` | session_hash, email, expires_at |

Rules: tokens and codes stored **hashed (SHA-256)**; Google refresh tokens **encrypted**; no raw analytics data persisted (optional short-TTL cache only).

## 6. MCP tools (all read-only)

Names are snake_case, prefixed by product area. Each has a precise description (LLMs choose tools from descriptions), Zod schema, row caps, and clear error messages.

**GA4**
- `ga4_list_properties`: accounts + properties the user can access (Admin API `accountSummaries`).
- `ga4_get_metadata`: available dimensions/metrics for a property.
- `ga4_run_report`: Data API `runReport` (dimensions, metrics, date ranges, filters, order, limit ≤ 10 000, default 100).
- `ga4_run_realtime_report`: `runRealtimeReport`.

**Search Console**
- `gsc_list_sites`
- `gsc_search_analytics`: queries/pages/countries/devices/dates, filters, row limit, pagination.
- `gsc_inspect_url`: URL Inspection API.
- `gsc_list_sitemaps`

**Account**
- `account_status`: plan, trial days left, daily quota remaining, connected Google email.

Open question: ChatGPT connectors/deep-research may expect `search` and `fetch` tools. Check current OpenAI docs at build time and add thin wrappers if required. Do not assume.

Every tool call goes through one wrapper: authenticate → resolve user → entitlement check (plan/trial/suspended) → rate/quota check → get Google access token (refresh if needed) → call → normalise errors → log `usage_events`.

## 7. Authentication details

Follow the **MCP authorization spec** and verify against the current spec revision at build time.

**Discovery**
- `GET /.well-known/oauth-protected-resource` (RFC 9728) → points to our authorization server.
- `GET /.well-known/oauth-authorization-server` (RFC 8414) → endpoints, `code_challenge_methods_supported: ["S256"]`, DCR endpoint.
- `/mcp` returns `401` + `WWW-Authenticate` with resource metadata URL when no/invalid token.

**Flow**
1. Client discovers metadata, registers via `POST /oauth/register` (DCR).
2. Client sends user to `/oauth/authorize` (PKCE S256 required, `resource` param bound to our `/mcp` URL).
3. If user has no session/Google connection, redirect to Google (scopes below), `access_type=offline`, `prompt=consent` on first connect. Callback exchanges code, upserts `users` + `google_connections`.
4. Show a minimal consent/confirm page ("<client name> wants to read your GA4 and Search Console data"), then issue our auth code → client exchanges at `/oauth/token` for our access token (short TTL, ~1h) + refresh token (rotating).
5. `/mcp` validates our token (hash lookup, audience = our resource URL, not expired/revoked).

**Google scopes (read-only only)**
- `https://www.googleapis.com/auth/analytics.readonly`
- `https://www.googleapis.com/auth/webmasters.readonly`
- plus `openid email profile` for identity.

**Security rules**
- Exact-match redirect URIs; reject non-https except loopback for dev clients.
- PKCE S256 mandatory. Single-use, short-lived auth codes. Refresh token rotation with reuse detection.
- **No token passthrough**: never accept or return Google tokens at `/mcp`. Audience-bind our tokens.
- `state` + CSRF protection on every redirect hop; per-client consent to avoid confused-deputy.
- Disconnect = revoke at Google + delete encrypted token + revoke our tokens.
- Google API Services "Limited Use": data only used to serve the user; never for ads, sale, or model training.
- Never log tokens, secrets or analytics payloads.

## 8. Plans, trials and admin

- `plan=internal`: unlimited-ish (high caps), set by admin only (your company team).
- `plan=trial`: new users default to a trial (`TRIAL_DAYS`, default 14) with moderate daily caps. Expiry enforced in the wrapper (tools return a friendly "trial ended" message).
- `plan=paid`: reserved for later billing.
- `plan=suspended`: all calls refused.
- Admin dashboard (`/admin`): users table (search, filter by plan), edit plan/trial end/notes, revoke connection, view usage and audit log, invite by email (Resend), global kill switch. Admin identity = Google sign-in where email ∈ `ADMIN_EMAILS`; separate cookie session; every admin write logged to `audit_log`.
- Plan limits live in one config (`src/config/plans.ts`) so pricing changes are data, not code.

## 9. Environment variables

```
PUBLIC_BASE_URL=            # https://ga.johnedeh.com
DATABASE_URL=               # Neon (pooled)
DATABASE_URL_UNPOOLED=      # Neon direct, used by migrations
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
TOKEN_ENC_KEYS=             # JSON {"1":"<base64 32 bytes>"}; current version in TOKEN_ENC_CURRENT
TOKEN_ENC_CURRENT=1
SESSION_SECRET=             # admin + connect session signing
ADMIN_EMAILS=               # comma list
RESEND_API_KEY=
MAIL_FROM=                  # e.g. "Name <hello@mail.johnedeh.com>"
BRAND_NAME=
TRIAL_DAYS=14
```
Secrets only in Vercel env / local `.env.local` (gitignored). `.env.example` is committed with empty values. Validate at boot with Zod.

## 10. Repo layout (target)

```
src/
  app/
    (site)/            landing, privacy, terms stubs, setup guides
    admin/             dashboard pages + server actions
    api/
      mcp/route.ts     MCP endpoint (also rewritten to /mcp)
      oauth/...        register, authorize, token, revoke
      connect/google/  start + callback
    .well-known/...    metadata routes
  server/
    mcp/               server factory, tool defs, wrapper
    google/            ga4.ts, gsc.ts, auth.ts (token refresh)
    oauth/             as logic: clients, codes, tokens, pkce
    db/                schema.ts, client.ts, queries
    security/          crypto.ts, hash.ts, csrf.ts, ratelimit.ts
    plans/             entitlements.ts
  config/              brand.ts, plans.ts, env.ts
drizzle/               migrations
docs/                  setup-google.md, clients.md (per-client connect steps), runbook.md
tests/
```

## 11. Risks and decisions to track

| Risk | Mitigation |
|---|---|
| Vercel **Hobby** is non-commercial; company use may violate terms | Fine for personal PoC; switch to Pro (~$20/mo) or Azure before company-wide use. Code stays portable (§12) |
| Google OAuth "unverified app" caps at 100 users and shows warning | OK for PoC. Submit verification once branded (~10 business days) |
| Testing-mode tokens expire in 7 days | Publish to "In production" (unverified) from the start, not Testing |
| GA4 API quotas per property/project | Cache short-TTL, per-user limits, helpful quota errors |
| Each AI client has different OAuth quirks/plan gating | Per-client test matrix in STATUS.md Phase 6; docs in `docs/clients.md` |
| Personal accounts own cloud resources | §12 migration checklist; keep a registry of every credential |
| Holding access to others' analytics | Read-only scopes, encryption, disconnect/delete, audit log |
| MCP / client specs evolve | Always check current docs at implementation; pin SDK versions |

## 12. Portability / moving to the real brand

Principle: **nothing brand-, account- or host-specific is hard-coded.**

- Brand strings, logo paths, support email, legal URLs → `src/config/brand.ts` (fed by env).
- Base URL, OAuth client, DB, keys, mail → env only.
- Host-agnostic: standard Next.js, no Vercel-only APIs beyond env/logging. Azure path = container (`Dockerfile`) or Azure Web Apps/Container Apps; keep a `Dockerfile` working from Phase 7.

**Switch checklist (to be turned into `docs/migration.md` in Phase 7):**
1. New domain on Cloudflare; add DNS; set `PUBLIC_BASE_URL`.
2. Create a Google Cloud project under the company/brand Workspace org; enable the 3 APIs; new OAuth consent screen with brand name/logo/legal URLs; new OAuth client with new redirect URI; update `GOOGLE_CLIENT_ID/SECRET`. **Changing the OAuth client forces every user to reconnect Google. Plan a cutover message.** (Alternatively transfer project ownership instead of recreating, if the org setup allows.)
3. New Resend domain + `MAIL_FROM`; Zoho/Cloudflare mailboxes.
4. Move Vercel project to the company team (or deploy to Azure); migrate Neon (dump/restore) and rotate `TOKEN_ENC_KEYS` (re-encrypt with the new version) and `SESSION_SECRET`.
5. Update `ADMIN_EMAILS`, brand config, privacy/terms, landing copy and logo.
6. Re-register in each AI client (new server URL) and update `docs/clients.md`.
7. Submit Google verification; then directory listings.
8. Remove personal credentials from every service; log the change in STATUS.md.

Keep `docs/credentials-registry.md` (names and locations only, never secret values) listing every account/service and who owns it.

## 13. Cost snapshot (PoC)

Domain on existing `johnedeh.com`: $0. Vercel Hobby + Neon free + Resend free + Cloudflare free + Google APIs free + Zoho free tier: **≈ $0/month**. Existing Claude Max / ChatGPT Plus cover client testing. First real spend is likely Vercel Pro or Azure when the whole company uses it.

## 14. As built (2026-10-06)

### Environments
| | Production | Development |
|---|---|---|
| Host | Vercel project `insights-mcp` (team `edeh-jaycees-projects`, Hobby), `https://insights.johnedeh.com` | `next dev` on localhost |
| Database | Neon project `insights-mcp-db`, branch `main` | Neon branch `dev` (schema only, never auto-deletes), URLs in `.env.development.local` |
| Google OAuth client | `insights-mcp-web` in Cloud project `insights-mcp-poc` (External, In production, unverified) with both redirect URIs | same client |
| Secrets | Vercel env (separate `TOKEN_ENC_KEYS`, `SESSION_SECRET` from dev) | `.env.local` + `.env.development.local` (gitignored) |

### Where the build differs from sections 1-13
- **Google APIs** are called with plain `fetch` + Zod (no `googleapis`, no `google-auth-library`); the Zod input schemas double as the MCP tool schemas. Zod is v4; Drizzle uses `node-postgres`.
- **Admin auth** reuses the first-party session cookie (`ga_session`) plus `ADMIN_EMAILS`; there is no separate admin login and the `admin_sessions` table is unused. Admin UI is plain Tailwind (no shadcn).
- **OAuth**: follows MCP authorization revision 2026-07-28 (RFC 9728/8414/7591/7636/8707/7009/9207). Dynamic Client Registration only (no Client ID Metadata Documents). Scope string `analytics:read`. Access token 1 h, refresh token 30 d with rotation and reuse detection, all opaque and stored as SHA-256 hashes, bound to the `/mcp` resource URL. Redirect URIs: https, loopback http, or the single exact allowlisted native URI `cursor://anysphere.cursor-mcp/oauth/callback`. Consent page warns that client names are self-declared. Public clients only, PKCE S256 mandatory.
- **MCP**: route `src/app/mcp/route.ts`, stateless Streamable HTTP, CORS `*` (bearer tokens only). Tools (all read-only, all through `runTool`): `account_status`, `ga4_list_properties`, `ga4_get_metadata`, `ga4_run_report`, `ga4_run_realtime_report`, `gsc_list_sites`, `gsc_search_analytics`, `gsc_inspect_url`, `gsc_list_sitemaps`. Tool text is prefixed with an untrusted-data note. No `search`/`fetch` shims (only needed for ChatGPT deep research). Dev-header auth stub needs `ALLOW_DEV_AUTH=1` and never works in production.
- **Plans and limits** (`src/config/plans.ts`): internal 5000/day, 60/min; trial 200/day, 20/min (14 days); paid 2000/day, 40/min; suspended 0. Row caps per call by plan. New users default to `trial`; an admin pre-approval (`plan_grants`) applied at first sign-in can give `internal`.
- **Sessions**: cookie `ga_session` is HMAC-signed, typed (`typ: "session"`), 30 days, checked against the database on every request (user must exist, `iat` must be after `users.auth_valid_after`, email is re-read from the DB). Admin revoke/suspend sets `auth_valid_after`. Sign-in state cookie is separately typed. `email_verified` must be true at sign-in.

### Data model additions (beyond section 5)
`anon_rate_counters` (hashed-IP buckets for anonymous throttles), `app_settings` (kill switch), `plan_grants` (pre-approvals), `deleted_accounts` (tombstone: sha256 of Google sub + plan + trial end, 12 months, so deleting data cannot reset a trial or lift a suspension), `users.auth_valid_after`. Migrations `drizzle/0000`-`0003`.

### Routes
Public: `/`, `/privacy`, `/terms`, `/account`, `/mcp`, `/.well-known/oauth-protected-resource[/mcp]`, `/.well-known/oauth-authorization-server`, `/oauth/{register,authorize,token,revoke}`. Sign-in: `/api/connect/google/{start,callback}`. Account: `/api/connect/account/{disconnect,delete}`, `/api/connect/logout`. Admin (all check `requireAdmin()`): `/admin`, `/admin/users/[id]`, `/admin/grants`, `/admin/usage`, `/admin/audit`, `/admin/invites`. Cron (Bearer `CRON_SECRET`): `/api/cron/trial-notices` (daily 09:00 UTC), `/api/cron/cleanup` (daily 03:00 UTC).

### Operations and safeguards
- Global kill switch in `/admin` (10 s cache; fails open if the lookup errors).
- Throttles: `/oauth/register` 10/h per hashed IP (+1000/day global, denied attempts not counted); `/mcp` bad-token requests 300/h per hashed IP; per-user tool limits above. Client IP: `x-real-ip` only on Vercel, otherwise the rightmost `x-forwarded-for` hop.
- Retention (`/api/cron/cleanup`): usage events 90 days, audit log 12 months, tombstones 12 months, expired tokens 30 days past expiry, unused OAuth clients after 7 days, old rate counters. Deleting a user also removes audit rows about them and pre-approvals for their email.
- Security headers on every response (nosniff, X-Frame-Options DENY, frame-ancestors none, HSTS); `/admin` is `no-store, noindex`; the OAuth consent page sends `Referrer-Policy: same-origin` (not `no-referrer`, which made browsers send `Origin: null` and broke Approve).

### Environment variables (as built)
`PUBLIC_BASE_URL`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENC_KEYS`, `TOKEN_ENC_CURRENT`, `SESSION_SECRET`, `ADMIN_EMAILS`, `RESEND_API_KEY`, `MAIL_FROM`, `SUPPORT_EMAIL`, `BRAND_NAME`, `TRIAL_DAYS`, `CRON_SECRET`, `ALLOW_DEV_AUTH` (dev only). Validated lazily by `src/config/env.ts`; quote-wrapped values are rejected by name.

### Known gaps (also tracked in STATUS.md)
Refresh-token rotation not yet exercised on production; only Claude tested live; a refresh-token replay within seconds revokes the whole grant and token-pair insertion is not transactional; `users.email` is not unique; Vercel Hobby is non-commercial; Docker image never built (no Docker on the dev machine); Google verification not submitted (unverified-app warning, 100-user cap).

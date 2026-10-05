# ARCHITECTURE

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

# STATUS

Single source of truth for work. Multiple agents may work in parallel; this file is how they stay in sync.
Read [ARCHITECTURE.md](ARCHITECTURE.md) and [CLAUDE.md](CLAUDE.md) first.

## How to use this file (protocol)

1. **Pick a task** whose status is `TODO`, whose `Deps` are all `DONE`, and which no one has claimed.
2. **Claim it** by editing its row: `Status=DOING`, `Owner=<agent-id>`, `Claimed=<UTC date-time>`. Do this *before* writing code. If the row already says `DOING`, pick another, unless the claim is older than 24h with no log entry (then note a takeover in the Log).
3. **Stay inside the task's `Files`** column where possible. If you must touch files owned by another `DOING` task, add a Log line and keep the change minimal.
4. When finished: `Status=DONE`, fill `Evidence` (test name, command output summary, or doc path). Never mark `DONE` without evidence.
5. If blocked: `Status=BLOCKED`, put the reason in `Notes`, and add a line to **Blockers**.
6. **Human-gated** tasks (`HUMAN` in Kind) need the owner to log in or approve (Google, Cloudflare, Vercel dashboards, payments). Agents may drive the browser via Claude in Chrome *only after the owner says go*, and must never type passwords or secrets the owner didn't supply.
7. Append to **Log** (newest on top) for every claim, completion, decision or surprise. Keep it to one line each.
8. Reconciling: if two agents edited this file at once, keep both sets of changes; the later agent merges. Do not delete other agents' log lines.
9. Decisions that change architecture go in **Decisions** and are mirrored into ARCHITECTURE.md in the same change.

Status values: `TODO` · `DOING` · `DONE` · `BLOCKED` · `DROPPED`
Kind: `HUMAN` (needs owner) · `CODE` · `DOC` · `TEST`

---

## Phase 0: Foundations and accounts

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 0.1 | `git init`, `.gitignore` (node, .env*, .next), first commit of the three docs | CODE | n/a | `.gitignore` | DONE | claude | 2026-10-06 | Commit `429d24e` pushed to `origin/main` (`netojaycee/ga4-ai-mcp`) | Vendor skills, `.claude/skills`, env files, `.vercel`, `note.txt` are gitignored; secret-pattern scan clean |
| 0.2 | Pick subdomain on `johnedeh.com` (e.g. `ga.`) and record in ARCHITECTURE §4 | HUMAN | n/a | `ARCHITECTURE.md` | DONE | owner+claude | 2026-10-05 | `insights.johnedeh.com` | Recorded in ARCHITECTURE §4 |
| 0.3 | Create Google Cloud project (personal account for PoC), enable Analytics Data API, Analytics Admin API, Search Console API | HUMAN | n/a | `docs/setup-google.md` | DONE | claude | 2026-10-06 | Project `insights-mcp-poc`; 3 APIs listed as enabled | Owner `netojaycee@gmail.com` |
| 0.4 | OAuth consent screen: External, app name, support email, authorized domain `johnedeh.com`, scopes (analytics.readonly, webmasters.readonly, openid email profile); **publish to In production** (no logo) | HUMAN | 0.3 | `docs/setup-google.md` | DONE | claude | 2026-10-06 | Audience page shows "In production"; Data Access saved | App name `Insights Connector (PoC)`. Homepage/privacy/terms URLs point to pages not built yet (task 7.2) |
| 0.5 | Create OAuth Web client; redirect URIs for local and deployed callback; store ID/secret in env only | HUMAN | 0.4 | `.env.local` | DONE | claude+owner | 2026-10-06 | Client `insights-mcp-web` in Clients list; `.env.local` has ID+secret (lengths checked, values never printed) | May take 5 min to hours to propagate. Secret can't be re-viewed: if lost, create a new client |
| 0.6 | Verify `johnedeh.com` ownership in Search Console (authorized domain) | HUMAN | 0.2 | `docs/setup-google.md` | DONE | claude | 2026-10-06 | Search Console showed "Ownership auto verified" for Domain property `johnedeh.com` (existing TXT record) | Verified under `netojaycee@gmail.com` |
| 0.7 | Create Vercel project (link repo/folder), Neon database via Marketplace, set env vars | HUMAN | 0.2 | `docs/setup-hosting.md` | DONE | claude | 2026-10-06 | Vercel project `insights-mcp` (personal team); Neon `insights-mcp-db` provisioned via integration; prod env synced | Prod secrets differ from local. Dev and prod currently share one Neon DB |
| 0.8 | Cloudflare DNS record for the subdomain → Vercel (DNS-only) | HUMAN | 0.7 | `docs/setup-hosting.md` | DONE | claude | 2026-10-06 | `curl https://insights.johnedeh.com` returns 200 with valid TLS | A record `insights` → 76.76.21.21, DNS only |
| 0.9 | Confirm Resend domain `mail.johnedeh.com` works; create API key | HUMAN | n/a | `.env.local` | DONE | owner+claude | 2026-10-06 | Resend Domains page: `mail.johnedeh.com` Verified; `RESEND_API_KEY` set locally and in Vercel prod (sensitive) | `MAIL_FROM=Insights Connector <hello@mail.johnedeh.com>`. No test email sent yet |
| 0.10 | Create `docs/credentials-registry.md` (names/locations/owners, no secrets) | DOC | n/a | `docs/credentials-registry.md` | TODO | | | | |

## Phase 1: Scaffold

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1.1 | Scaffold Next.js (App Router, TS strict, Tailwind, shadcn) **in this folder**; verify current versions | CODE | n/a | root | DONE | claude | 2026-10-06 | `tsc --noEmit` OK; `npm run build` OK | Next 16.3.8, React 19.2.8, Tailwind 4, App Router, src/. shadcn deferred to Phase 5. Package name `ga-mcp` |
| 1.2 | `src/config/env.ts` (Zod env validation), `.env.example` | CODE | 1.1 | `src/config/`, `.env.example` | DONE | claude | 2026-10-06 | `tests/config/env.test.ts` (4 tests); build passes with no env present | Lazy `env()`; errors list names, never values |
| 1.3 | `src/config/brand.ts` and `src/config/plans.ts` (single source of brand and limits) | CODE | 1.1 | `src/config/` | DONE | claude | 2026-10-06 | `src/config/brand.ts`, `plans.ts` typecheck | Plan limits are data; new users default to `trial` |
| 1.4 | Drizzle setup + schema from ARCHITECTURE §5 + first migration | CODE | 1.2 | `src/server/db/`, `drizzle/` | DONE | claude | 2026-10-06 | Migration `drizzle/0000_*.sql` applied; 9 tables verified in Neon `public` | Neon also has an unused `neon_auth` schema from the integration; ignore it |
| 1.5 | `security/crypto.ts` (AES-256-GCM, key versions), `hash.ts`, with unit tests | CODE+TEST | 1.1 | `src/server/security/` | DONE | claude | 2026-10-06 | `tests/security/{crypto,hash}.test.ts` (11 tests) pass | AES-256-GCM, version bound as AAD; includes PKCE S256 helper (RFC 7636 vector) |
| 1.6 | Vitest + lint + typecheck scripts; fill commands in CLAUDE.md | CODE | 1.1 | `package.json`, `CLAUDE.md` | DONE | claude | 2026-10-06 | lint, typecheck, test (15), build all pass | Commands recorded in CLAUDE.md |

## Phase 2: Google data layer

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2.1 | `google/auth.ts`: build OAuth client from stored refresh token, refresh, handle `invalid_grant` (mark connection `error`) | CODE | 1.4, 1.5 | `src/server/google/auth.ts` | DONE | agent-A |2026-10-05 23:55Z | `tests/google/*` pass (71 tests); lint, typecheck, build pass | Plain fetch, no google-auth-library; deps injectable |
| 2.2 | `google/ga4.ts`: listProperties, getMetadata, runReport, runRealtimeReport; Zod-typed inputs, row caps | CODE | 2.1 | `src/server/google/ga4.ts` | DONE | agent-A |2026-10-05 23:55Z | `tests/google/*` pass (71 tests); lint, typecheck, build pass | Plain fetch, no google-auth-library; deps injectable |
| 2.3 | `google/gsc.ts`: listSites, searchAnalytics (paging), inspectUrl, listSitemaps | CODE | 2.1 | `src/server/google/gsc.ts` | DONE | agent-A |2026-10-05 23:55Z | `tests/google/*` pass (71 tests); lint, typecheck, build pass | Plain fetch, no google-auth-library; deps injectable |
| 2.4 | Normalised error mapping (quota, permission, not found, auth) into LLM-friendly messages | CODE | 2.2, 2.3 | `src/server/google/errors.ts` | DONE | agent-A |2026-10-05 23:55Z | `tests/google/*` pass (71 tests); lint, typecheck, build pass | Plain fetch, no google-auth-library; deps injectable |
| 2.5 | Unit tests with mocked Google responses | TEST | 2.2, 2.3 | `tests/google/` | DONE | agent-A |2026-10-05 23:55Z | `tests/google/*` pass (71 tests); lint, typecheck, build pass | Plain fetch, no google-auth-library; deps injectable |

## Phase 3: MCP server

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 3.1 | MCP endpoint `/mcp` (Streamable HTTP, stateless) with a stub auth that resolves a dev user | CODE | 1.1 | `src/app/api/mcp/`, `src/server/mcp/` | DONE | agent-B | 2026-10-06 | `/mcp` handler `src/app/mcp/route.ts`; live smoke test: initialize OK, tools/list returns 9 read-only tools, 401 + WWW-Authenticate without auth | Stub auth replaced by real validation via task 4.7 (stub still works outside production only) |
| 3.2 | Tool wrapper: auth → entitlement → rate/quota → Google token → call → error map → usage log | CODE | 3.1, 2.4 | `src/server/mcp/wrapper.ts` | DONE | agent-B |2026-10-05 23:55 UTC | `server/mcp/wrapper.ts`, `tools/account.ts`; `tests/mcp/wrapper.test.ts` (8 tests) | |
| 3.3 | Register all tools from ARCHITECTURE §6 with precise descriptions and schemas | CODE | 3.2 | `src/server/mcp/tools/` | DONE | claude | 2026-10-06 | `src/server/mcp/tools/google.ts` registers 8 GA4/GSC tools; `tests/mcp/integration.test.ts`; live tools/list shows all 9 | All tools read-only and run through `runTool`. Not yet exercised with real Google data (needs a connected account, see 3.6) |
| 3.4 | `plans/entitlements.ts` + Postgres rate counters and daily quotas | CODE | 1.3, 1.4 | `src/server/plans/`, `src/server/security/ratelimit.ts` | DONE | agent-B |2026-10-05 23:55 UTC | `tests/plans/{entitlements,ratelimit}.test.ts`; full suite 46 tests, lint/typecheck/build pass | |
| 3.5 | Decide and implement `search`/`fetch` shims if ChatGPT requires them | CODE | 3.3 | `src/server/mcp/tools/` | TODO | | | | Check OpenAI docs first |
| 3.6 | Test with MCP Inspector against local server | TEST | 3.3 | `docs/clients.md` | TODO | | | | |

## Phase 4: OAuth for MCP clients + Google connect

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 4.1 | Discovery: protected-resource and authorization-server metadata; `/mcp` 401 + `WWW-Authenticate` | CODE | 3.1 | `src/app/.well-known/`, `src/server/oauth/` | DONE | agent-C | 2026-10-06T00:00Z | build lists both /.well-known routes; tests/oauth/register-metadata.test.ts | Verify against current MCP auth spec |
| 4.2 | Dynamic Client Registration `/oauth/register` | CODE | 1.4 | `src/app/api/oauth/register/` | DONE | agent-C | 2026-10-06T00:00Z | tests/oauth/register-metadata.test.ts (redirect/size/method validation) | |
| 4.3 | `/oauth/authorize` with PKCE S256, `resource` binding, redirect-URI exact match | CODE | 4.2 | `src/app/api/oauth/authorize/` | DONE | agent-C | 2026-10-06T00:00Z | tests/oauth/authorize.test.ts | |
| 4.4 | Google connect flow `/connect/google/start` + callback: upsert user, store encrypted refresh token, CSRF/state | CODE | 1.5, 0.5 | `src/app/api/connect/google/` | DONE | agent-D | 2026-10-05 23:56 UTC | `tests/connect/{flow,returnTo,session}.test.ts`: state/CSRF, return_to, scopes, refresh token, access_denied, trial calc, upsert; lint/typecheck/test(61)/build pass | Own fetch-based Google client (no google-auth-library); ID token iss/aud/exp checked, signature not verified because it comes direct from the token endpoint. Not exercised against real Google |
| 4.5 | Consent/confirm page for the AI client | CODE | 4.3, 4.4 | `src/app/(site)/consent/` | DONE | agent-C | 2026-10-06T00:00Z | tests/oauth/authorize.test.ts (consent page, CSRF, escaping, headers) | |
| 4.6 | `/oauth/token`: code exchange, our access + rotating refresh tokens, reuse detection; `/oauth/revoke` | CODE | 4.3 | `src/app/api/oauth/token/` | DONE | agent-C | 2026-10-06T00:00Z | tests/oauth/token.test.ts (PKCE, replay, rotation, reuse, revoke) | |
| 4.7 | Replace stub auth in `/mcp` with real token validation (hash, audience, expiry, revoked) | CODE | 4.6, 3.2 | `src/server/mcp/auth.ts` | DONE | agent-C+claude | 2026-10-06 | `authenticateBearer` wired into `/mcp` via `src/server/mcp/auth.ts`; `tests/mcp/auth.test.ts` covers composition and production guard | Dev header fallback works only when NODE_ENV is not production |
| 4.8 | Disconnect flow: revoke at Google, delete token, revoke our tokens, delete data on request | CODE | 4.4 | `src/server/google/`, `src/app/(site)/account/` | DONE | agent-D | 2026-10-05 23:56 UTC | `tests/connect/account.test.ts`: disconnect revokes at Google + oauth_tokens + audit, delete cascades, CSRF/origin rejects | Page `/account` (`src/app/account/`), POST `/api/connect/account/{disconnect,delete}`. Connection row is deleted on disconnect |
| 4.9 | Security tests: PKCE failures, code reuse, redirect mismatch, audience mismatch, token confusion | TEST | 4.7 | `tests/oauth/` | DOING | agent-C | 2026-10-06T00:00Z | tests/oauth/** (65 tests total pass); oauth part only | |

## Phase 5: Admin dashboard, plans, trials

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 5.1 | Admin auth (Google sign-in + `ADMIN_EMAILS`, separate session, CSRF) | CODE | 4.4 | `src/app/admin/`, `src/server/security/` | DONE | agent-E | 2026-10-06 | `src/server/admin/guard.ts` + `src/app/admin/layout.tsx`; `tests/admin/guard.test.ts` (logged out, non-admin 404, case-insensitive); lint/typecheck/test(253)/build pass | |
| 5.2 | Users table: search, filter by plan, edit plan / trial end / notes | CODE | 5.1 | `src/app/admin/users/` | DONE | agent-E | 2026-10-06 | `/admin`, `/admin/users/[id]`; `tests/admin/users.test.ts` (validation, audit rows, list param/LIKE building) | |
| 5.3 | Revoke a user's connection and sessions; suspend user; global kill switch | CODE | 5.2 | `src/app/admin/` | DONE | agent-E | 2026-10-06 | Revoke/disconnect/suspend on user page, kill switch on `/admin`, `app_settings` + migration `0002_*` (not applied); `tests/admin/{users,killswitch}.test.ts` incl. wrapper on/off/fail-open | |
| 5.4 | Usage view (calls per user/tool, errors) and audit log view | CODE | 5.2 | `src/app/admin/usage/` | TODO | | | | |
| 5.5 | Invite by email via Resend; trial-ending notice job (Vercel Cron) | CODE | 0.9, 5.2 | `src/server/mail/`, `src/app/api/cron/` | TODO | | | | |
| 5.6 | Default new users to `trial` with `TRIAL_DAYS`; internal-team bulk grant action | CODE | 5.2 | `src/server/plans/` | DONE | agent-E | 2026-10-06 | `/admin/grants`, `plan_grants` table, grant applied in connect flow; `tests/admin/grants.test.ts` (existing user, first sign-in, invalid, >200, duplicate) | |

## Phase 6: Client compatibility matrix

Record result per client: connected? OAuth ok? tools listed? sample call ok? quirks.

| ID | Client | Kind | Deps | Status | Owner | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| 6.1 | ChatGPT (Plus, Developer Mode custom connector) | HUMAN+TEST | 4.7 | TODO | | | |
| 6.2 | Claude (web/desktop custom connector, Max) | HUMAN+TEST | 4.7 | DONE | claude+owner | Real chat on claude.ai used the connector: DCR, consent, token, tools/list, list properties + 2 GA4 reports; answer had real data (2,149,398 sessions last 7d for Punch Newspapers - GA4) | Per-tool permission prompts are Claude's. See `docs/clients.md` |
| 6.3 | Claude Code (`claude mcp add --transport http`) | TEST | 4.7 | TODO | | | |
| 6.4 | Cursor | TEST | 4.7 | TODO | | | |
| 6.5 | VS Code (Copilot agent mode) | TEST | 4.7 | TODO | | | |
| 6.6 | Windsurf / Gemini CLI / others (best effort) | TEST | 4.7 | TODO | | | |
| 6.7 | Write `docs/clients.md`: per-client connect steps and known quirks | DOC | 6.1-6.6 | DOING | | | |

## Phase 7: Hardening and docs

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 7.1 | Security review pass (secrets, logs, headers, CSRF, rate limits, SSRF none, dependency audit) | TEST | P4, P5 | n/a | TODO | | | | |
| 7.2 | Landing page + privacy/terms **stubs** + setup guide (lawyer owns final text) | CODE | 1.3 | `src/app/(site)/` | DONE | claude | 2026-10-06 | `/`, `/privacy`, `/terms` render (200) locally and in build; production check after deploy | Content reflects actual data handling (no analytics stored, encrypted refresh token, Limited Use). **Owner's lawyer must review wording before launch.** Uses optional `SUPPORT_EMAIL` env |
| 7.3 | Working `Dockerfile` (Azure portability) and verify build runs outside Vercel | CODE | P5 | `Dockerfile` | TODO | | | | |
| 7.4 | `docs/migration.md` from ARCHITECTURE §12 checklist, `docs/runbook.md` (incidents, key rotation, revoke-all) | DOC | n/a | `docs/` | TODO | | | | |
| 7.5 | Deploy to Vercel production URL; end-to-end smoke test from ChatGPT and Claude | TEST | P6 | n/a | TODO | | | | |

## Phase 8: Pre-launch (later, mostly non-technical)

| ID | Task | Kind | Status | Notes |
|---|---|---|---|---|
| 8.1 | Product name, logo, brand domain, Workspace/Zoho mailboxes | HUMAN | TODO | Follow migration.md |
| 8.2 | Google OAuth verification submission (demo video, policy URLs) | HUMAN | TODO | ~10 business days |
| 8.3 | Billing integration (merchant of record vs Stripe) | CODE | TODO | Plans already data-driven |
| 8.4 | Directory listings: ChatGPT Apps, Claude, others | HUMAN | TODO | |
| 8.5 | Move off personal accounts per migration checklist | HUMAN | TODO | |

---

## Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10-05 | Any-AI from day one; one hosted MCP server, standard OAuth 2.1 + DCR | MCP is client-agnostic |
| 2026-10-05 | Read-only Google scopes only | Smaller trust surface, easier verification |
| 2026-10-05 | Publish consent screen "In production" (unverified, no logo) for PoC | Avoid 7-day token expiry in Testing mode; free |
| 2026-10-05 | PoC on owner's personal accounts + `johnedeh.com` subdomain; everything brand-specific via config/env | Cheap now, migratable later (ARCHITECTURE §12) |
| 2026-10-05 | Postgres counters for rate limits; no Redis | Fewer moving parts |
| 2026-10-05 | Admin dashboard in same Next.js app; manual plan management | Owner grants internal team free access |

| 2026-10-05 | PoC base URL `https://insights.johnedeh.com`; Google Cloud project owned by `netojaycee@gmail.com` | Owner choice |
| 2026-10-06 | Google data layer uses plain `fetch` (token refresh + REST) with Zod-parsed responses; no `google-auth-library`/`googleapis` | Smaller bundle, trivial mocking, no extra deps. Access tokens cached in process memory only (until expiry minus 60s) |
| 2026-10-06 | Google APIs called with plain `fetch` (no `googleapis`/`google-auth-library`); Zod input schemas double as MCP tool schemas | Smaller install, trivial to mock (agent A) |
| 2026-10-06 | OAuth server follows MCP authorization revision 2026-07-28; Dynamic Client Registration only (no Client ID Metadata Documents yet) | Works with ChatGPT/Claude today; revisit if clients prefer CIMD (agent C) |
| 2026-10-06 | MCP endpoint at `/mcp` via `src/app/mcp/route.ts`; stateless Streamable HTTP; CORS `*` (bearer-only, no cookies) | Agent B |
| 2026-10-06 | Google ID token: issuer/audience/expiry checked, signature not (received directly from Google's token endpoint over TLS) | Agent D; consider adding signature check (cheap) |
| 2026-10-06 | Disconnect deletes the `google_connections` row; "Delete my data" cascades the user | Matches "delete encrypted token" in ARCHITECTURE §7 |
| 2026-10-06 | Integration branch merges agent worktree branches; STATUS.md log conflicts resolved by keeping both sides; table rows reconciled by hand | Parallel agents editing one file duplicates rows; the integrator must reconcile |

## Blockers

_None yet._

## Follow-ups (from the Phase 2-4 review)

- [x] **Rate-limit `POST /oauth/register`**: 10/hour per hashed IP + 300/day global, DB-backed (`anon_rate_counters`). Verified live: 10 x 201 then 429 with Retry-After.
- [x] Index on `oauth_tokens.parent_hash` (migration 0001).
- [ ] Decide whether to allow private-use redirect schemes (e.g. `cursor://`) in DCR; Cursor may need them (task 6.4).
- [ ] Verify the Google ID token signature (JWKS) in the connect callback.
- [x] Smoke-tested real Google calls on production with the owner's account: token refresh, GA4 (list, metadata, report, realtime, paging, bad-field error), Search Console (sites, analytics, sitemaps, URL inspection, no-access error). All correct.
- [x] Postgres paths exercised live on Neon: rate limiter (trial 20/min hit and reported), entitlement/user lookup, usage events, Drizzle upserts via real Google sign-in, bearer-token lookup. Still untested live: refresh-token rotation and code exchange (need a real OAuth client, task 6.x).
- [ ] Task 4.9 remains DOING: MCP-side token-confusion tests (e.g. an access token for another resource is rejected at `/mcp`).
- [ ] Periodically delete OAuth clients with no tokens and older than N days (each Claude Connect click registers a new client).
- [ ] Separate dev and prod databases (Neon branch) before real users.
- [x] Merged to `main` with owner OK (production deploy).

## Log (newest first)

- 2026-10-06: agent-E finished 5.1, 5.2, 5.3, 5.6. Owner must apply migration `drizzle/0002_*` (app_settings, plan_grants) before the kill switch or grants work; wrapper fails open until then. Added no-store/noindex headers in `next.config.ts`; `disconnectUser` in connect/account.ts gained optional actor and returns its result.
- 2026-10-06: agent-E claimed 5.1, 5.2, 5.3, 5.6 (admin core: guard, users, kill switch, team grants).

- 2026-10-06: **Claude end-to-end verified.** Connector added in claude.ai (auto-detected OAuth + DCR), Approve (after the Origin fix) issued 1 used auth code + access (1h) and refresh (30d) tokens bound to our `/mcp`; a real chat made 3 tool calls and answered with live GA4 data. Wrote `docs/clients.md` (Claude verified; others TODO). Claude registers a new OAuth client on every Connect click, so unused client rows accumulate (see follow-ups).
- 2026-10-06: **Bug found by the first real client (Claude)**: clicking Approve on the consent page failed with "Cross-origin request rejected." Cause: consent page sent `Referrer-Policy: no-referrer`, so browsers send `Origin: null` on the form POST and our Origin check rejected it. Unit tests used fake requests and could not catch browser behaviour. Fix: policy `same-origin`; Origin check also accepts `null` only with `Sec-Fetch-Site: same-origin` (CSRF cookie check unchanged). Regression tests added. Lesson: real-browser/client tests are required for the OAuth flow (task 6.x).
- 2026-10-06: **First end-to-end proof on production.** Owner signed in at /account (user + active connection created, trial to 2026-10-20). A 10-minute test bearer token was inserted directly in the DB for the owner's user (bypassing the OAuth handshake, deleted after each run) and all 8 Google tools + account_status were run against `https://insights.johnedeh.com/mcp` with real data. Findings: all correct; trial per-minute limit (20) triggered and reported friendly. Not yet proven: the real OAuth handshake from an AI client (Claude/ChatGPT) incl. DCR -> authorize -> token -> refresh.
- 2026-10-06: **Bug found in production smoke test**: Vercel `env pull` re-wrapped `.env.local` values in quotes and I copied `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` to prod with literal quotes (Google URL showed `client_id=%22...%22`). Re-set both unquoted; `parseEnv` now rejects quote-wrapped values (named, not printed) with tests. Added landing, privacy and terms pages (task 7.2) because the Google consent screen links to them and they 404'd. New optional env `SUPPORT_EMAIL`.
- 2026-10-06: Added registration throttle (`src/server/security/anon-ratelimit.ts`, table `anon_rate_counters`, migration 0001 applied to Neon, also adds `oauth_tokens_parent_idx`). 207 tests pass. Live test against dev server: 12 requests -> 10x201, 2x429; test rows and counters deleted. Merging integration branch to `main`.
- 2026-10-06: **Integration** of agents A, B, C, D on branch `integration-phase-2-4`: merged cleanly except STATUS.md; reconciled duplicated Phase 4 rows. Added task 3.3 (8 Google tools) and wired real OAuth auth into `/mcp` (4.7). Fixed `typecheck` script (`next typegen` first) and ESLint ignores for `.claude/` worktrees. 202 tests pass; lint, typecheck, build clean. Live smoke test against real Neon: discovery, DCR (valid + hostile redirect URIs rejected), 401 + WWW-Authenticate, MCP initialize/tools/list (9 read-only tools), logged-out authorize redirect to Google start, Google authorize URL params, open-redirect sanitization. Test client row deleted afterwards.
- 2026-10-06: agent-A finished 2.1 to 2.5 (src/server/google/*, tests/google/*). Not wired into MCP yet (Phase 3).
- agent-B: 3.1/3.2/3.4 DONE. Route is `src/app/mcp/route.ts` (not api/mcp); swap auth by editing `authenticateMcp` in `src/server/mcp/auth.ts`; add tools in `src/server/mcp/tools/index.ts` via `defineTool`. Decision: trial with null `trialEndsAt` is open-ended; daily and per-minute overages both return `rate_limited`. `npm run typecheck` needs a prior `next build`/typegen for `LayoutProps`.

- 2026-10-05 23:55 UTC: agent-B claimed 3.1, 3.2, 3.4 (MCP endpoint, wrapper, entitlements, rate limiting).

- 2026-10-06: agent-C done 4.1-4.3, 4.5-4.7 and oauth tests (4.9 left DOING for MCP-side tests after wiring). Gaps: no registration rate limit; custom-scheme redirect URIs rejected per brief; CIMD not implemented (DCR only).
- 2026-10-06: agent-C claimed 4.1, 4.2, 4.3, 4.5, 4.6, 4.7, 4.9 (oauth part). Following MCP authorization spec revision 2026-07-28 (RFC 9728/8414/7591/7636/8707/9207/7009).
- 2026-10-06: agent-D finished 4.4 and 4.8. session.ts is now real (cookie `ga_session`; added createSessionCookie, clearSessionCookie, getSessionUserFromCookieHeader, csrfTokenFor, verifyCsrf). Decision: no google-auth-library dependency.
- 2026-10-05 23:56 UTC: agent-D claimed 4.4 and 4.8 (Google connect flow, first-party session, account page/disconnect).
- 2026-10-06: Phase 1 done (1.2 to 1.6) on branch `phase-1-foundations`. New deps: zod 4, drizzle-orm 0.45, pg 8, vitest 5, drizzle-kit, tsx; `@types/node` bumped to ^24 (vitest 5 needs it). Migration applied to the shared Neon DB. Unpooled URL var is `DATABASE_URL_UNPOOLED`.
- 2026-10-06: Tasks 0.1, 0.6, 0.9 done. `ADMIN_EMAILS=netojaycee@gmail.com` set locally and in Vercel prod. GitHub repo `netojaycee/ga4-ai-mcp` created by owner, pushed, and connected to Vercel project (`vercel git connect`) so pushes to `main` deploy to production. Phase 0 complete.
- 2026-10-06: Tasks 0.7, 0.8, 1.1 done. Placeholder deployed to production (first and only deploy so far). Vercel Neon integration auto-installed vendor skills in `.agents/skills/` and `skills-lock.json`; guard added in CLAUDE.md. Task 0.6 done. Pending owner items: 0.9 (Resend: browser is not logged in; owner must log in and create the API key), `ADMIN_EMAILS` value, and removing `note.txt`.
- 2026-10-06: Tasks 0.3, 0.4, 0.5 done via Chrome (owner logged in). Owner approved accepting Google API Services User Data Policy. Note: Google console screenshot briefly displayed the client secret during creation; owner copied it to `.env.local`. Consider rotating the secret before any public launch.
- 2026-10-06: Redirect URIs registered: `https://insights.johnedeh.com/api/connect/google/callback` and `http://localhost:3000/api/connect/google/callback`. Scaffold must use exactly this callback path.
- 2026-10-05: Architecture, status and CLAUDE.md created. Nothing built yet. Next: Phase 0 (human-gated) and Phase 1 scaffold can start in parallel.

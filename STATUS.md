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
| 0.1 | `git init`, `.gitignore` (node, .env*, .next), first commit of the three docs | CODE | n/a | `.gitignore` | TODO | | | | Commit only when owner asks |
| 0.2 | Pick subdomain on `johnedeh.com` (e.g. `ga.`) and record in ARCHITECTURE §4 | HUMAN | n/a | `ARCHITECTURE.md` | DONE | owner+claude | 2026-10-05 | `insights.johnedeh.com` | Recorded in ARCHITECTURE §4 |
| 0.3 | Create Google Cloud project (personal account for PoC), enable Analytics Data API, Analytics Admin API, Search Console API | HUMAN | n/a | `docs/setup-google.md` | DONE | claude | 2026-10-06 | Project `insights-mcp-poc`; 3 APIs listed as enabled | Owner `netojaycee@gmail.com` |
| 0.4 | OAuth consent screen: External, app name, support email, authorized domain `johnedeh.com`, scopes (analytics.readonly, webmasters.readonly, openid email profile); **publish to In production** (no logo) | HUMAN | 0.3 | `docs/setup-google.md` | DONE | claude | 2026-10-06 | Audience page shows "In production"; Data Access saved | App name `Insights Connector (PoC)`. Homepage/privacy/terms URLs point to pages not built yet (task 7.2) |
| 0.5 | Create OAuth Web client; redirect URIs for local and deployed callback; store ID/secret in env only | HUMAN | 0.4 | `.env.local` | DONE | claude+owner | 2026-10-06 | Client `insights-mcp-web` in Clients list; `.env.local` has ID+secret (lengths checked, values never printed) | May take 5 min to hours to propagate. Secret can't be re-viewed: if lost, create a new client |
| 0.6 | Verify `johnedeh.com` ownership in Search Console (authorized domain) | HUMAN | 0.2 | `docs/setup-google.md` | DONE | claude | 2026-10-06 | Search Console showed "Ownership auto verified" for Domain property `johnedeh.com` (existing TXT record) | Verified under `netojaycee@gmail.com` |
| 0.7 | Create Vercel project (link repo/folder), Neon database via Marketplace, set env vars | HUMAN | 0.2 | `docs/setup-hosting.md` | DONE | claude | 2026-10-06 | Vercel project `insights-mcp` (personal team); Neon `insights-mcp-db` provisioned via integration; prod env synced | Prod secrets differ from local. Dev and prod currently share one Neon DB |
| 0.8 | Cloudflare DNS record for the subdomain → Vercel (DNS-only) | HUMAN | 0.7 | `docs/setup-hosting.md` | DONE | claude | 2026-10-06 | `curl https://insights.johnedeh.com` returns 200 with valid TLS | A record `insights` → 76.76.21.21, DNS only |
| 0.9 | Confirm Resend domain `mail.johnedeh.com` works; create API key | HUMAN | n/a | `.env.local` | TODO | | | | |
| 0.10 | Create `docs/credentials-registry.md` (names/locations/owners, no secrets) | DOC | n/a | `docs/credentials-registry.md` | TODO | | | | |

## Phase 1: Scaffold

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1.1 | Scaffold Next.js (App Router, TS strict, Tailwind, shadcn) **in this folder**; verify current versions | CODE | n/a | root | DONE | claude | 2026-10-06 | `tsc --noEmit` OK; `npm run build` OK | Next 16.3.8, React 19.2.8, Tailwind 4, App Router, src/. shadcn deferred to Phase 5. Package name `ga-mcp` |
| 1.2 | `src/config/env.ts` (Zod env validation), `.env.example` | CODE | 1.1 | `src/config/`, `.env.example` | TODO | | | | |
| 1.3 | `src/config/brand.ts` and `src/config/plans.ts` (single source of brand and limits) | CODE | 1.1 | `src/config/` | TODO | | | | |
| 1.4 | Drizzle setup + schema from ARCHITECTURE §5 + first migration | CODE | 1.2 | `src/server/db/`, `drizzle/` | TODO | | | | |
| 1.5 | `security/crypto.ts` (AES-256-GCM, key versions), `hash.ts`, with unit tests | CODE+TEST | 1.1 | `src/server/security/` | TODO | | | | |
| 1.6 | Vitest + lint + typecheck scripts; fill commands in CLAUDE.md | CODE | 1.1 | `package.json`, `CLAUDE.md` | TODO | | | | |

## Phase 2: Google data layer

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2.1 | `google/auth.ts`: build OAuth client from stored refresh token, refresh, handle `invalid_grant` (mark connection `error`) | CODE | 1.4, 1.5 | `src/server/google/auth.ts` | TODO | | | | |
| 2.2 | `google/ga4.ts`: listProperties, getMetadata, runReport, runRealtimeReport; Zod-typed inputs, row caps | CODE | 2.1 | `src/server/google/ga4.ts` | TODO | | | | |
| 2.3 | `google/gsc.ts`: listSites, searchAnalytics (paging), inspectUrl, listSitemaps | CODE | 2.1 | `src/server/google/gsc.ts` | TODO | | | | |
| 2.4 | Normalised error mapping (quota, permission, not found, auth) into LLM-friendly messages | CODE | 2.2, 2.3 | `src/server/google/errors.ts` | TODO | | | | |
| 2.5 | Unit tests with mocked Google responses | TEST | 2.2, 2.3 | `tests/google/` | TODO | | | | |

## Phase 3: MCP server

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 3.1 | MCP endpoint `/mcp` (Streamable HTTP, stateless) with a stub auth that resolves a dev user | CODE | 1.1 | `src/app/api/mcp/`, `src/server/mcp/` | TODO | | | | Verify SDK API in installed docs |
| 3.2 | Tool wrapper: auth → entitlement → rate/quota → Google token → call → error map → usage log | CODE | 3.1, 2.4 | `src/server/mcp/wrapper.ts` | TODO | | | | |
| 3.3 | Register all tools from ARCHITECTURE §6 with precise descriptions and schemas | CODE | 3.2 | `src/server/mcp/tools/` | TODO | | | | |
| 3.4 | `plans/entitlements.ts` + Postgres rate counters and daily quotas | CODE | 1.3, 1.4 | `src/server/plans/`, `src/server/security/ratelimit.ts` | TODO | | | | |
| 3.5 | Decide and implement `search`/`fetch` shims if ChatGPT requires them | CODE | 3.3 | `src/server/mcp/tools/` | TODO | | | | Check OpenAI docs first |
| 3.6 | Test with MCP Inspector against local server | TEST | 3.3 | `docs/clients.md` | TODO | | | | |

## Phase 4: OAuth for MCP clients + Google connect

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 4.1 | Discovery: protected-resource and authorization-server metadata; `/mcp` 401 + `WWW-Authenticate` | CODE | 3.1 | `src/app/.well-known/`, `src/server/oauth/` | TODO | | | | Verify against current MCP auth spec |
| 4.2 | Dynamic Client Registration `/oauth/register` | CODE | 1.4 | `src/app/api/oauth/register/` | TODO | | | | |
| 4.3 | `/oauth/authorize` with PKCE S256, `resource` binding, redirect-URI exact match | CODE | 4.2 | `src/app/api/oauth/authorize/` | TODO | | | | |
| 4.4 | Google connect flow `/connect/google/start` + callback: upsert user, store encrypted refresh token, CSRF/state | CODE | 1.5, 0.5 | `src/app/api/connect/google/` | TODO | | | | |
| 4.5 | Consent/confirm page for the AI client | CODE | 4.3, 4.4 | `src/app/(site)/consent/` | TODO | | | | |
| 4.6 | `/oauth/token`: code exchange, our access + rotating refresh tokens, reuse detection; `/oauth/revoke` | CODE | 4.3 | `src/app/api/oauth/token/` | TODO | | | | |
| 4.7 | Replace stub auth in `/mcp` with real token validation (hash, audience, expiry, revoked) | CODE | 4.6, 3.2 | `src/server/mcp/auth.ts` | TODO | | | | |
| 4.8 | Disconnect flow: revoke at Google, delete token, revoke our tokens, delete data on request | CODE | 4.4 | `src/server/google/`, `src/app/(site)/account/` | TODO | | | | |
| 4.9 | Security tests: PKCE failures, code reuse, redirect mismatch, audience mismatch, token confusion | TEST | 4.7 | `tests/oauth/` | TODO | | | | |

## Phase 5: Admin dashboard, plans, trials

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 5.1 | Admin auth (Google sign-in + `ADMIN_EMAILS`, separate session, CSRF) | CODE | 4.4 | `src/app/admin/`, `src/server/security/` | TODO | | | | |
| 5.2 | Users table: search, filter by plan, edit plan / trial end / notes | CODE | 5.1 | `src/app/admin/users/` | TODO | | | | |
| 5.3 | Revoke a user's connection and sessions; suspend user; global kill switch | CODE | 5.2 | `src/app/admin/` | TODO | | | | |
| 5.4 | Usage view (calls per user/tool, errors) and audit log view | CODE | 5.2 | `src/app/admin/usage/` | TODO | | | | |
| 5.5 | Invite by email via Resend; trial-ending notice job (Vercel Cron) | CODE | 0.9, 5.2 | `src/server/mail/`, `src/app/api/cron/` | TODO | | | | |
| 5.6 | Default new users to `trial` with `TRIAL_DAYS`; internal-team bulk grant action | CODE | 5.2 | `src/server/plans/` | TODO | | | | |

## Phase 6: Client compatibility matrix

Record result per client: connected? OAuth ok? tools listed? sample call ok? quirks.

| ID | Client | Kind | Deps | Status | Owner | Evidence | Notes |
|---|---|---|---|---|---|---|---|
| 6.1 | ChatGPT (Plus, Developer Mode custom connector) | HUMAN+TEST | 4.7 | TODO | | | |
| 6.2 | Claude (web/desktop custom connector, Max) | HUMAN+TEST | 4.7 | TODO | | | |
| 6.3 | Claude Code (`claude mcp add --transport http`) | TEST | 4.7 | TODO | | | |
| 6.4 | Cursor | TEST | 4.7 | TODO | | | |
| 6.5 | VS Code (Copilot agent mode) | TEST | 4.7 | TODO | | | |
| 6.6 | Windsurf / Gemini CLI / others (best effort) | TEST | 4.7 | TODO | | | |
| 6.7 | Write `docs/clients.md`: per-client connect steps and known quirks | DOC | 6.1-6.6 | TODO | | | |

## Phase 7: Hardening and docs

| ID | Task | Kind | Deps | Files | Status | Owner | Claimed | Evidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 7.1 | Security review pass (secrets, logs, headers, CSRF, rate limits, SSRF none, dependency audit) | TEST | P4, P5 | n/a | TODO | | | | |
| 7.2 | Landing page + privacy/terms **stubs** + setup guide (lawyer owns final text) | CODE | 1.3 | `src/app/(site)/` | TODO | | | | |
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

## Blockers

_None yet._

## Log (newest first)

- 2026-10-06: Tasks 0.7, 0.8, 1.1 done. Placeholder deployed to production (first and only deploy so far). Vercel Neon integration auto-installed vendor skills in `.agents/skills/` and `skills-lock.json`; guard added in CLAUDE.md. Task 0.6 done. Pending owner items: 0.9 (Resend: browser is not logged in; owner must log in and create the API key), `ADMIN_EMAILS` value, and removing `note.txt`.
- 2026-10-06: Tasks 0.3, 0.4, 0.5 done via Chrome (owner logged in). Owner approved accepting Google API Services User Data Policy. Note: Google console screenshot briefly displayed the client secret during creation; owner copied it to `.env.local`. Consider rotating the secret before any public launch.
- 2026-10-06: Redirect URIs registered: `https://insights.johnedeh.com/api/connect/google/callback` and `http://localhost:3000/api/connect/google/callback`. Scaffold must use exactly this callback path.
- 2026-10-05: Architecture, status and CLAUDE.md created. Nothing built yet. Next: Phase 0 (human-gated) and Phase 1 scaffold can start in parallel.

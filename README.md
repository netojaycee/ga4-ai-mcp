# Insights Connector (PoC codename `ga-mcp`)

A hosted, multi-user **MCP server** that lets AI assistants (Claude, ChatGPT, Cursor, VS Code, ...) read a person's **Google Analytics 4** and **Google Search Console** data, **read-only**, after a one-click "Sign in with Google". No terminal, no service accounts.

- Live (PoC): `https://insights.johnedeh.com` , MCP server URL: `https://insights.johnedeh.com/mcp`
- Status, next steps and task board: [`STATUS.md`](STATUS.md) (start at "RESUME HERE")
- Design and what was actually built: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Rules for people and agents working here: [`CLAUDE.md`](CLAUDE.md)

## How it works (30 seconds)
1. A user adds the server URL as a custom connector in their AI client.
2. The client discovers our OAuth server, registers itself, and sends the user to our consent page, after a Google sign-in that grants read-only Analytics and Search Console access.
3. The client then calls tools (`ga4_run_report`, `gsc_search_analytics`, ...). Each call is authenticated, checked against the user's plan and rate limits, and answered live from Google. We store an encrypted Google refresh token and usage counts, never the analytics data.

## Stack
Next.js (App Router) + TypeScript on Vercel, Postgres on Neon (Drizzle), the official MCP SDK (Streamable HTTP), Resend for email, Cloudflare DNS. Admin dashboard at `/admin`.

## Develop
```bash
npm install
cp .env.example .env.local        # fill in values; never commit them
npm run dev                       # http://localhost:3000 (uses the Neon `dev` branch via .env.development.local)
npm test && npm run lint && npm run typecheck && npm run build   # all must pass before a commit
npm run db:generate               # after editing src/server/db/schema.ts
npm run db:migrate                # applies to the dev database
npm run db:migrate:prod           # production, explicit opt-in (prints the target first)
```
Pushing `main` deploys to production through Vercel. Work on a branch for previews.

## Docs
| Doc | What |
|---|---|
| [`docs/clients.md`](docs/clients.md) | How to connect each AI client, what is verified |
| [`docs/runbook.md`](docs/runbook.md) | Incidents, kill switch, rollback, rotating secrets, common failures |
| [`docs/migration.md`](docs/migration.md) | Moving from the PoC accounts to the real brand |
| [`docs/setup-google.md`](docs/setup-google.md), [`docs/setup-hosting.md`](docs/setup-hosting.md) | How the Google Cloud project, Vercel, Neon and DNS are configured |
| [`docs/credentials-registry.md`](docs/credentials-registry.md) | Which account owns what (names only, no secrets) |

## Security in one paragraph
Read-only Google scopes only. Google refresh tokens are AES-256-GCM encrypted at rest; our own OAuth tokens are stored as hashes; tokens are bound to our `/mcp` URL; PKCE is mandatory; the consent flow is CSRF-protected; admin pages check admin rights on every request. Report problems to the address on the privacy page.

A `Dockerfile` exists for moving to another host (Azure); the Vercel deployment does not use it.

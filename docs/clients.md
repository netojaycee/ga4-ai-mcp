# Connecting AI clients

Server URL (PoC): `https://insights.johnedeh.com/mcp`
Auth: OAuth 2.1 with automatic client registration (DCR) and PKCE. Users sign in with Google once; the client then gets its own token.

## Claude (claude.ai) — VERIFIED 2026-10-06
1. Settings -> Customize -> Connectors -> **Add** -> Add custom connector.
2. Name: anything (e.g. `Insights Connector`). URL: the server URL above. Continue.
3. Leave defaults (**Sign in now**, **Register automatically**). Claude detects both from our metadata. Add.
4. Click **Connect**. Our page "Authorize access" appears (you must already have signed in with Google at `/account`, or you are sent through Google first). Click **Approve**.
5. Start a chat and ask, e.g. "List my GA4 properties". Claude asks permission per tool call: Allow once / Always allow.

Verified: connector add, DCR, authorize + consent, token exchange, tool discovery, 3 tool calls (list properties, two GA4 reports) returning real data.

Quirks seen:
- Claude shows a permission prompt for every tool call (and the same prompt can appear again for the next call). That is Claude's own control, not ours.
- If the first Connect attempt fails, a harmless unused client registration is left behind. Each Connect click registers a new client.
- Connectors live under Customize in the current claude.ai UI.

## ChatGPT — TODO (task 6.1)
Plus plan -> Settings -> Apps & Connectors -> Advanced -> Developer mode, then Create and paste the server URL; choose OAuth. Verify whether `search`/`fetch` tools are required (task 3.5).

## Claude Code — TODO (task 6.3)
`claude mcp add --transport http insights https://insights.johnedeh.com/mcp`, then `/mcp` to authenticate.

## Cursor / VS Code / Windsurf / others — TODO (tasks 6.4 to 6.6)
Add a remote HTTP MCP server with the URL. Cursor may require private-use redirect schemes (e.g. `cursor://`); our DCR currently only allows https and loopback http (see STATUS follow-ups).

## Troubleshooting
- "Cross-origin request rejected" on Approve: fixed 2026-10-06 (consent page used `Referrer-Policy: no-referrer`).
- "Your account was not found. Please reconnect": the user row is missing; sign in again at `/account`.
- "Too many requests": trial limit is 20 calls/minute and 200/day (see `src/config/plans.ts`).

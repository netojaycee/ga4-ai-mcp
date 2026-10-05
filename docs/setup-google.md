# Google Cloud setup (PoC)

Done 2026-10-06 via the Cloud console, signed in as `netojaycee@gmail.com`.

| Item | Value |
|---|---|
| Project name / ID | `insights-mcp-poc` |
| Parent | No organization (personal account) |
| APIs enabled | Google Analytics Data API, Google Analytics Admin API, Google Search Console API |
| Consent screen app name | `Insights Connector (PoC)` |
| Audience | External, **In production** (unverified, no logo) |
| Support / developer contact | `netojaycee@gmail.com` |
| Homepage | `https://insights.johnedeh.com` |
| Privacy / Terms | `https://insights.johnedeh.com/privacy`, `/terms` (pages to build, task 7.2) |
| Authorized domain | `johnedeh.com` |
| Scopes | `analytics.readonly` (sensitive), `webmasters.readonly`, `openid`, `userinfo.email`, `userinfo.profile` |
| OAuth client | `insights-mcp-web` (Web application) |
| Redirect URIs | `https://insights.johnedeh.com/api/connect/google/callback`, `http://localhost:3000/api/connect/google/callback` |
| Client ID / secret | In `.env.local` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and later Vercel env. Never in docs |

## Behaviour to expect
- Unverified production app: Google shows an "unverified app" warning; up to 100 users can grant the sensitive scope. Only `analytics.readonly` is sensitive.
- Privacy and terms URLs must exist before any verification submission.
- Client changes can take 5 minutes to a few hours to apply.
- The client secret cannot be viewed again. If lost, create a new client and update env everywhere.

## Still to do
- Verify `johnedeh.com` in Search Console (task 0.6), needed for verification later.
- Rotate the client secret before any public launch (it was displayed on screen during creation).
- Move to a company-owned project at brand time: see ARCHITECTURE.md section 12.

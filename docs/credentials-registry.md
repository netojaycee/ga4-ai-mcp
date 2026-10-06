# Credentials registry

Names, locations and owners only. **Never put secret values here.**

| Service | Identifier | Owner account | Secret lives in | Notes |
|---|---|---|---|---|
| Google Cloud project | `insights-mcp-poc` | `netojaycee@gmail.com` | n/a | PoC; migrate at brand time |
| Google OAuth client | `insights-mcp-web` | `netojaycee@gmail.com` | `.env.local` (`GOOGLE_CLIENT_SECRET`) | Rotate before public launch |
| Domain | `johnedeh.com` | owner | Cloudflare | App at `insights.johnedeh.com` |
| Resend | domain `mail.johnedeh.com` | owner | not yet in env | Task 0.9 |
| Vercel | project `insights-mcp`, team `edeh-jaycees-projects` | `netojaycee` | Vercel env (prod), `.env.local` (dev) | Hobby plan |
| Neon | project `insights-mcp-db` (`patient-union-05531403`), branches `main` (prod) and `dev` | `netojaycee@gmail.com` | prod: Vercel env + `.env.local`; dev: `.env.development.local` | Via Vercel integration; dev branch is schema-only |
| Cloudflare | zone `johnedeh.com`, record `A insights` | `netojaycee@gmail.com` | n/a | DNS only |
| App secrets | `TOKEN_ENC_KEYS`, `SESSION_SECRET` | n/a | Vercel env (prod) and `.env.local` (dev), different values | Rotate per runbook |

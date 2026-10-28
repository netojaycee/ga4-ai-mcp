# Google OAuth verification pack (task 8.2)

Status 2026-10-28: **branding verified and published** (app name `Insights Connector`, domain `johnedeh.com`, no logo). **Data access verification not yet submitted**: needs the demo video below. Cloud project `insights-mcp-poc`, console path: Google Auth Platform -> Verification Center -> Data access -> Prepare for verification.

Scopes on the consent screen (all read-only): `openid`, `email`, `profile`, `analytics.readonly`, `webmasters.readonly`, `youtube.readonly`, `yt-analytics.readonly`.

## Justification text (paste into "How will the scopes be used?", max 1000 characters)

> Insights Connector lets a user connect an AI assistant they choose (ChatGPT, Claude, Cursor) to their own Google Analytics 4, Search Console and YouTube data so they can ask questions about it in plain language. analytics.readonly reads GA4 reports and property lists; webmasters.readonly reads Search Console performance, sitemaps and URL inspection; youtube.readonly and yt-analytics.readonly read the user's own channel details and analytics reports (views, watch time, top videos), and are requested only if the user clicks "Connect YouTube". Every scope is read-only and only the minimum needed: there is no narrower scope that returns reports. Data is fetched when the user asks a question and is not stored. Google refresh tokens are stored encrypted and never given to the AI client. Use of Google data follows the Google API Services User Data Policy including Limited Use: no sale, no advertising, no model training.

Per-scope one-liners (if the form asks separately):
- `analytics.readonly`: run GA4 Data API reports and list GA4 properties for the signed-in user.
- `webmasters.readonly`: list the user's Search Console sites and run search analytics, sitemap and URL inspection reads.
- `youtube.readonly`: read the user's own channel title, stats and video titles (to label analytics results).
- `yt-analytics.readonly`: read YouTube Analytics reports for the user's own channel (views, watch time, subscribers, top videos).

## Demo video checklist (owner records; unlisted YouTube link, English, 3-5 minutes)

Google requires the video to show the full OAuth flow, the consent screen with the **client ID visible in the browser address bar**, each scope in use, and the app's own domain. Use a clean browser profile (not signed in to the app).

1. Open `https://insights.johnedeh.com` and scroll the home page: purpose, "How Insights Connector uses your Google data", privacy link. Open `/privacy` briefly.
2. In ChatGPT or Claude add the connector with `https://insights.johnedeh.com/mcp`.
3. Reach the Google consent screen. **Pause so the address bar (with `client_id=`) and the app name are readable.** Show the scope list. Approve.
4. Show our Approve page (email shown, read-only wording). Approve.
5. Ask the assistant: "List my GA4 properties", then a GA4 report; then a Search Console query report. (analytics.readonly, webmasters.readonly)
6. Open `/account`, click **Connect YouTube**, show the second consent screen with the YouTube scopes and the channel picker, approve.
7. Ask: "Show my YouTube channel", then "Top 10 videos in the last 28 days". (youtube.readonly, yt-analytics.readonly)
8. Back on `/account` show **Disconnect** and **Delete my data**, and click Disconnect to show access is revoked.

## Things reviewers check
- Privacy policy and home page on the verified domain, naming each Google data type and the Limited Use statement (done).
- App name matches the home page (done: `Insights Connector`).
- YouTube: link to YouTube Terms of Service and Google Privacy Policy in the policy (done); offer a way to revoke at `myaccount.google.com/permissions` (done).
- Expect follow-up questions by email to `netojaycee@gmail.com`. Answer from this file.

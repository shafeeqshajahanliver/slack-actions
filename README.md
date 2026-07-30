# Slack reply tracker

Private tracker for Slack asks awaiting a reply from Shaf. Static page + one
serverless function, deployed on Vercel.

## Files
- `index.html` — the whole app. The card data lives in the `ITEMS` array between
  the `/* ITEMS:START */` and `/* ITEMS:END */` markers. Nothing else should be
  edited by automation.
- `api/refresh.js` — POST endpoint. Reads Slack, asks Claude what changed,
  rewrites the ITEMS block, commits back here. Vercel redeploys on the commit.

## Refresh paths
1. **Button on the page** → `/api/refresh` (needs the env vars below).
   Falls back to opening the Claude desktop app if not configured.
2. **Scheduled task**, weekdays 09:00, run by Claude. Independent of the
   endpoint and of any desktop.
3. **Ask Claude** in any session: "refresh the tracker".

## Environment variables
Set in Vercel → Project → Settings → Environment Variables:

| Name | Notes |
|---|---|
| `SLACK_USER_TOKEN` | `xoxp-...` user token, scope `search:read`. Must be a **user** token; Slack's search API rejects bot tokens. |
| `ANTHROPIC_API_KEY` | `sk-ant-...` from console.anthropic.com. Billed per refresh. |
| `GITHUB_TOKEN` | Fine-grained PAT, Contents: read and write, this repo only. |
| `ANTHROPIC_MODEL` | Optional. Pin a model id; otherwise the newest Sonnet is chosen at runtime. |

## Security
`/api/refresh` has **no authentication of its own**. It relies entirely on
Vercel Deployment Protection covering the project. If protection is turned off,
anyone who finds the URL can trigger a read of Shaf's Slack. Keep it on.

The Slack user token can read everything Shaf can read, including every DM.
Treat it as a password, and rotate it if the Vercel project is ever shared.

# Slack reply tracker

Private tracker for Slack asks awaiting a reply from Shaf. A single static page,
deployed on Vercel. No backend, no API routes, no stored credentials.

## Files
- `index.html` — the whole app. The card data lives in the `ITEMS` array between
  the `/* ITEMS:START */` and `/* ITEMS:END */` markers. Automation edits that
  block and the timestamp in `.sync .stamp`. Nothing else.

## How it refreshes
Claude does the work, using Shaf's own authorised Slack connection. It reads the
relevant channels and threads, checks reactions, closes what has been handled,
adds anything new, rewrites the `ITEMS` block and pushes to GitHub. Vercel
redeploys on the commit.

Three ways in, all the same job:

1. **Scheduled task** — `Slack Actions`, weekday mornings. Runs on its own in the
   cloud, needs no desktop.
2. **Ask Claude** in any session: "refresh the tracker".
3. **Refresh button** on the page — opens the Claude desktop app with the
   instructions prefilled. Desktop only, since it uses a `claude://` deep link.

There is deliberately no server-side refresh endpoint. One was prototyped and
removed. It would have needed a long-lived Slack user token with history and
reactions scopes sitting in Vercel environment variables, reachable by anyone who
found the URL, and it still could not see the meeting context Claude draws on
when drafting replies.

## Security
The page is a static file containing internal Slack messages and client names.
Keep Vercel Deployment Protection on. That is the only thing standing between
the URL and the contents.

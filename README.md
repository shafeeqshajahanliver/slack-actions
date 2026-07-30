# Slack reply tracker

Private single-page tracker for Slack asks awaiting a reply from Shaf.

- `index.html` — self-contained app. No build step, no dependencies.
- Refreshed by a Claude scheduled task, which rewrites the `ITEMS` array
  and the `.sync .stamp` timestamp, then commits back to this repo.
- Deployed on Vercel as a static site. **Deployment Protection must stay ON** —
  the contents include internal Slack messages and client names.

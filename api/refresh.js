/**
 * POST /api/refresh
 *
 * Reads Shaf's Slack, asks Claude which asks are still open, rewrites the
 * ITEMS array inside index.html, and commits it back to GitHub. Vercel then
 * redeploys automatically, so the live page reflects the new state.
 *
 * Required env vars (Vercel → Project → Settings → Environment Variables):
 *   SLACK_USER_TOKEN   xoxp-...  user token with scope: search:read
 *   ANTHROPIC_API_KEY  sk-ant-...
 *   GITHUB_TOKEN       fine-grained PAT, Contents: read and write on this repo
 * Optional:
 *   GITHUB_REPO        default "shafeeqshajahanliver/slack-actions"
 *   ANTHROPIC_MODEL    pinned model id; otherwise the newest Sonnet is used
 *   SLACK_USER_ID      default "U09JWELV5PY"
 *
 * ACCESS CONTROL: this route has no auth of its own. It relies on Vercel
 * Deployment Protection covering the whole project. If protection is ever
 * turned off, this endpoint becomes a public read of Shaf's Slack.
 */

const REPO      = process.env.GITHUB_REPO || 'shafeeqshajahanliver/slack-actions';
const ME        = process.env.SLACK_USER_ID || 'U09JWELV5PY';
const FILE      = 'index.html';
const START     = '/* ITEMS:START';
const END       = '/* ITEMS:END */';
const MAX_ITEMS = 40;

const j = (res, code, body) => res.status(code).json(body);

/* ---------------- Slack ---------------- */

async function slackSearch(token, query, count = 30) {
  const url = 'https://slack.com/api/search.messages?query=' +
    encodeURIComponent(query) + '&count=' + count + '&sort=timestamp';
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (!d.ok) throw new Error(`Slack search failed (${query}): ${d.error}`);
  return (d.messages && d.messages.matches) || [];
}

function tidy(m) {
  return {
    user: m.username || (m.user && m.user.name) || m.user || 'unknown',
    channel: (m.channel && (m.channel.name || m.channel.id)) || '',
    is_dm: !!(m.channel && m.channel.is_im),
    ts: m.ts,
    when: new Date(Number(String(m.ts).split('.')[0]) * 1000).toISOString(),
    text: String(m.text || '').slice(0, 1400),
    link: m.permalink,
  };
}

/* ---------------- GitHub ---------------- */

async function ghGet(token) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) throw new Error(`GitHub read failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  return { sha: d.sha, html: Buffer.from(d.content, 'base64').toString('utf8') };
}

async function ghPut(token, html, sha, message) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({
      message, sha,
      content: Buffer.from(html, 'utf8').toString('base64'),
      committer: { name: 'Slack tracker refresh', email: 'shafeeqshajahan@gmail.com' },
    }),
  });
  if (!r.ok) throw new Error(`GitHub write failed: ${r.status} ${await r.text()}`);
  return r.json();
}

/* ---------------- Anthropic ---------------- */

async function pickModel(key) {
  if (process.env.ANTHROPIC_MODEL) return process.env.ANTHROPIC_MODEL;
  const r = await fetch('https://api.anthropic.com/v1/models?limit=50', {
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  });
  if (!r.ok) throw new Error(`Model list failed: ${r.status}`);
  const ids = (await r.json()).data.map(m => m.id);
  return ids.find(i => /sonnet/i.test(i)) || ids[0];
}

const SYSTEM = `You maintain Shafeeq Shajahan's Slack reply tracker. Shaf is VP Product at Intent HQ; his Slack user ID is ${ME}.

You are given the CURRENT tracker items and RECENT Slack activity. Return the updated item list.

Rules:
1. CLOSE an existing open item (set "done": true, add tag "sent", and rewrite "ask" to a one-line status) if Shaf has replied after the original ask, has reacted to it, or it is clearly resolved by others.
2. PERMANENT CLOSE: any item already done:true stays in the list with done:true forever. Never reopen, never delete, never duplicate it.
3. ADD a new item only for a genuine unanswered direct question or request to Shaf where a reply is clearly needed. Skip FYIs, bot posts, social chat, and anything he already answered. Dedupe by "link" against every existing item.
4. "category": "client" if it concerns a client or prospect (Vivo, Parimatch, Redcore, Travelclub, MTN, Mobileum, Fishka, EE, Jelou, XLSMART, AIS, Etisalat, Gymshark), otherwise "internal". Client items first in the array.
5. "draft" must sound like Shaf: question-led bullet lists with sub-points, conditional commitments ("If X, we are in luck as... If not, I will prioritise..."), delegation by @name, plain warm tone, often closing "Hope that helps." No em dashes.
6. Set "due" (e.g. "Due Mon 12:30") only when the ask states a real deadline.

Return ONLY a JSON object: {"items": [...]}. Each item: title, category, tags (array of short lowercase strings), who, when ("Thu 30 Jul, 15:52"), ask, context, link, draft, and optionally done:true and due. No prose, no markdown fences.`;

async function askClaude(key, model, items, recent) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{
        role: 'user',
        content:
          `CURRENT ITEMS:\n${JSON.stringify(items, null, 1)}\n\n` +
          `RECENT SLACK — messages addressed to Shaf:\n${JSON.stringify(recent.to, null, 1)}\n\n` +
          `RECENT SLACK — messages mentioning Shaf:\n${JSON.stringify(recent.mentions, null, 1)}\n\n` +
          `RECENT SLACK — Shaf's own recent messages (use these to tell what he has already answered):\n${JSON.stringify(recent.mine, null, 1)}\n\n` +
          `Today is ${new Date().toISOString().slice(0, 10)}. Return the updated {"items": [...]}.`,
      }],
      // Force well-formed JSON out of the model.
      tools: [{
        name: 'return_items',
        description: 'Return the updated tracker items.',
        input_schema: {
          type: 'object',
          properties: { items: { type: 'array', items: { type: 'object' } } },
          required: ['items'],
        },
      }],
      tool_choice: { type: 'tool', name: 'return_items' },
    }),
  });
  if (!r.ok) throw new Error(`Anthropic call failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  const use = (d.content || []).find(c => c.type === 'tool_use');
  if (!use) throw new Error('Model returned no structured output');
  return use.input.items;
}

/* ---------------- validation ---------------- */

function validate(items, previous) {
  if (!Array.isArray(items) || !items.length) throw new Error('Model returned no items');
  if (items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS);

  const need = ['title', 'category', 'who', 'when', 'ask', 'context', 'link', 'draft'];
  const clean = [];
  const seen = new Set();
  for (const it of items) {
    if (need.some(k => typeof it[k] !== 'string' || !it[k])) continue;
    if (!/^https:\/\/[a-z0-9.-]*slack\.com\//i.test(it.link)) continue;
    if (seen.has(it.link)) continue;
    seen.add(it.link);
    clean.push({
      title: it.title, category: it.category === 'internal' ? 'internal' : 'client',
      tags: Array.isArray(it.tags) ? it.tags.slice(0, 5).map(String) : [],
      who: it.who, when: it.when, ask: it.ask, context: it.context,
      link: it.link, draft: it.draft,
      ...(it.done === true ? { done: true } : {}),
      ...(typeof it.due === 'string' && it.due ? { due: it.due } : {}),
    });
  }

  // Rule 2 enforced in code, not left to the model: every previously-closed
  // item must survive, still closed.
  for (const old of previous) {
    if (old.done !== true) continue;
    const hit = clean.find(c => c.link === old.link);
    if (!hit) clean.push({ ...old, done: true });
    else hit.done = true;
  }
  if (!clean.length) throw new Error('No valid items survived validation');

  clean.sort((a, b) => (a.category === b.category ? 0 : a.category === 'client' ? -1 : 1));
  return clean;
}

/* ---------------- handler ---------------- */

export default async function handler(req, res) {
  if (req.method !== 'POST') return j(res, 405, { ok: false, error: 'Use POST' });

  const slack = process.env.SLACK_USER_TOKEN;
  const anth  = process.env.ANTHROPIC_API_KEY;
  const gh    = process.env.GITHUB_TOKEN;
  const missing = [
    !slack && 'SLACK_USER_TOKEN',
    !anth && 'ANTHROPIC_API_KEY',
    !gh && 'GITHUB_TOKEN',
  ].filter(Boolean);
  if (missing.length) {
    return j(res, 503, { ok: false, error: `Not configured. Missing: ${missing.join(', ')}` });
  }

  try {
    const { sha, html } = await ghGet(gh);
    const a = html.indexOf(START), b = html.indexOf(END);
    if (a < 0 || b < 0) throw new Error('ITEMS markers not found in index.html');

    const block = html.slice(a, b);
    const previous = JSON.parse(
      block.slice(block.indexOf('[')).replace(/;\s*$/, '')
        // JS object literals → JSON
        .replace(/(\{|,)\s*([A-Za-z_][\w]*)\s*:/g, '$1"$2":')
        .replace(/,(\s*[\]}])/g, '$1')
    );

    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
    const [to, mentions, mine] = await Promise.all([
      slackSearch(slack, `to:me after:${since}`),
      slackSearch(slack, `shafeeq after:${since}`),
      slackSearch(slack, `from:me after:${since}`, 40),
    ]);
    const recent = { to: to.map(tidy), mentions: mentions.map(tidy), mine: mine.map(tidy) };

    const model = await pickModel(anth);
    const items = validate(await askClaude(anth, model, previous, recent), previous);

    const stamp = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', weekday: 'short', day: 'numeric',
      month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date()).replace(',', '').replace(/(\d{2}:\d{2})/, '$1 BST');

    const openNow = items.filter(i => !i.done).length;
    const closed  = previous.filter(p => !p.done).length - openNow + (items.length - previous.length);

    let out = html.slice(0, a) +
      `${START} — do not edit this marker; /api/refresh rewrites between the markers */\n` +
      `const ITEMS = ${JSON.stringify(items, null, 2)};\n` +
      html.slice(b);
    out = out.replace(
      /(<span class="stamp">)[^<]*(<\/span>)/,
      `$1Synced from Slack — ${stamp}$2`
    );

    await ghPut(gh, out, sha, `Refresh: ${items.length} items, ${openNow} open`);

    return j(res, 200, {
      ok: true, open: openNow, total: items.length,
      closed: Math.max(closed, 0), stamp, model,
      note: 'Committed to GitHub. Vercel is redeploying; reload in about a minute.',
    });
  } catch (e) {
    return j(res, 500, { ok: false, error: String(e.message || e) });
  }
}

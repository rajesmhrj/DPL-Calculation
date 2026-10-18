/* Vercel serverless function: the shared ledger is an Excel file stored in the
 * GitHub repo. GET returns it, PUT commits a new version.
 *
 * Environment variables (Vercel → Project → Settings → Environment Variables):
 *   GITHUB_TOKEN   fine-grained token with "Contents: Read and write" on the repo (required)
 *   GITHUB_REPO    owner/name, default suyog12/settlement-calculator
 *   LEDGER_BRANCH  default "ledger" (kept off main so saves don't trigger redeploys)
 *   LEDGER_PATH    default ledger.xlsx
 *   EDIT_PASSWORD  if set, saving requires this password; viewing never does
 */
const REPO = process.env.GITHUB_REPO || 'suyog12/settlement-calculator';
const BRANCH = process.env.LEDGER_BRANCH || 'ledger';
const FILE = process.env.LEDGER_PATH || 'ledger.xlsx';
const API = process.env.GITHUB_API || 'https://api.github.com'; // overridable for local testing

function gh(path, init = {}) {
  return fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'settlement-calculator',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
}

// Creates the ledger branch from the default branch the first time.
async function ensureBranch() {
  const r = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
  if (r.ok) return;
  const repo = await (await gh(`/repos/${REPO}`)).json();
  const base = await (await gh(`/repos/${REPO}/git/ref/heads/${repo.default_branch}`)).json();
  const c = await gh(`/repos/${REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: base.object.sha }),
  });
  if (!c.ok && c.status !== 422) throw new Error(`Could not create branch: ${c.status}`);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body);
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (!process.env.GITHUB_TOKEN) return send(res, 503, { error: 'GITHUB_TOKEN is not set on the server.' });
  try {
    if (req.method === 'GET') {
      const r = await gh(`/repos/${REPO}/contents/${FILE}?ref=${BRANCH}`);
      if (r.status === 404) return send(res, 200, { sha: null, content: null, passwordRequired: !!process.env.EDIT_PASSWORD });
      if (!r.ok) return send(res, 502, { error: `GitHub returned ${r.status}` });
      const j = await r.json();
      let content = j.content;
      if (!content && j.git_url) {
        // Files over 1 MB come back without inline content.
        content = (await (await gh(j.git_url.replace(API, ''))).json()).content;
      }
      return send(res, 200, { sha: j.sha, content: (content || '').replace(/\n/g, ''), passwordRequired: !!process.env.EDIT_PASSWORD });
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (process.env.EDIT_PASSWORD && body.password !== process.env.EDIT_PASSWORD) {
        return send(res, 401, { error: 'Wrong edit password.' });
      }
      if (typeof body.content !== 'string' || !body.content) return send(res, 400, { error: 'Missing content.' });
      await ensureBranch();
      const r = await gh(`/repos/${REPO}/contents/${FILE}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: String(body.message || 'Update ledger').slice(0, 200),
          content: body.content,
          branch: BRANCH,
          ...(body.sha ? { sha: body.sha } : {}),
        }),
      });
      // 409/422: someone else saved first (stale sha) — client reloads and retries.
      if (r.status === 409 || r.status === 422) return send(res, 409, { error: 'The ledger changed since it was loaded.' });
      if (!r.ok) return send(res, 502, { error: `GitHub returned ${r.status}` });
      const j = await r.json();
      return send(res, 200, { sha: j.content.sha });
    }

    res.setHeader('Allow', 'GET, PUT');
    return send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
};

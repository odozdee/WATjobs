import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { rank, profileFrom, expandProfileKeywords, summarizePosting } from './search.mjs';
import { readBoard } from './waterlooworks.mjs';
import { createSession, attachSession, releaseSession } from './steel-sessions.mjs';

const liveReady = Boolean(process.env.STEEL_API_KEY);
const port = Number(process.env.PORT || 3000);
const activeSearches = new Set();

async function collect(token, profile, board, keywordsReady) {
  if (activeSearches.has(token)) {
    throw new Error('Start a new search after the current search finishes.');
  }
  activeSearches.add(token);
  let connection;
  try {
    connection = await attachSession(token);
    return await readBoard(connection.context, profile, board, () => {}, keywordsReady);
  } finally {
    activeSearches.delete(token);
    if (connection) {
      await connection.browser.close().catch(() => {});
    }
  }
}

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
]);
const json = (res, status, body) => res.writeHead(status, {
  'content-type': 'application/json', 'cache-control': 'no-store',
}).end(JSON.stringify(body));

export default async function handler(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost');
  const path = requestUrl.searchParams.has('route')
    ? '/api/' + requestUrl.searchParams.get('route')
    : requestUrl.pathname;
  try {
    if (req.method === 'GET' && files.has(path)) {
      const [file, type] = files.get(path);
      const content = await readFile(new URL('./public/' + file, import.meta.url));
      return res.writeHead(200, {
        'content-type': type + '; charset=utf-8',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-src https://*.steel.dev; frame-ancestors 'none'",
      }).end(content);
    }
    if (req.method === 'GET' && path === '/api/config') {
      return json(res, 200, { liveReady });
    }
    if (req.method !== 'POST') {
      return json(res, 404, { error: 'Page not found.' });
    }
    const protocol = process.env.VERCEL ? 'https:' : 'http:';
    const allowedOrigin = protocol + '//' + req.headers.host;
    if (req.headers.origin !== allowedOrigin) {
      return json(res, 403, { error: 'Open this WATjobs website before making requests.' });
    }
    let raw = '';
    for await (const chunk of req.body === undefined ? req : []) {
      raw += chunk;
      if (raw.length > 8000) {
        return json(res, 413, { error: 'Request is too large.' });
      }
    }
    const body = req.body && typeof req.body === 'object'
      ? req.body : JSON.parse(typeof req.body === 'string' ? req.body : raw);
    if (JSON.stringify(body).length > 8000) {
      return json(res, 413, { error: 'Request is too large.' });
    }
    if (path === '/api/connect') {
      return json(res, 200, await createSession());
    }
    if (path === '/api/disconnect') {
      await releaseSession(body.token).catch(() => {});
      return json(res, 200, {});
    }
    if (path === '/api/search-progress') {
      return json(res, 200, {});
    }
    if (path === '/api/search') {
      if (!body.token) {
        throw new Error('Connect to a Steel browser and sign in to WaterlooWorks first.');
      }
      const profile = profileFrom(body.profile);
      const result = await collect(body.token, profile, body.board, expandProfileKeywords(profile));
      const ranked = rank(result.jobs, profile, true);
      const keywordFallback = ranked.length === 0 && result.jobs.length > 0;
      const all = rank(result.jobs, profile, true, { includeUnmatched: true });
      const jobs = keywordFallback ? all : [...ranked, ...all.filter(job => !job.matched.length)];
      await releaseSession(body.token).catch(() => {});
      return json(res, 200, {
        ...result,
        jobs: jobs.map(job => ({ ...job, description: summarizePosting(job.description) })),
        keywordFallback,
        ai: profile.ai,
      });
    }
    return json(res, 404, { error: 'Page not found.' });
  } catch (error) {
    const message = error instanceof SyntaxError ? 'Invalid request data.' : error.message;
    return json(res, 400, { error: /^(Connect |Start |Open |Could |Live |Run npm|Steel |Enter |Posting |Invalid )/.test(message) ? message : 'The request could not be completed.' });
  }
}

if (!process.env.VERCEL && process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(handler).listen(port, '127.0.0.1', () => {
    console.log('WatJobs is available at http://127.0.0.1:' + port);
  });
}

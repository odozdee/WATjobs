import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { rank, profileFrom, expandProfileKeywords, summarizePosting } from './search.mjs';

import { origin, readBoard } from './waterlooworks.mjs';
const steelKey = process.env.STEEL_API_KEY;
const steelHeadless = process.env.STEEL_HEADLESS === '1';
const sessions = new Map();
const liveReady = Boolean(steelKey);
const port = Number(process.env.PORT || 3000);
const sessionLifetime = 900000;

async function steel(path, body) {
  const response = await fetch('https://api.steel.dev/v1/sessions' + path, {
    method: 'POST',
    headers: { 'steel-api-key': steelKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error('Steel could not complete the request.');
  }
  if (!path) {
    return response.json();
  }
}

async function release(token) {
  const session = sessions.get(token);
  if (!session) {
    return;
  }
  sessions.delete(token);
  clearTimeout(session.timer);
  await steel('/' + encodeURIComponent(session.id) + '/release', {}).catch(() => {});
}

async function connect() {
  if (!liveReady) {
    throw new Error('Live search needs a Steel API key.');
  }
  const { chromium } = await import('playwright-core').catch(() => {
    throw new Error('Run npm install to enable the Steel browser connection.');
  });
  const session = await steel('', {
    timeout: sessionLifetime,
    headless: steelHeadless,
    dimensions: { width: 1280, height: 800 },
    debugConfig: { interactive: true },
  });
  const token = randomUUID();
  const timer = setTimeout(() => void release(token), sessionLifetime);
  sessions.set(token, { id: session.id, timer });
  try {
    const endpoint = new URL('wss://connect.steel.dev');
    endpoint.searchParams.set('apiKey', steelKey);
    endpoint.searchParams.set('sessionId', session.id);
    const browser = await chromium.connectOverCDP(endpoint.href, { timeout: 15000 });
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const viewer = new URL(session.debugUrl || session.sessionViewerUrl);
    if (viewer.protocol !== 'https:' || !viewer.hostname.endsWith('.steel.dev')) {
      throw new Error('Steel returned an unexpected viewer address.');
    }
    viewer.searchParams.set('interactive', 'true');
    sessions.set(token, { id: session.id, timer, context });
    return { token, viewer: viewer.href };
  } catch {
    await release(token);
    throw new Error('Could not open a WaterlooWorks browser session.');
  }
}

async function collect(token, profile, board, keywordsReady) {
  const session = sessions.get(token);
  if (!session?.context || session.busy) {
    throw new Error('Start a new Steel session before searching.');
  }
  if (!session.context.browser()?.isConnected()) {
    throw new Error('Steel browser disconnected. Reconnect and sign in to WaterlooWorks again.');
  }
  session.busy = true;
  session.progress = { checked: 0, pages: 0 };
  try {
    return await readBoard(session.context, profile, board, (checked, pages, phase, total) => {
      session.progress = { checked, pages, phase, total };
    }, keywordsReady);
  } catch (error) {
    if (!session.context.browser()?.isConnected()) {
      throw new Error('Steel browser disconnected during the search. Reconnect and try again.');
    }
    throw error;
  } finally {
    session.busy = false;
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

createServer(async (req, res) => {
  try {
    if (req.headers.host !== '127.0.0.1:' + port) {
      return json(res, 403, { error: 'Use the local app address.' });
    }
    if (req.method === 'GET' && files.has(req.url)) {
      const [file, type] = files.get(req.url);
      const content = await readFile(new URL('./public/' + file, import.meta.url));
      return res.writeHead(200, {
        'content-type': type + '; charset=utf-8',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-src https://*.steel.dev; frame-ancestors 'none'",
      }).end(content);
    }
    if (req.method === 'GET' && req.url === '/api/config') {
      return json(res, 200, { liveReady });
    }
    if (req.method !== 'POST') {
      return json(res, 404, { error: 'Page not found.' });
    }
    if (req.headers.origin !== 'http://127.0.0.1:' + port) {
      return json(res, 403, { error: 'Open the local app first.' });
    }
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 8000) {
        return json(res, 413, { error: 'Request is too large.' });
      }
    }
    const body = JSON.parse(raw);
    if (req.url === '/api/connect') {
      return json(res, 200, await connect());
    }
    if (req.url === '/api/disconnect') {
      await release(body.token);
      return json(res, 200, {});
    }
    if (req.url === '/api/search-progress') {
      const progress = sessions.get(body.token)?.progress;
      return json(res, 200, { progress });
    }
    if (req.url === '/api/search') {
      if (!body.token) {
        throw new Error('Connect to a Steel browser and sign in to WaterlooWorks first.');
      }
      const profile = profileFrom(body.profile);
      const result = await collect(body.token, profile, body.board, expandProfileKeywords(profile));
      const ranked = rank(result.jobs, profile, true);
      const keywordFallback = ranked.length === 0 && result.jobs.length > 0;
      const all = rank(result.jobs, profile, true, { includeUnmatched: true });
      const jobs = keywordFallback ? all : [...ranked, ...all.filter(job => !job.matched.length)];
      await release(body.token);
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
}).listen(port, '127.0.0.1', () => console.log('WatJobs is available at http://127.0.0.1:' + port));

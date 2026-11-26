import { origin, readBoard } from './waterlooworks.mjs';
import { profileFrom, rank, summarizePosting } from './search.mjs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';


const steelKey = process.env.STEEL_API_KEY;
const steelHeadless = process.env.STEEL_HEADLESS === '1';
const liveReady = Boolean(steelKey);
const sessionLifetime = 900000;
const sessions = new Map();

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
  await steel('/' + encodeURIComponent(session.id) + '/release', {});
  clearTimeout(session.timer);
  sessions.delete(token);
}

async function connect() {
  if (!liveReady) {
    throw new Error('Live search needs a Steel API key.');
  }
  const { chromium } = await import('playwright-core');
  const session = await steel('', {
    timeout: sessionLifetime,
    headless: steelHeadless,
    dimensions: { width: 1280, height: 800 },
    debugConfig: { interactive: true },
  });
  const token = randomUUID();
  const timer = setTimeout(() => {
    void release(token).catch(() => {});
  }, sessionLifetime);
  timer.unref();
  sessions.set(token, { id: session.id, timer });
  try {
    const endpoint = new URL('wss://connect.steel.dev');
    endpoint.searchParams.set('apiKey', steelKey);
    endpoint.searchParams.set('sessionId', session.id);
    const browser = await chromium.connectOverCDP(endpoint.href, { timeout: 15000 });
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.newPage();
    await page.goto(origin, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    const viewer = new URL(session.debugUrl || session.sessionViewerUrl);
    if (viewer.protocol !== 'https:' || !viewer.hostname.endsWith('.steel.dev')) {
      throw new Error('Steel returned an unexpected viewer address.');
    }
    sessions.set(token, { id: session.id, timer, context });
    return {
      id: session.id,
      token,
      viewer: viewer.href,
    };
  } catch {
    await release(token).catch(() => {});
    throw new Error('Could not open a WaterlooWorks browser session.');
  }
}

const pages = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
]);

export const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/api/config') {
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    }).end(JSON.stringify({ liveReady }));
    return;
  }
  if (request.method === 'POST' && request.url === '/api/connect') {
    if (request.headers.origin !== 'http://127.0.0.1:' + server.address().port) {
      response.writeHead(403).end('Open the local app first.');
      return;
    }
    try {
      const session = await connect();
      response.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      }).end(JSON.stringify(session));
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({
        error: liveReady ? 'Could not create a Steel browser session.' : 'Live search needs a Steel API key.',
      }));
    }
    return;
  }
  if (request.method === 'POST' && request.url === '/api/disconnect') {
    if (request.headers.origin !== 'http://127.0.0.1:' + server.address().port) {
      response.writeHead(403).end('Open the local app first.');
      return;
    }
    try {
      let input = '';
      for await (const chunk of request) {
        input += chunk;
        if (input.length > 8000) {
          response.writeHead(413).end('Request is too large.');
          return;
        }
      }
      const body = JSON.parse(input);
      if (typeof body?.token !== 'string') {
        response.writeHead(400).end('A session token is required.');
        return;
      }
      await release(body.token);
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({
        error: 'Could not release the Steel session.',
      }));
    }
    return;
  }
  if (request.method === 'POST' && request.url === '/api/open-board') {
    if (request.headers.origin !== 'http://127.0.0.1:' + server.address().port) {
      response.writeHead(403).end('Open the local app first.');
      return;
    }
    let session;
    try {
      let input = '';
      for await (const chunk of request) {
        input += chunk;
        if (input.length > 8000) {
          response.writeHead(413).end('Request is too large.');
          return;
        }
      }
      const body = JSON.parse(input);
      session = sessions.get(body.token);
      if (!session?.context || session.busy) {
        throw new Error('Connect to Steel before opening a job board.');
      }
      session.busy = true;
      const result = await readBoard(session.context, {}, body.board);
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      const message = /^(?:Enter |Open |Could |Connect )/.test(error.message)
        ? error.message : 'Could not open the WaterlooWorks job board.';
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
    } finally {
      if (session) {
        session.busy = false;
      }
    }
    return;
  }
  if (request.method === 'POST' && request.url === '/api/search') {
    if (request.headers.origin !== 'http://127.0.0.1:' + server.address().port) {
      response.writeHead(403).end('Open the local app first.');
      return;
    }
    let session;
    let ownsSearch = false;
    try {
      let input = '';
      for await (const chunk of request) {
        input += chunk;
        if (input.length > 8000) {
          response.writeHead(413).end('Request is too large.');
          return;
        }
      }
      const body = JSON.parse(input);
      session = sessions.get(body.token);
      if (!session?.context) {
        throw new Error('Connect to a Steel browser and sign in to WaterlooWorks first.');
      }
      if (session.busy) {
        response.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({
          error: 'A search is already running in this browser session.',
        }));
        return;
      }
      const profile = profileFrom(body.profile);
      session.busy = true;
      ownsSearch = true;
      const result = await readBoard(session.context, profile, body.board);
      const ranked = rank(result.jobs, profile, true);
      const keywordFallback = ranked.length === 0 && result.jobs.length > 0;
      const all = rank(result.jobs, profile, true, { includeUnmatched: true });
      const jobs = keywordFallback ? all : [...ranked, ...all.filter(job => !job.matched.length)];
      await release(body.token).catch(() => {});
      response.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      }).end(JSON.stringify({
        ...result,
        jobs: jobs.map(job => ({ ...job, description: summarizePosting(job.description || '') })),
        keywordFallback,
      }));
    } catch (error) {
      const message = error instanceof SyntaxError ? 'Invalid request data.'
        : /^(?:Enter |Open |Could |Connect )/.test(error.message)
          ? error.message : 'Could not complete the WaterlooWorks search.';
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
    } finally {
      if (ownsSearch) {
        session.busy = false;
      }
    }
    return;
  }
  if (request.method === 'POST' && request.url === '/api/preferences') {
    let input = '';
    try {
      for await (const chunk of request) {
        input += chunk;
        if (input.length > 8000) {
          response.writeHead(413, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Preferences are too long.' }));
          return;
        }
      }
      const profile = profileFrom(JSON.parse(input));
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ profile }));
    } catch (error) {
      const message = error instanceof SyntaxError ? 'Invalid preference data.' : error.message;
      response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
    }
    return;
  }
  const page = pages.get(request.url);
  if (!page || request.method !== 'GET') {
    response.writeHead(404).end('Not found');
    return;
  }

  const [file, type] = page;
  try {
    const content = await readFile(new URL('./public/' + file, import.meta.url));
    response.writeHead(200, { 'content-type': type + '; charset=utf-8' }).end(content);
  } catch {
    response.writeHead(500).end('Could not load the page');
  }
});

server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => {
  console.log('WATjobs is running at http://127.0.0.1:' + server.address().port);
});

import { profileFrom } from './search.mjs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';


const steelKey = process.env.STEEL_API_KEY;
const steelHeadless = process.env.STEEL_HEADLESS === '1';
const liveReady = Boolean(steelKey);
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

async function connect() {
  if (!liveReady) {
    throw new Error('Live search needs a Steel API key.');
  }
  const session = await steel('', {
    timeout: sessionLifetime,
    headless: steelHeadless,
    dimensions: { width: 1280, height: 800 },
    debugConfig: { interactive: true },
  });
  const { chromium } = await import('playwright-core');
  try {
    const endpoint = new URL('wss://connect.steel.dev');
    endpoint.searchParams.set('apiKey', steelKey);
    endpoint.searchParams.set('sessionId', session.id);
    const browser = await chromium.connectOverCDP(endpoint.href, { timeout: 15000 });
    try {
      const context = browser.contexts()[0];
      const page = context.pages()[0] || await context.newPage();
      await page.goto('https://waterlooworks.uwaterloo.ca', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
    } finally {
      await browser.close();
    }
  } catch {
    await steel('/' + encodeURIComponent(session.id) + '/release', {}).catch(() => {});
    throw new Error('Could not open a WaterlooWorks browser session.');
  }
  const viewer = new URL(session.debugUrl || session.sessionViewerUrl);
  if (viewer.protocol !== 'https:' || !viewer.hostname.endsWith('.steel.dev')) {
    throw new Error('Steel returned an unexpected viewer address.');
  }
  return {
    id: session.id,
    viewer: viewer.href,
  };
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

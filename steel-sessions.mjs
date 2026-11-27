import { createHmac, timingSafeEqual } from 'node:crypto';

const lifetime = 900000;
const key = process.env.STEEL_API_KEY;

function signature(payload) {
  return createHmac('sha256', key).update('watjobs-session:' + payload).digest('base64url');
}

function readToken(token) {
  try {
    const [payload, mac, extra] = String(token).split('.');
    if (!key || !payload || !mac || extra) {
      throw new Error();
    }
    const expected = Buffer.from(signature(payload));
    const actual = Buffer.from(mac);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error();
    }
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (typeof session.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(session.id) ||
        !Number.isFinite(session.expires) || session.expires <= Date.now()) {
      throw new Error();
    }
    return session;
  } catch {
    throw new Error('Connect to Steel again. Your browser session is invalid or expired.');
  }
}

async function steel(path, body) {
  const response = await fetch('https://api.steel.dev/v1/sessions' + path, {
    method: 'POST',
    headers: { 'steel-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok && !(path && response.status === 404)) {
    throw new Error('Steel could not complete the request.');
  }
  if (!path) {
    return response.json();
  }
}

export async function attachSession(token) {
  const session = readToken(token);
  const { chromium } = await import('playwright-core');
  const endpoint = new URL('wss://connect.steel.dev');
  endpoint.searchParams.set('apiKey', key);
  endpoint.searchParams.set('sessionId', session.id);
  const browser = await chromium.connectOverCDP(endpoint.href, { timeout: 15000 });
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    throw new Error('Steel browser disconnected. Connect again.');
  }
  return { browser, context };
}

export async function releaseSession(token) {
  const session = readToken(token);
  await steel('/' + encodeURIComponent(session.id) + '/release', {});
}

export async function createSession() {
  if (!key) {
    throw new Error('Live search needs a Steel API key.');
  }
  const session = await steel('', {
    timeout: lifetime,
    headless: process.env.STEEL_HEADLESS === '1',
    dimensions: { width: 1280, height: 800 },
    debugConfig: { interactive: true },
  });
  const payload = Buffer.from(JSON.stringify({
    id: session.id,
    expires: Date.now() + lifetime,
  })).toString('base64url');
  const token = payload + '.' + signature(payload);
  let connection;
  try {
    connection = await attachSession(token);
    const page = connection.context.pages()[0] || await connection.context.newPage();
    await page.goto('https://waterlooworks.uwaterloo.ca', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    const viewer = new URL(session.debugUrl || session.sessionViewerUrl);
    if (viewer.protocol !== 'https:' || !viewer.hostname.endsWith('.steel.dev')) {
      throw new Error('Steel returned an unexpected viewer address.');
    }
    viewer.searchParams.set('interactive', 'true');
    return { token, viewer: viewer.href };
  } catch {
    await releaseSession(token).catch(() => {});
    throw new Error('Could not open a WaterlooWorks browser session.');
  } finally {
    if (connection) {
      await connection.browser.close().catch(() => {});
    }
  }
}

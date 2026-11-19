import { profileFrom } from './search.mjs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const pages = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/app.js', ['app.js', 'text/javascript']],
]);

export const server = createServer(async (request, response) => {
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

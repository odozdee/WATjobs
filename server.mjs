import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const pages = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
]);

export const server = createServer(async (request, response) => {
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

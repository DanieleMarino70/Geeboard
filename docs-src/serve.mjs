// Serves the built site, so it can be looked at before it is published.
//
//   node docs-src/build.mjs && node docs-src/serve.mjs   → http://localhost:4000
//
// node:http and a table of five content types. GitHub Pages serves these
// files the same way, and a page that needs more than this to be read is a
// page that has gone wrong somewhere.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(here, '..', 'site');
const port = Number(process.env.PORT ?? 4000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';

  // Nothing above the site directory is served, whatever the path says.
  const file = join(siteDir, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(siteDir)) {
    response.writeHead(403).end('No.');
    return;
  }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store'
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`404 ${path}\n`);
  }
}).listen(port, () => {
  console.log(`http://localhost:${port}/`);
});

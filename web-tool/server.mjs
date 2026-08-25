import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = dirname(here);
const host = '127.0.0.1';
const port = 3400;

const routes = new Map([
  ['/', { path: join(here, 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/index.html', { path: join(here, 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/report.html', { path: join(here, 'report.html'), type: 'text/html; charset=utf-8' }],
  ['/report-view.html', { path: join(here, 'report-view.html'), type: 'text/html; charset=utf-8' }],
  ['/data.html', { path: join(here, 'data.html'), type: 'text/html; charset=utf-8' }],
  ['/accounts.html', { path: join(here, 'accounts.html'), type: 'text/html; charset=utf-8' }],
  ['/app.css', { path: join(here, 'app.css'), type: 'text/css; charset=utf-8' }],
  ['/portal.css', { path: join(here, 'portal.css'), type: 'text/css; charset=utf-8' }],
  ['/report.css', { path: join(here, 'report.css'), type: 'text/css; charset=utf-8' }],
  ['/accounts.css', { path: join(here, 'accounts.css'), type: 'text/css; charset=utf-8' }],
  ['/batch-report-export.js', { path: join(here, 'batch-report-export.js'), type: 'text/javascript; charset=utf-8' }],
  ['/project.js', { path: join(here, 'project.js'), type: 'text/javascript; charset=utf-8' }],
  ['/task.js', { path: join(here, 'task.js'), type: 'text/javascript; charset=utf-8' }],
  ['/report.js', { path: join(here, 'report.js'), type: 'text/javascript; charset=utf-8' }],
  ['/accounts.js', { path: join(here, 'accounts.js'), type: 'text/javascript; charset=utf-8' }],
  ['/account-vault.js', { path: join(here, 'account-vault.js'), type: 'text/javascript; charset=utf-8' }],
  ['/diagnosis-popup.js', { path: join(extensionRoot, 'diagnosis-popup.js'), type: 'text/javascript; charset=utf-8' }],
  ['/diagnosis-spec.js', { path: join(extensionRoot, 'diagnosis-spec.js'), type: 'text/javascript; charset=utf-8' }],
  ['/xhs-contract.js', { path: join(extensionRoot, 'xhs', 'contract.js'), type: 'text/javascript; charset=utf-8' }],
  ['/xhs-metrics.js', { path: join(extensionRoot, 'xhs', 'metrics.js'), type: 'text/javascript; charset=utf-8' }],
  ['/xhs-report-model.js', { path: join(extensionRoot, 'xhs', 'report-model.js'), type: 'text/javascript; charset=utf-8' }],
  ['/xlsx.full.min.js', { path: join(extensionRoot, 'vendor', 'xlsx.full.min.js'), type: 'text/javascript; charset=utf-8' }],
]);

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (url.pathname === '/health') {
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify({ ok: true, service: 'taobao-full-chain-tool' }));
    return;
  }

  if (url.pathname === '/collect.html' && ['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.writeHead(307, {
      'Location': '/report.html' + url.search,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end();
    return;
  }

  const route = routes.get(url.pathname);
  if (!route || !['GET', 'HEAD'].includes(request.method || 'GET')) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  try {
    const body = await readFile(route.path);
    const isViewer = ['/report-view.html', '/data.html'].includes(url.pathname);
    const styleSource = isViewer
      ? "style-src 'self' 'unsafe-inline'"
      : "style-src 'self'";
    const frameAncestors = isViewer ? "frame-ancestors 'self'" : "frame-ancestors 'none'";
    response.writeHead(200, {
      'Content-Type': route.type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; " + styleSource + "; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; " + frameAncestors,
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Failed to load web tool');
  }
});

server.listen(port, host, () => {
  console.log(`Taobao full-chain tool: http://${host}:${port}`);
});

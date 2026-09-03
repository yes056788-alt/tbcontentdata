import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalCommentClassificationHandler } from './qwen-comment-classifier.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = dirname(here);
const host = '127.0.0.1';
const port = 3400;
const commentClassificationHandler = createLocalCommentClassificationHandler();

async function localFetchRequest(request, url, maximumBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > maximumBytes) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(value);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${request.headers.host || host + ':' + port}${url.pathname}`, {
    method: request.method || 'GET',
    headers: request.headers,
    body: ['GET', 'HEAD'].includes(request.method || 'GET') ? undefined : body,
  });
}

async function writeFetchResponse(response, result) {
  const headers = Object.fromEntries(result.headers.entries());
  response.writeHead(result.status, headers);
  response.end(Buffer.from(await result.arrayBuffer()));
}

const routes = new Map([
  ['/', { path: join(here, 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/index.html', { path: join(here, 'index.html'), type: 'text/html; charset=utf-8' }],
  ['/report.html', { path: join(here, 'report.html'), type: 'text/html; charset=utf-8' }],
  ['/report-view.html', { path: join(here, 'report-view.html'), type: 'text/html; charset=utf-8' }],
  ['/data.html', { path: join(here, 'data.html'), type: 'text/html; charset=utf-8' }],
  ['/accounts.html', { path: join(here, 'accounts.html'), type: 'text/html; charset=utf-8' }],
  ['/comments.html', { path: join(here, 'comments.html'), type: 'text/html; charset=utf-8' }],
  ['/app.css', { path: join(here, 'app.css'), type: 'text/css; charset=utf-8' }],
  ['/portal.css', { path: join(here, 'portal.css'), type: 'text/css; charset=utf-8' }],
  ['/report.css', { path: join(here, 'report.css'), type: 'text/css; charset=utf-8' }],
  ['/accounts.css', { path: join(here, 'accounts.css'), type: 'text/css; charset=utf-8' }],
  ['/comments.css', { path: join(here, 'comments.css'), type: 'text/css; charset=utf-8' }],
  ['/batch-report-export.js', { path: join(here, 'batch-report-export.js'), type: 'text/javascript; charset=utf-8' }],
  ['/project.js', { path: join(here, 'project.js'), type: 'text/javascript; charset=utf-8' }],
  ['/task.js', { path: join(here, 'task.js'), type: 'text/javascript; charset=utf-8' }],
  ['/report.js', { path: join(here, 'report.js'), type: 'text/javascript; charset=utf-8' }],
  ['/accounts.js', { path: join(here, 'accounts.js'), type: 'text/javascript; charset=utf-8' }],
  ['/comments.js', { path: join(here, 'comments.js'), type: 'text/javascript; charset=utf-8' }],
  ['/account-vault.js', { path: join(here, 'account-vault.js'), type: 'text/javascript; charset=utf-8' }],
  ['/diagnosis-popup.js', { path: join(extensionRoot, 'diagnosis-popup.js'), type: 'text/javascript; charset=utf-8' }],
  ['/diagnosis-spec.js', { path: join(extensionRoot, 'diagnosis-spec.js'), type: 'text/javascript; charset=utf-8' }],
  ['/xhs-contract.js', { path: join(extensionRoot, 'xhs', 'contract.js'), type: 'text/javascript; charset=utf-8' }],
  ['/xhs-metrics.js', { path: join(extensionRoot, 'xhs', 'metrics.js'), type: 'text/javascript; charset=utf-8' }],
  ['/xhs-search-classification.js', { path: join(extensionRoot, 'xhs', 'search-classification.js'), type: 'text/javascript; charset=utf-8' }],
  ['/search-classification-client.js', { path: join(here, 'search-classification-client.js'), type: 'text/javascript; charset=utf-8' }],
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

  if (url.pathname === '/api/comment-insights') {
    try {
      const localRequest = await localFetchRequest(request, url, 100_000);
      await writeFetchResponse(response, await commentClassificationHandler(localRequest));
    } catch (error) {
      response.writeHead(error && error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(JSON.stringify({ error: {
        code: error && error.message === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'COMMENT_INSIGHTS_UNAVAILABLE',
        message: error && error.message === 'PAYLOAD_TOO_LARGE'
          ? '请求内容不能超过 100000 字节。'
          : '评论分类服务暂时不可用。',
        retryable: error && error.message !== 'PAYLOAD_TOO_LARGE',
      } }));
    }
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

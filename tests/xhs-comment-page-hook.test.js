const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const hookPath = path.join(root, 'xhs-comment-page-hook.js');
const ORIGIN = 'https://www.xiaohongshu.com';
const SOURCE = 'xhs-comment-page-hook-v1';
const CAPTURE_TYPE = 'XHS_COMMENT_API_CAPTURE';

function flushTasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function evaluateHook(options = {}) {
  const source = fs.readFileSync(hookPath, 'utf8');
  const origin = options.origin || ORIGIN;
  const topFrame = options.topFrame !== false;
  const posted = [];
  const fetchRequests = [];

  class FakeResponse {
    constructor(body, responseOptions = {}) {
      this.body = body;
      this.ok = responseOptions.ok !== false;
      this.status = responseOptions.status || 200;
      this.cloneError = responseOptions.cloneError;
    }

    clone() {
      if (this.cloneError) throw this.cloneError;
      const body = this.body;
      return {
        async text() {
          return typeof body === 'string' ? body : JSON.stringify(body);
        },
      };
    }
  }

  function originalFetch(input, init) {
    const request = { input, init, receiver: this };
    fetchRequests.push(request);
    return Promise.resolve(options.fetchResponse || new FakeResponse({ code: 0, data: {} }));
  }

  class FakeXMLHttpRequest {
    constructor() {
      this.listeners = new Map();
      this.response = null;
      this.responseText = '';
      this.responseType = '';
      this.status = 0;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }

    send(body) {
      this.sentBody = body;
    }

    emit(type) {
      for (const listener of this.listeners.get(type) || []) listener.call(this);
    }
  }

  const location = {
    href: `${origin}/explore/fixture-note`,
    origin,
  };
  const windowObject = {
    Date,
    XMLHttpRequest: FakeXMLHttpRequest,
    fetch: originalFetch,
    location,
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
    },
  };
  windowObject.self = windowObject;
  windowObject.top = topFrame ? windowObject : { frame: 'parent' };
  windowObject.window = windowObject;

  const context = vm.createContext({
    Date,
    JSON,
    Promise,
    Reflect,
    TextEncoder,
    URL,
    XMLHttpRequest: FakeXMLHttpRequest,
    console: { debug() {}, error() {}, info() {}, log() {}, warn() {} },
    location,
    queueMicrotask,
    self: windowObject,
    top: windowObject.top,
    window: windowObject,
  });

  vm.runInContext(source, context, { filename: hookPath });
  return {
    FakeResponse,
    FakeXMLHttpRequest,
    context,
    fetchRequests,
    originalFetch,
    posted,
    source,
    windowObject,
    async flush() {
      for (let index = 0; index < 4; index += 1) await flushTasks();
    },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('comment page hook installs once only in an exact top-level Xiaohongshu origin', () => {
  const evaluated = evaluateHook();
  const patchedFetch = evaluated.windowObject.fetch;
  const patchedOpen = evaluated.FakeXMLHttpRequest.prototype.open;

  vm.runInContext(evaluated.source, evaluated.context, { filename: hookPath });
  assert.equal(evaluated.windowObject.fetch, patchedFetch);
  assert.equal(evaluated.FakeXMLHttpRequest.prototype.open, patchedOpen);

  for (const origin of [
    'http://www.xiaohongshu.com',
    'https://evil.www.xiaohongshu.com',
    'https://pgy.xiaohongshu.com',
  ]) {
    const invalid = evaluateHook({ origin });
    assert.equal(invalid.windowObject.fetch, invalid.originalFetch, origin);
  }
  const childFrame = evaluateHook({ topFrame: false });
  assert.equal(childFrame.windowObject.fetch, childFrame.originalFetch);
});

test('fetch responses are observed without changing the original response or reading request secrets', async () => {
  const body = {
    code: 0,
    data: {
      comments: [{ id: 'comment-1', content: '想买' }],
      cursor: 'next-cursor',
      has_more: true,
    },
  };
  const response = {
    ok: true,
    status: 200,
    clone() {
      return { async text() { return JSON.stringify(body); } };
    },
  };
  const evaluated = evaluateHook({ fetchResponse: response });
  const request = {
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-1&cursor=&xsec_token=fixture-secret',
    get headers() {
      throw new Error('the passive hook must never read request headers');
    },
  };

  const returned = await evaluated.windowObject.fetch.call(
    { receiver: 'fixture' },
    request,
    { headers: { authorization: 'Bearer fixture-secret' } },
  );
  await evaluated.flush();

  assert.equal(returned, response);
  assert.equal(evaluated.fetchRequests.length, 1);
  assert.equal(evaluated.fetchRequests[0].input, request);
  assert.equal(evaluated.posted.length, 1);
  const capture = evaluated.posted[0];
  assert.equal(capture.targetOrigin, ORIGIN);
  assert.deepEqual(plain(capture.message.body), body);
  assert.equal(capture.message.source, SOURCE);
  assert.equal(capture.message.type, CAPTURE_TYPE);
  assert.equal(capture.message.endpointKind, 'root');
  assert.equal(typeof capture.message.capturedAt, 'number');
  assert.match(capture.message.url, /note_id=note-1/);
  assert.equal(capture.message.url.includes('xsec_token'), false);
  assert.equal(JSON.stringify(capture.message).includes('fixture-secret'), false);
  assert.deepEqual(
    Object.keys(capture.message).sort(),
    ['body', 'capturedAt', 'endpointKind', 'source', 'type', 'url'].sort(),
  );
});

test('XHR sub-comment JSON responses are observed while open and send stay transparent', async () => {
  const evaluated = evaluateHook();
  const xhr = new evaluated.windowObject.XMLHttpRequest();
  const body = {
    code: 0,
    data: { comments: [{ id: 'reply-1', content: '回复' }], has_more: false },
  };

  const openResult = xhr.open(
    'GET',
    '/api/sns/web/v2/comment/sub/page?note_id=note-1&root_comment_id=comment-1&cursor=sub-2&xsec_token=secret',
  );
  const sendResult = xhr.send(null);
  xhr.status = 200;
  xhr.responseType = 'json';
  xhr.response = body;
  xhr.emit('load');
  await evaluated.flush();

  assert.equal(openResult, undefined);
  assert.equal(sendResult, undefined);
  assert.equal(xhr.method, 'GET');
  assert.equal(xhr.sentBody, null);
  assert.equal(evaluated.posted.length, 1);
  assert.equal(evaluated.posted[0].message.endpointKind, 'sub');
  assert.deepEqual(plain(evaluated.posted[0].message.body), body);
  assert.match(evaluated.posted[0].message.url, /root_comment_id=comment-1/);
  assert.equal(evaluated.posted[0].message.url.includes('xsec_token'), false);
});

test('non-target, malformed, oversized, and sensitive response data is never forwarded', async () => {
  const evaluated = evaluateHook();

  await evaluated.windowObject.fetch(
    'https://www.xiaohongshu.com/api/not-comment?next=/api/sns/web/v2/comment/page',
  );
  await evaluated.flush();
  assert.equal(evaluated.posted.length, 0);

  const malformed = new evaluated.FakeResponse('{not-json');
  evaluated.windowObject.fetch = evaluated.windowObject.fetch;
  evaluated.context.window.fetch = evaluated.windowObject.fetch;
  evaluated.fetchRequests.length = 0;
  // A fresh context keeps the fixture response deterministic for each edge case.
  const malformedRun = evaluateHook({ fetchResponse: malformed });
  await malformedRun.windowObject.fetch('/api/sns/web/v2/comment/page?note_id=note-1');
  await malformedRun.flush();
  assert.equal(malformedRun.posted.length, 0);

  const oversizedBody = JSON.stringify({ data: 'x'.repeat((2 * 1024 * 1024) + 1) });
  const oversizedRun = evaluateHook({
    fetchResponse: new evaluated.FakeResponse(oversizedBody),
  });
  await oversizedRun.windowObject.fetch('/api/sns/web/v2/comment/page?note_id=note-1');
  await oversizedRun.flush();
  assert.equal(oversizedRun.posted.length, 0);

  const sensitiveRun = evaluateHook({
    fetchResponse: new evaluated.FakeResponse({
      code: 0,
      data: {
        comments: [{ id: 'comment-1', content: '保留的评论文本' }],
        xsec_token: 'response-secret',
        nested: { authorization: 'Bearer response-secret', cursor: 'safe-cursor' },
      },
    }),
  });
  await sensitiveRun.windowObject.fetch('/api/sns/web/v2/comment/page?note_id=note-1');
  await sensitiveRun.flush();
  assert.equal(sensitiveRun.posted.length, 1);
  const serialized = JSON.stringify(sensitiveRun.posted[0].message);
  assert.equal(serialized.includes('response-secret'), false);
  assert.equal(sensitiveRun.posted[0].message.body.data.xsec_token, undefined);
  assert.equal(sensitiveRun.posted[0].message.body.data.nested.authorization, undefined);
  assert.equal(sensitiveRun.posted[0].message.body.data.nested.cursor, 'safe-cursor');
});

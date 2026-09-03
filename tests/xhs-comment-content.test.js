const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const contentPath = path.join(root, 'xhs-comment-content.js');
const ORIGIN = 'https://www.xiaohongshu.com';
const PAGE_SOURCE = 'xhs-comment-page-hook-v1';
const CONTENT_SOURCE = 'xhs-comment-content-v1';
const CAPTURE_TYPE = 'XHS_COMMENT_API_CAPTURE';
const COMMAND_TYPE = 'XHS_COMMENT_PAGE_COMMAND';

function flushTasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function evaluateContent(options = {}) {
  const source = fs.readFileSync(contentPath, 'utf8');
  const origin = options.origin || ORIGIN;
  const topFrame = options.topFrame !== false;
  const extensionId = 'fixture-extension-id';
  const windowListeners = [];
  const runtimeListeners = [];
  const sentMessages = [];
  const scrollCalls = [];
  const containerScrollCalls = [];
  const queriedSelectors = [];
  let clicked = 0;

  const clickable = {
    click() {
      clicked += 1;
    },
  };
  const failingClickable = {
    click() {
      throw new Error('detached fixture control');
    },
  };
  const scrollContainer = {
    clientHeight: 700,
    scrollHeight: 2400,
    scrollTop: 0,
    scrollBy(optionsValue) {
      containerScrollCalls.push(optionsValue);
    },
  };
  const document = {
    querySelector(selector) {
      queriedSelectors.push(selector);
      if (selector === '.note-scroller') {
        return options.scrollContainer === false ? null : scrollContainer;
      }
      if (options.firstExpandFails && selector === '.comments-container .show-more') {
        return failingClickable;
      }
      return options.expandControl === false ? null : clickable;
    },
  };
  const location = {
    href: `${origin}/explore/fixture-note`,
    origin,
  };
  const chrome = {
    runtime: {
      id: extensionId,
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        },
      },
      sendMessage(message) {
        sentMessages.push(message);
        return Promise.resolve({ ok: true });
      },
    },
  };
  const windowObject = {
    addEventListener(type, listener) {
      if (type === 'message') windowListeners.push(listener);
    },
    innerHeight: 1000,
    location,
    scrollBy(optionsValue) {
      scrollCalls.push(optionsValue);
    },
  };
  windowObject.self = windowObject;
  windowObject.top = topFrame ? windowObject : { frame: 'parent' };
  windowObject.window = windowObject;

  const context = vm.createContext({
    Date,
    JSON,
    Math,
    Promise,
    TextEncoder,
    URL,
    chrome,
    console: { debug() {}, error() {}, info() {}, log() {}, warn() {} },
    document,
    location,
    self: windowObject,
    top: windowObject.top,
    window: windowObject,
  });
  vm.runInContext(source, context, { filename: contentPath });

  return {
    chrome,
    context,
    document,
    extensionId,
    get clicked() { return clicked; },
    location,
    containerScrollCalls,
    queriedSelectors,
    runtimeListeners,
    scrollCalls,
    sentMessages,
    source,
    windowListeners,
    windowObject,
    async dispatchPage(data, eventOverrides = {}) {
      const event = Object.assign({ data, origin, source: windowObject }, eventOverrides);
      for (const listener of windowListeners) listener(event);
      await flushTasks();
    },
    dispatchRuntime(message, senderOverrides = {}) {
      const responses = [];
      const sender = Object.assign({ id: extensionId }, senderOverrides);
      const returns = runtimeListeners.map((listener) => listener(
        message,
        sender,
        (response) => responses.push(response),
      ));
      return { responses, returns };
    },
  };
}

function capture(overrides = {}) {
  return Object.assign({
    source: PAGE_SOURCE,
    type: CAPTURE_TYPE,
    endpointKind: 'root',
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-1&cursor=next',
    capturedAt: Date.now(),
    body: { code: 0, data: { comments: [{ id: 'comment-1', content: '想买' }] } },
  }, overrides);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('comment content bridge installs once only in an exact top-level Xiaohongshu origin', () => {
  const evaluated = evaluateContent();
  assert.equal(evaluated.windowListeners.length, 1);
  assert.equal(evaluated.runtimeListeners.length, 1);

  vm.runInContext(evaluated.source, evaluated.context, { filename: contentPath });
  assert.equal(evaluated.windowListeners.length, 1);
  assert.equal(evaluated.runtimeListeners.length, 1);

  for (const origin of [
    'http://www.xiaohongshu.com',
    'https://evil.www.xiaohongshu.com',
    'https://pgy.xiaohongshu.com',
  ]) {
    const invalid = evaluateContent({ origin });
    assert.equal(invalid.windowListeners.length, 0, origin);
    assert.equal(invalid.runtimeListeners.length, 0, origin);
  }
  const childFrame = evaluateContent({ topFrame: false });
  assert.equal(childFrame.windowListeners.length, 0);
  assert.equal(childFrame.runtimeListeners.length, 0);
});

test('validated same-window captures are sanitized and forwarded to the extension runtime', async () => {
  const evaluated = evaluateContent();
  await evaluated.dispatchPage(capture({
    url: 'https://edith.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=note-1&cursor=next&xsec_token=secret',
  }));

  assert.equal(evaluated.sentMessages.length, 1);
  const forwarded = evaluated.sentMessages[0];
  assert.equal(forwarded.source, CONTENT_SOURCE);
  assert.equal(forwarded.type, CAPTURE_TYPE);
  assert.equal(forwarded.endpointKind, 'root');
  assert.equal(forwarded.capturedAt > 0, true);
  assert.deepEqual(plain(forwarded.body), capture().body);
  assert.equal(forwarded.url.includes('xsec_token'), false);
  assert.equal(JSON.stringify(forwarded).includes('secret'), false);
  assert.deepEqual(
    Object.keys(forwarded).sort(),
    ['body', 'capturedAt', 'endpointKind', 'source', 'type', 'url'].sort(),
  );
});

test('forged, mismatched, malformed, and oversized capture messages are ignored', async () => {
  const evaluated = evaluateContent();
  const cases = [
    { data: capture({ source: 'attacker-page' }) },
    { data: capture({ type: 'OTHER_TYPE' }) },
    { data: capture({ endpointKind: 'sub' }) },
    { data: capture({ capturedAt: 'now' }) },
    { data: capture({ body: null }) },
    { data: capture({ url: 'https://attacker.example/api/sns/web/v2/comment/page?note_id=note-1' }) },
    { data: capture({ url: 'https://edith.xiaohongshu.com/not-comment?next=/api/sns/web/v2/comment/page' }) },
    { data: capture({ body: { data: 'x'.repeat((2 * 1024 * 1024) + 1) } }) },
    { data: capture(), event: { source: {} } },
    { data: capture(), event: { origin: 'https://attacker.example' } },
  ];

  for (const entry of cases) await evaluated.dispatchPage(entry.data, entry.event);
  assert.equal(evaluated.sentMessages.length, 0);
});

test('advance commands scroll and click an allowlisted expander without reading comment text', () => {
  const evaluated = evaluateContent();
  const result = evaluated.dispatchRuntime({
    type: COMMAND_TYPE,
    command: 'advance',
    requestId: 'advance-1',
  });

  assert.deepEqual(plain(result.responses), [{
    ok: true,
    requestId: 'advance-1',
    advanced: true,
    clicked: true,
    stopped: false,
  }]);
  assert.equal(evaluated.scrollCalls.length, 1);
  assert.deepEqual(plain(evaluated.scrollCalls[0]), {
    top: 800,
    left: 0,
    behavior: 'smooth',
  });
  assert.deepEqual(plain(evaluated.containerScrollCalls), [{
    top: 600,
    left: 0,
    behavior: 'smooth',
  }]);
  assert.equal(evaluated.queriedSelectors.length > 0, true);
  assert.equal(evaluated.clicked, 1);
  assert.equal(result.returns[0], false);
});

test('advance commands keep the window fallback when the comment scroller is unavailable', () => {
  const evaluated = evaluateContent({ scrollContainer: false, expandControl: false });
  const result = evaluated.dispatchRuntime({
    type: COMMAND_TYPE,
    command: 'advance',
    requestId: 'advance-fallback',
  });

  assert.equal(result.responses[0].ok, true);
  assert.equal(result.responses[0].clicked, false);
  assert.deepEqual(evaluated.containerScrollCalls, []);
  assert.equal(evaluated.scrollCalls.length, 1);
});

test('advance commands continue to the next allowlisted expander after a stale control fails', () => {
  const evaluated = evaluateContent({ firstExpandFails: true });
  const result = evaluated.dispatchRuntime({
    type: COMMAND_TYPE,
    command: 'advance',
    requestId: 'advance-stale-control',
  });

  assert.equal(result.responses[0].clicked, true);
  assert.equal(evaluated.clicked, 1);
  assert.equal(evaluated.queriedSelectors.includes('.comments-container .load-more'), true);
});

test('stop commands disable subsequent capture forwarding and page advancement', async () => {
  const evaluated = evaluateContent();
  const stopped = evaluated.dispatchRuntime({
    type: COMMAND_TYPE,
    command: 'stop',
    requestId: 'stop-1',
  });
  assert.deepEqual(plain(stopped.responses), [{
    ok: true,
    requestId: 'stop-1',
    stopped: true,
  }]);

  await evaluated.dispatchPage(capture());
  assert.equal(evaluated.sentMessages.length, 0);

  const advance = evaluated.dispatchRuntime({
    type: COMMAND_TYPE,
    command: 'advance',
    requestId: 'advance-after-stop',
  });
  assert.deepEqual(plain(advance.responses), [{
    ok: false,
    requestId: 'advance-after-stop',
    code: 'XHS_COMMENT_CAPTURE_STOPPED',
    stopped: true,
  }]);
  assert.equal(evaluated.scrollCalls.length, 0);
  assert.equal(evaluated.clicked, 0);
});

test('commands from unknown senders or with unknown actions are not handled', () => {
  const evaluated = evaluateContent();
  const unknownSender = evaluated.dispatchRuntime(
    { type: COMMAND_TYPE, command: 'advance' },
    { id: 'attacker-extension' },
  );
  const unknownCommand = evaluated.dispatchRuntime({
    type: COMMAND_TYPE,
    command: 'fetch-api-directly',
  });

  assert.deepEqual(unknownSender.responses, []);
  assert.deepEqual(unknownCommand.responses, []);
  assert.deepEqual(unknownSender.returns, [false]);
  assert.deepEqual(unknownCommand.returns, [false]);
  assert.equal(evaluated.scrollCalls.length, 0);
});

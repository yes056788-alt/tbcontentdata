(function installXhsCommentContentBridge() {
  'use strict';

  const PAGE_ORIGINS = Object.freeze([
    'https://www.xiaohongshu.com',
    'https://edith.xiaohongshu.com',
  ]);
  if (self !== top || !PAGE_ORIGINS.includes(location.origin)) return;

  const INSTALL_FLAG = '__taobaoDataAssistantXhsCommentContentV1';
  if (window[INSTALL_FLAG]) return;
  Object.defineProperty(window, INSTALL_FLAG, { value: true });

  const PAGE_SOURCE = 'xhs-comment-page-hook-v1';
  const CONTENT_SOURCE = 'xhs-comment-content-v1';
  const CAPTURE_TYPE = 'XHS_COMMENT_API_CAPTURE';
  const COMMAND_TYPE = 'XHS_COMMENT_PAGE_COMMAND';
  const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
  const ENDPOINT_KIND_BY_PATH = Object.freeze({
    '/api/sns/web/v2/comment/page': 'root',
    '/api/sns/web/v2/comment/sub/page': 'sub',
  });
  const SAFE_QUERY_KEYS = Object.freeze(new Set([
    'note_id',
    'cursor',
    'root_comment_id',
    'top_comment_id',
    'num',
    'image_formats',
  ]));
  const EXPAND_SELECTORS = Object.freeze([
    '.comments-container .show-more',
    '.comments-container .load-more',
    '.comment-list .show-more',
    '.comment-list .load-more',
    '[class*="comment"] [class~="show-more"]',
    '[class*="comment"] [class~="load-more"]',
    '[data-testid="comment-replies-more"]',
  ]);
  const COMMENT_SCROLLER_SELECTORS = Object.freeze([
    '.note-scroller',
    '.interaction-container',
    '.comments-container',
    '.comment-list',
    '[class*="comment"][class*="scroll"]',
  ]);
  let stopped = false;

  function payloadBytes(value) {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch (error) {
      return Infinity;
    }
  }

  function isSensitiveKey(key) {
    const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized.includes('token') || normalized.includes('cookie') ||
      normalized.includes('authorization') || normalized.includes('signature') ||
      normalized.includes('password') || normalized.includes('credential') ||
      normalized.includes('xsec');
  }

  function safeBody(value) {
    if (!value || typeof value !== 'object' || payloadBytes(value) > MAX_RESPONSE_BYTES) return null;
    try {
      const text = JSON.stringify(value);
      const parsed = JSON.parse(text, (key, item) => (isSensitiveKey(key) ? undefined : item));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function safeEndpoint(rawUrl) {
    let parsed;
    try {
      parsed = new URL(String(rawUrl || ''), location.href);
    } catch (error) {
      return null;
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        !PAGE_ORIGINS.includes(parsed.origin)) {
      return null;
    }
    const endpointKind = ENDPOINT_KIND_BY_PATH[parsed.pathname];
    if (!endpointKind) return null;

    const safeUrl = new URL(parsed.pathname, parsed.origin);
    for (const [key, value] of parsed.searchParams.entries()) {
      if (!SAFE_QUERY_KEYS.has(key) || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) {
        continue;
      }
      safeUrl.searchParams.append(key, value);
    }
    return { endpointKind, url: safeUrl.toString() };
  }

  function validCapturedAt(value) {
    return Number.isFinite(value) && Number.isInteger(value) && value > 0;
  }

  window.addEventListener('message', (event) => {
    if (stopped || event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.source !== PAGE_SOURCE || message.type !== CAPTURE_TYPE) return;
    if (!validCapturedAt(message.capturedAt)) return;

    const endpoint = safeEndpoint(message.url);
    if (!endpoint || message.endpointKind !== endpoint.endpointKind) return;
    const body = safeBody(message.body);
    if (!body) return;

    try {
      const pending = chrome.runtime.sendMessage({
        source: CONTENT_SOURCE,
        type: CAPTURE_TYPE,
        endpointKind: endpoint.endpointKind,
        url: endpoint.url,
        capturedAt: message.capturedAt,
        body,
      });
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (error) {
      // Extension reloads can invalidate runtime while an existing page remains open.
    }
  });

  function safeRequestId(value) {
    const text = String(value == null ? '' : value).trim();
    return text && text.length <= 128 && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
  }

  function commandResponse(requestId, fields) {
    const response = Object.assign({}, fields);
    if (requestId) response.requestId = requestId;
    return response;
  }

  function advancePage() {
    const viewportHeight = Number(window.innerHeight) || 0;
    let scrolledContainer = false;
    for (const selector of COMMENT_SCROLLER_SELECTORS) {
      let scroller = null;
      try {
        scroller = document.querySelector(selector);
      } catch (error) {
        scroller = null;
      }
      if (!scroller) continue;
      const scrollHeight = Number(scroller.scrollHeight) || 0;
      const clientHeight = Number(scroller.clientHeight) || 0;
      if (scrollHeight <= clientHeight || clientHeight <= 0) continue;
      const top = Math.max(600, Math.round(clientHeight * 0.8));
      try {
        if (typeof scroller.scrollBy === 'function') {
          scroller.scrollBy({ top, left: 0, behavior: 'smooth' });
        } else {
          const maximum = Math.max(0, scrollHeight - clientHeight);
          scroller.scrollTop = Math.min(maximum, (Number(scroller.scrollTop) || 0) + top);
        }
        scrolledContainer = true;
      } catch (error) {
        scrolledContainer = false;
      }
      if (scrolledContainer) break;
    }

    window.scrollBy({
      top: Math.max(600, Math.round(viewportHeight * 0.8)),
      left: 0,
      behavior: 'smooth',
    });

    let clicked = false;
    for (const selector of EXPAND_SELECTORS) {
      let control = null;
      try {
        control = document.querySelector(selector);
      } catch (error) {
        control = null;
      }
      if (!control || typeof control.click !== 'function') continue;
      try {
        control.click();
        clicked = true;
      } catch (error) {
        clicked = false;
      }
      if (clicked) break;
    }
    return clicked;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== COMMAND_TYPE || !sender || sender.id !== chrome.runtime.id) {
      return false;
    }
    const requestId = safeRequestId(message.requestId);
    if (message.command === 'stop') {
      stopped = true;
      sendResponse(commandResponse(requestId, { ok: true, stopped: true }));
      return false;
    }
    if (message.command !== 'advance') return false;
    if (stopped) {
      sendResponse(commandResponse(requestId, {
        ok: false,
        code: 'XHS_COMMENT_CAPTURE_STOPPED',
        stopped: true,
      }));
      return false;
    }

    const clicked = advancePage();
    sendResponse(commandResponse(requestId, {
      ok: true,
      advanced: true,
      clicked,
      stopped: false,
    }));
    return false;
  });
})();

(function initXhsCommentCaptureCoordinator(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsCommentCaptureCoordinator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  'use strict';

  const CAPTURE_TYPE = 'XHS_COMMENT_API_CAPTURE';
  const CAPTURE_SOURCE = 'xhs-comment-content-v1';
  const COMMAND_TYPE = 'XHS_COMMENT_PAGE_COMMAND';
  const OFFICIAL_ORIGIN = 'https://www.xiaohongshu.com';
  const API_ORIGINS = new Set([
    'https://www.xiaohongshu.com',
    'https://edith.xiaohongshu.com',
  ]);
  const ENDPOINT_PATHS = Object.freeze({
    root: '/api/sns/web/v2/comment/page',
    sub: '/api/sns/web/v2/comment/sub/page',
  });
  const COMMENT_ARRAY_KEYS = Object.freeze([
    'comments', 'comment_list', 'commentList', 'items', 'list',
    'sub_comments', 'subComments', 'replies',
  ]);

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function clone(value) {
    if (value === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return undefined; }
  }

  function cleanText(value, maximum) {
    return String(value == null ? '' : value).trim().slice(0, maximum || 5000);
  }

  function booleanValue(value) {
    if (value === true || value === 1 || value === '1' || value === 'true') return true;
    if (value === false || value === 0 || value === '0' || value === 'false') return false;
    return null;
  }

  function captureError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    error.retryable = !['OFFICIAL_NOTE_URL_INVALID', 'COMMENT_CAPTURE_CONFIG_INVALID'].includes(code);
    error.zeroResult = false;
    Object.assign(error, object(details));
    return error;
  }

  function commentId(value) {
    const source = object(value);
    return cleanText(source.commentId || source.comment_id || source.id, 240);
  }

  function rootCommentId(value) {
    const source = object(value);
    return cleanText(source.rootCommentId || source.root_comment_id || source.root_id, 240);
  }

  function parseOfficialUrl(value, expectedNoteId) {
    let parsed;
    try { parsed = new URL(cleanText(value, 5000)); } catch (error) { parsed = null; }
    if (!parsed || parsed.origin !== OFFICIAL_ORIGIN || parsed.protocol !== 'https:' ||
        parsed.username || parsed.password) {
      throw captureError('OFFICIAL_NOTE_URL_INVALID', '笔记链接不是安全的小红书官方链路。');
    }
    const matched = /^\/(?:explore|discovery\/item)\/([^/?#]+)\/?$/.exec(parsed.pathname);
    if (!matched) {
      throw captureError('OFFICIAL_NOTE_URL_INVALID', '笔记链接不是可打开的小红书笔记页。');
    }
    let pathNoteId = matched[1];
    try { pathNoteId = decodeURIComponent(pathNoteId); } catch (error) { /* keep encoded id */ }
    if (expectedNoteId && pathNoteId !== expectedNoteId) {
      throw captureError('OFFICIAL_NOTE_URL_INVALID', '官方链接与待抓取笔记 noteId 不一致。');
    }
    return parsed.toString();
  }

  function parseCaptureUrl(value, endpointKind, expectedNoteId) {
    let parsed;
    try { parsed = new URL(cleanText(value, 5000)); } catch (error) { return null; }
    if (!API_ORIGINS.has(parsed.origin) || parsed.protocol !== 'https:' ||
        parsed.username || parsed.password || ENDPOINT_PATHS[endpointKind] !== parsed.pathname) {
      return null;
    }
    const noteId = cleanText(parsed.searchParams.get('note_id'), 240);
    if (!noteId || noteId !== expectedNoteId) return null;
    return {
      noteId,
      requestCursor: cleanText(parsed.searchParams.get('cursor'), 1000),
      rootCommentId: cleanText(
        parsed.searchParams.get('root_comment_id') || parsed.searchParams.get('top_comment_id'),
        240,
      ),
    };
  }

  function bodyMessage(body) {
    const source = object(body);
    const data = object(source.data);
    const error = object(source.error);
    return cleanText(
      source.msg || source.message || source.error_msg || source.errorMessage ||
      data.msg || data.message || error.message || error.msg,
      1000,
    );
  }

  function explicitBodyError(body) {
    const source = object(body);
    const codeValue = source.code !== undefined ? source.code
      : source.error_code !== undefined ? source.error_code
        : source.errorCode !== undefined ? source.errorCode : '';
    const codeText = cleanText(codeValue, 80);
    const message = bodyMessage(source);
    const combined = `${codeText} ${message}`;
    const isFailure = source.success === false || source.ok === false ||
      (codeText && !['0', '200', 'success', 'SUCCESS'].includes(codeText));
    if (!isFailure) return null;

    if (/captcha|verify|verification|risk|security|\u9a8c\u8bc1|\u9a8c\u8bc1\u7801|\u6ed1\u5757|\u98ce\u9669|\u5b89\u5168/i.test(combined) ||
        ['-110', '300015', '461'].includes(codeText)) {
      return captureError('VERIFICATION_REQUIRED', message || '小红书需要人工安全验证。');
    }
    if (/rate|limit|too many|frequen|\u9891\u7e41|\u9650\u6d41|\u7a0d\u540e/i.test(combined) ||
        ['429', '300013'].includes(codeText)) {
      return captureError('RATE_LIMITED', message || '小红书评论接口已限流。');
    }
    if (/login|log in|auth|unauthor|\u767b\u5f55|\u8eab\u4efd|\u6388\u6743/i.test(combined) ||
        ['401', '403', '-100', '-101'].includes(codeText)) {
      return captureError('LOGIN_REQUIRED', message || '需要重新登录小红书。');
    }
    return captureError('COMMENT_PLATFORM_API_ERROR', message || `小红书评论接口返回异常（${codeText || '未知错误'}）。`, {
      platformCode: codeText,
    });
  }

  function navigationError(value) {
    const url = cleanText(value, 5000);
    if (!url) return null;
    let signal = url;
    try {
      const parsed = new URL(url);
      signal = `${parsed.pathname} ${parsed.searchParams.get('error') || ''} ` +
        `${parsed.searchParams.get('reason') || ''} ${parsed.searchParams.get('code') || ''}`;
    } catch (error) {
      // A partial navigation string is still useful as a best-effort page signal.
    }
    if (/captcha|verification|verify|risk|security|\u9a8c\u8bc1|\u6ed1\u5757/i.test(signal)) {
      return captureError('VERIFICATION_REQUIRED', '小红书笔记页进入了安全验证。');
    }
    if (/rate.?limit|too.?many|frequent|\u9650\u6d41|\u9891\u7e41/i.test(signal)) {
      return captureError('RATE_LIMITED', '小红书笔记页因限流暂停。');
    }
    if (/(?:^|\/)login(?:\/|\s|$)|passport|signin|auth\/login/i.test(signal)) {
      return captureError('LOGIN_REQUIRED', '小红书登录已失效。');
    }
    if (/\/404(?:[/?#]|$)|note.?unavailable/i.test(signal)) {
      return captureError('NOTE_UNAVAILABLE', '当前笔记暂时无法浏览。');
    }
    return null;
  }

  function payloadCandidates(body) {
    const source = object(body);
    const result = [];
    const append = (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || result.includes(value)) return;
      result.push(value);
    };
    append(source.data);
    append(object(source.data).data);
    append(source.result);
    append(object(source.result).data);
    append(source);
    return result;
  }

  function firstArray(candidates) {
    for (const candidate of candidates) {
      for (const key of COMMENT_ARRAY_KEYS) {
        if (Array.isArray(candidate[key])) return candidate[key];
      }
    }
    return [];
  }

  function firstValue(candidates, keys) {
    for (const candidate of candidates) {
      for (const key of keys) {
        if (candidate[key] !== undefined && candidate[key] !== null) return candidate[key];
      }
    }
    return undefined;
  }

  function parsePageBody(body) {
    const candidates = payloadCandidates(body);
    const cursor = cleanText(firstValue(candidates, [
      'cursor', 'next_cursor', 'nextCursor', 'page_cursor', 'pageCursor',
    ]), 1000);
    const hasMore = booleanValue(firstValue(candidates, [
      'has_more', 'hasMore', 'has_next', 'hasNext', 'more',
    ]));
    return { comments: firstArray(candidates), cursor, hasMore };
  }

  function nestedReplies(comment) {
    const source = object(comment);
    for (const key of ['sub_comments', 'subComments', 'replies', 'children']) {
      if (Array.isArray(source[key])) return source[key];
    }
    return [];
  }

  function subCommentHasMore(comment, nestedCount) {
    const source = object(comment);
    const explicit = booleanValue(
      source.sub_comment_has_more !== undefined
        ? source.sub_comment_has_more : source.subCommentHasMore,
    );
    if (explicit !== null) return explicit;
    const total = Number(source.sub_comment_count !== undefined
      ? source.sub_comment_count : source.subCommentCount);
    return Number.isFinite(total) && total > nestedCount;
  }

  function annotateComment(value, noteId, rootId, parentId) {
    const item = Object.assign({}, object(clone(value)));
    if (!item.note_id && !item.noteId) item.note_id = noteId;
    if (rootId && !rootCommentId(item)) item.root_comment_id = rootId;
    if (parentId && !item.parent_comment_id && !item.parentCommentId) {
      item.parent_comment_id = parentId;
    }
    return item;
  }

  function normalizedSubState(value) {
    if (typeof value === 'string') return { cursor: cleanText(value, 1000), hasMore: true };
    const source = object(value);
    return {
      cursor: cleanText(source.cursor || source.nextCursor, 1000),
      hasMore: source.hasMore === true || source.has_more === true,
    };
  }

  function createCommentCaptureCoordinator(options) {
    const settings = object(options);
    const chromeApi = settings.chrome;
    if (!chromeApi || !chromeApi.runtime || !chromeApi.tabs ||
        typeof chromeApi.tabs.query !== 'function' ||
        typeof chromeApi.tabs.create !== 'function' ||
        typeof chromeApi.tabs.update !== 'function' ||
        typeof chromeApi.tabs.sendMessage !== 'function') {
      throw captureError('COMMENT_CAPTURE_CONFIG_INVALID', '评论抓取协调器缺少 Chrome tabs/runtime 能力。');
    }
    const now = typeof settings.now === 'function' ? settings.now : Date.now;
    const timeoutMs = Math.max(10, Number(settings.timeoutMs) || 45000);
    const settleMs = Math.max(0, Number(settings.settleMs) || 500);
    const advanceIntervalMs = Math.max(20, Number(settings.advanceIntervalMs) || 750);
    const sessions = new Map();
    const ownedWorkerTabIds = new Set();
    let registered = false;
    let requestSequence = 0;

    function clearSessionTimers(session) {
      clearTimeout(session.timeoutTimer);
      clearTimeout(session.settleTimer);
      clearTimeout(session.advanceTimer);
      session.timeoutTimer = null;
      session.settleTimer = null;
      session.advanceTimer = null;
    }

    function sendCommand(session, command) {
      const requestId = `comment-capture-${++requestSequence}`;
      try {
        return Promise.resolve(chromeApi.tabs.sendMessage(session.tabId, {
          type: COMMAND_TYPE,
          command,
          requestId,
        })).catch(() => null);
      } catch (error) {
        return Promise.resolve(null);
      }
    }

    function cleanup(session) {
      if (session.finished) return false;
      session.finished = true;
      clearSessionTimers(session);
      if (sessions.get(session.tabId) === session) sessions.delete(session.tabId);
      sendCommand(session, 'stop');
      return true;
    }

    function checkpointFor(session) {
      const subCursors = {};
      for (const [rootId, state] of session.subStates.entries()) {
        subCursors[rootId] = { cursor: state.cursor, hasMore: state.hasMore === true };
      }
      return {
        rootCursor: session.rootCursor,
        rootHasMore: session.rootHasMore === true,
        subCursors,
        capturedCount: session.comments.length,
        updatedAt: new Date(Number(now()) || Date.now()).toISOString(),
      };
    }

    function resultFor(session, complete, stopReason, extra) {
      return Object.assign({
        comments: clone(session.comments),
        complete: complete === true,
        stopReason,
        checkpoint: checkpointFor(session),
        tabId: session.tabId,
      }, object(extra));
    }

    function resolveSession(session, complete, stopReason, extra) {
      if (!cleanup(session)) return;
      session.resolve(resultFor(session, complete, stopReason, extra));
    }

    function rejectSession(session, error) {
      if (!cleanup(session)) return;
      session.reject(error);
    }

    function scheduleAdvance(session, delay) {
      if (session.finished || session.advanceTimer) return;
      session.advanceTimer = setTimeout(() => {
        session.advanceTimer = null;
        if (session.finished) return;
        sendCommand(session, 'advance').finally(() => {
          scheduleAdvance(session, advanceIntervalMs);
        });
      }, Math.max(0, Number(delay) || 0));
    }

    function maybeFinish(session) {
      if (session.finished || !session.rootSeen || session.rootHasMore === true ||
          Array.from(session.subStates.values()).some((state) => state.hasMore === true)) {
        scheduleAdvance(session, 0);
        return;
      }
      clearTimeout(session.settleTimer);
      session.settleTimer = setTimeout(() => {
        session.settleTimer = null;
        if (session.finished) return;
        if (session.rootHasMore === true ||
            Array.from(session.subStates.values()).some((state) => state.hasMore === true)) {
          scheduleAdvance(session, 0);
          return;
        }
        resolveSession(session, true, session.boundaryReached ? 'known_comment' : 'platform_end');
      }, settleMs);
    }

    function addComment(session, raw, context) {
      const id = commentId(raw);
      if (!id) return { added: false, known: false };
      const resumeMode = context.resumeMode === true;
      if (session.known.has(id)) {
        return { added: false, known: !resumeMode };
      }
      if (session.newIds.has(id)) return { added: false, known: false };
      session.newIds.add(id);
      session.comments.push(annotateComment(raw, session.noteId, context.rootId, context.parentId));
      return {
        added: true,
        known: false,
        limitReached: session.comments.length >= session.limit,
      };
    }

    function processRootCapture(session, parsedUrl, page) {
      session.rootSeen = true;
      clearTimeout(session.settleTimer);
      session.settleTimer = null;

      // Record the platform's next cursor before appending comments. Hitting the
      // per-round limit can finish the session from inside addComment(), and the
      // returned checkpoint must still point at this response's continuation.
      session.rootCursor = page.cursor;
      if (page.hasMore !== null) session.rootHasMore = page.hasMore;

      const atResumeCursor = !session.rootResumePending ||
        parsedUrl.requestCursor === session.rootResumeCursor;
      if (atResumeCursor) session.rootResumePending = false;
      const shouldCollect = !session.rootResumePending;
      let rootBoundary = false;

      if (shouldCollect) {
        for (const rawRoot of page.comments) {
          if (session.finished) return;
          const rootId = commentId(rawRoot);
          const rootResult = addComment(session, rawRoot, {
            rootId,
            resumeMode: session.rootWasContinuation,
          });
          if (rootResult.limitReached) {
            // Resume this same API page next round. Advancing to page.cursor here
            // could skip the unprocessed tail of a page that crossed item 500.
            session.rootCursor = parsedUrl.requestCursor;
            session.rootHasMore = true;
            resolveSession(session, false, 'limit_reached');
            return;
          }
          if (rootResult.known) {
            rootBoundary = true;
            break;
          }

          const replies = nestedReplies(rawRoot);
          for (const rawReply of replies) {
            if (session.finished) return;
            const replyResult = addComment(session, rawReply, {
              rootId,
              parentId: rootId,
              resumeMode: session.rootWasContinuation,
            });
            if (replyResult.limitReached) {
              session.rootCursor = parsedUrl.requestCursor;
              session.rootHasMore = true;
              resolveSession(session, false, 'limit_reached');
              return;
            }
            if (replyResult.known && !session.rootWasContinuation) break;
          }
          if (rootId && subCommentHasMore(rawRoot, replies.length)) {
            const existing = session.subStates.get(rootId) || { cursor: '', hasMore: true };
            existing.hasMore = true;
            session.subStates.set(rootId, existing);
          }
        }
      }

      if (rootBoundary) {
        session.boundaryReached = true;
        session.rootHasMore = false;
      } else if (page.hasMore === null) {
        session.rootHasMore = page.comments.length > 0;
      }
      maybeFinish(session);
    }

    function processSubCapture(session, parsedUrl, page) {
      const rootId = parsedUrl.rootCommentId;
      if (!rootId) return;
      clearTimeout(session.settleTimer);
      session.settleTimer = null;
      const state = session.subStates.get(rootId) || {
        cursor: '', hasMore: true, resumeCursor: '', resumePending: false, wasContinuation: false,
      };
      if (state.resumePending && parsedUrl.requestCursor === state.resumeCursor) {
        state.resumePending = false;
      }
      state.cursor = page.cursor;
      if (page.hasMore !== null) state.hasMore = page.hasMore;
      session.subStates.set(rootId, state);
      let boundary = false;
      if (!state.resumePending) {
        for (const rawReply of page.comments) {
          if (session.finished) return;
          const replyResult = addComment(session, rawReply, {
            rootId,
            parentId: rootId,
            resumeMode: state.wasContinuation,
          });
          if (replyResult.limitReached) {
            state.cursor = parsedUrl.requestCursor;
            state.hasMore = true;
            session.subStates.set(rootId, state);
            resolveSession(session, false, 'limit_reached');
            return;
          }
          if (replyResult.known) {
            boundary = true;
            break;
          }
        }
      }
      if (boundary) {
        session.boundaryReached = true;
        state.hasMore = false;
      } else if (page.hasMore === null) {
        state.hasMore = page.comments.length > 0;
      }
      session.subStates.set(rootId, state);
      maybeFinish(session);
    }

    function handleCapture(message, sender) {
      const tabId = Number(sender && sender.tab && sender.tab.id);
      const session = Number.isInteger(tabId) ? sessions.get(tabId) : null;
      if (!session || !message || message.type !== CAPTURE_TYPE ||
          message.source !== CAPTURE_SOURCE || !sender || sender.id !== chromeApi.runtime.id) {
        return { ok: false, handled: false };
      }
      const endpointKind = message.endpointKind;
      if (!Object.hasOwn(ENDPOINT_PATHS, endpointKind)) return { ok: false, handled: false };
      const parsedUrl = parseCaptureUrl(message.url, endpointKind, session.noteId);
      if (!parsedUrl || !message.body || typeof message.body !== 'object') {
        return { ok: false, handled: false };
      }
      const failure = explicitBodyError(message.body);
      if (failure) {
        rejectSession(session, failure);
        return { ok: false, handled: true, code: failure.code };
      }
      const page = parsePageBody(message.body);
      if (endpointKind === 'root') processRootCapture(session, parsedUrl, page);
      else processSubCapture(session, parsedUrl, page);
      return { ok: true, handled: true, capturedCount: session.comments.length };
    }

    function handleUpdated(tabId, changeInfo, tab) {
      const session = sessions.get(Number(tabId));
      if (!session) return;
      const failure = navigationError(changeInfo && changeInfo.url || tab && tab.url);
      if (failure) rejectSession(session, failure);
    }

    function handleRemoved(tabId) {
      const session = sessions.get(Number(tabId));
      if (!session) return;
      rejectSession(session, captureError(
        'COMMENT_CAPTURE_TAB_CLOSED',
        '评论抓取页已被关闭，任务将从检查点续抓。',
      ));
    }

    function register() {
      if (registered) return;
      registered = true;
      chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || message.type !== CAPTURE_TYPE) return false;
        sendResponse(handleCapture(message, sender));
        return false;
      });
      if (chromeApi.tabs.onUpdated && typeof chromeApi.tabs.onUpdated.addListener === 'function') {
        chromeApi.tabs.onUpdated.addListener(handleUpdated);
      }
      if (chromeApi.tabs.onRemoved && typeof chromeApi.tabs.onRemoved.addListener === 'function') {
        chromeApi.tabs.onRemoved.addListener(handleRemoved);
      }
    }

    function noteIdFromTabUrl(value) {
      try {
        const parsed = new URL(cleanText(value, 5000));
        if (parsed.origin !== OFFICIAL_ORIGIN) return '';
        const matched = /^\/(?:explore|discovery\/item)\/([^/?#]+)\/?$/.exec(parsed.pathname);
        if (!matched) return '';
        try { return decodeURIComponent(matched[1]); } catch (error) { return matched[1]; }
      } catch (error) {
        return '';
      }
    }

    async function workerTab(noteId) {
      const candidates = await Promise.resolve(chromeApi.tabs.query({
        url: [
          'https://www.xiaohongshu.com/explore/*',
          'https://www.xiaohongshu.com/discovery/item/*',
        ],
      }));
      const reusable = (Array.isArray(candidates) ? candidates : []).find((tab) => {
        const tabId = Number(tab && tab.id);
        if (!Number.isInteger(tabId) || sessions.has(tabId) || tab && tab.pinned === true) return false;
        return ownedWorkerTabIds.has(tabId) ||
          (tab && tab.active !== true && noteIdFromTabUrl(tab.url) === noteId);
      });
      if (reusable) return { tabId: Number(reusable.id), reused: true };
      const created = await Promise.resolve(chromeApi.tabs.create({ url: 'about:blank', active: false }));
      const tabId = Number(created && created.id);
      if (!Number.isInteger(tabId) || tabId < 0) {
        throw captureError('COMMENT_CAPTURE_TAB_INVALID', '未能创建有效的评论抓取页。');
      }
      ownedWorkerTabIds.add(tabId);
      return { tabId, reused: false };
    }

    async function collect(input) {
      register();
      const task = object(input);
      const noteId = cleanText(task.noteId, 240);
      if (!noteId) throw captureError('COMMENT_CAPTURE_TASK_INVALID', '评论抓取任务缺少 noteId。');
      const officialUrl = parseOfficialUrl(task.officialUrl, noteId);
      const worker = await workerTab(noteId);
      const tabId = worker.tabId;
      const sourceCheckpoint = object(clone(task.checkpoint));
      const rootWasContinuation = sourceCheckpoint.rootHasMore === true;
      const rootResumeCursor = rootWasContinuation
        ? cleanText(sourceCheckpoint.rootCursor, 1000) : '';
      const subStates = new Map();
      for (const [rootId, rawState] of Object.entries(object(sourceCheckpoint.subCursors))) {
        const normalized = normalizedSubState(rawState);
        subStates.set(cleanText(rootId, 240), {
          cursor: normalized.cursor,
          hasMore: normalized.hasMore,
          resumeCursor: normalized.hasMore ? normalized.cursor : '',
          resumePending: normalized.hasMore && Boolean(normalized.cursor),
          wasContinuation: normalized.hasMore,
        });
      }

      let resolvePromise;
      let rejectPromise;
      const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      const session = {
        accountKey: cleanText(task.accountKey, 160),
        tabId,
        noteId,
        officialUrl,
        limit: Math.min(500, Math.max(1, Math.floor(Number(task.limit) || 500))),
        known: new Set((Array.isArray(task.knownCommentIds) ? task.knownCommentIds : [])
          .map((value) => cleanText(value, 240)).filter(Boolean)),
        newIds: new Set(),
        comments: [],
        rootCursor: cleanText(sourceCheckpoint.rootCursor, 1000),
        rootHasMore: sourceCheckpoint.rootHasMore === true,
        rootSeen: false,
        rootWasContinuation,
        rootResumeCursor,
        rootResumePending: rootWasContinuation && Boolean(rootResumeCursor),
        subStates,
        boundaryReached: false,
        finished: false,
        resolve: resolvePromise,
        reject: rejectPromise,
        timeoutTimer: null,
        settleTimer: null,
        advanceTimer: null,
      };
      sessions.set(tabId, session);
      session.timeoutTimer = setTimeout(() => {
        if (session.finished) return;
        if (session.comments.length) {
          resolveSession(session, false, 'timeout', { timedOut: true });
        } else {
          rejectSession(session, captureError(
            'COMMENT_CAPTURE_TIMEOUT',
            '未等到小红书页面发出评论接口响应，已保留检查点等待重试。',
          ));
        }
      }, timeoutMs);

      try {
        await Promise.resolve(chromeApi.tabs.update(tabId, { url: officialUrl, active: false }));
        scheduleAdvance(session, advanceIntervalMs);
      } catch (error) {
        rejectSession(session, captureError(
          'COMMENT_CAPTURE_NAVIGATION_FAILED',
          `无法打开小红书官方笔记链接：${cleanText(error && error.message || error, 500)}`,
        ));
      }
      return promise;
    }

    return Object.freeze({ register, collect, handleCapture });
  }

  return Object.freeze({
    CAPTURE_SOURCE,
    CAPTURE_TYPE,
    COMMAND_TYPE,
    createCommentCaptureCoordinator,
    parsePageBody,
  });
});

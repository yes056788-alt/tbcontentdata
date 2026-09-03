(function (root, factory) {
  'use strict';
  const installMarker = '__tbcontentdataXhsLoginContentInstalledV2__';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.chrome && root.chrome.runtime && root.document) {
    const previousListener = root[installMarker];
    let receiverActive = false;
    if (typeof previousListener === 'function') {
      try {
        receiverActive = typeof root.chrome.runtime.onMessage.hasListener === 'function'
          ? root.chrome.runtime.onMessage.hasListener(previousListener)
          : true;
      } catch (error) {
        receiverActive = false;
      }
    }
    if (!receiverActive) {
      const listener = api.register();
      if (typeof listener !== 'function') return;
      try {
        Object.defineProperty(root, installMarker, {
          value: listener,
          configurable: true,
          writable: true,
        });
      } catch (error) {
        try { root[installMarker] = listener; } catch (assignmentError) {}
      }
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const PRODUCT_ORIGINS = new Set([
    'https://pgy.xiaohongshu.com',
    'https://ad.xiaohongshu.com',
  ]);
  const LOGIN_ORIGINS = new Set([
    'https://customer.xiaohongshu.com',
    'https://passport.xiaohongshu.com',
  ]);
  let registeredListener = null;
  const cancelledLoginOperations = new Set();
  const activeLoginCleanups = new Map();

  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  }

  function trustedDocumentUrl(location) {
    try {
      const url = new URL(String(location && location.href || ''));
      if (url.protocol !== 'https:' || url.username || url.password) return null;
      return url;
    } catch (error) {
      return null;
    }
  }

  function expectedProductOrigin(url) {
    return Boolean(url && PRODUCT_ORIGINS.has(url.origin));
  }

  function isAllowedDocumentUrl(location) {
    const url = trustedDocumentUrl(location);
    return Boolean(url && (LOGIN_ORIGINS.has(url.origin) || expectedProductOrigin(url)));
  }

  function safeDocumentHref(location) {
    const url = trustedDocumentUrl(location);
    return url && isAllowedDocumentUrl(location) ? url.origin + url.pathname : '';
  }

  function untrustedOriginResult() {
    return {
      ok: false,
      code: 'XHS_LOGIN_ORIGIN_UNTRUSTED',
      message: '小红书登录页地址不在允许范围内。',
    };
  }

  function loginOperationId(payload) {
    return String(payload && payload.operationId || '').trim().slice(0, 120);
  }

  function cancelledOperationResult() {
    return {
      ok: false,
      code: 'XHS_LOGIN_CANCELLED',
      message: '小红书登录操作已取消。',
    };
  }

  function rememberCancelledOperation(operationId) {
    if (!operationId) return;
    cancelledLoginOperations.add(operationId);
    while (cancelledLoginOperations.size > 200) {
      const oldest = cancelledLoginOperations.values().next().value;
      cancelledLoginOperations.delete(oldest);
    }
    const cleanup = activeLoginCleanups.get(operationId);
    if (typeof cleanup === 'function') {
      try { cleanup(); } catch (error) {}
    }
  }

  async function operationCancelled(payload, delayMs) {
    const operationId = loginOperationId(payload);
    if (!operationId) return false;
    if (Number(delayMs) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Number(delayMs)));
    } else {
      await Promise.resolve();
    }
    return cancelledLoginOperations.has(operationId);
  }

  function elementText(element) {
    return String(element && (element.innerText || element.textContent || element.value ||
      (element.getAttribute && element.getAttribute('aria-label'))) || '').trim();
  }

  function isVisible(element) {
    if (!element || element.disabled) return false;
    if (element.offsetParent !== null && element.offsetParent !== undefined) return true;
    if (typeof element.getBoundingClientRect !== 'function') return true;
    const box = element.getBoundingClientRect();
    return Boolean(box && box.width > 0 && box.height > 0);
  }

  function visibleElements(document, selector) {
    try {
      return Array.from(document.querySelectorAll(selector)).filter(isVisible);
    } catch (error) {
      return [];
    }
  }

  function bodyText(document) {
    return String(document && document.body && (document.body.innerText || document.body.textContent) || '').slice(0, 12000);
  }

  function findLoginInputs(document) {
    const inputs = visibleElements(document, 'input');
    const password = inputs.find((input) => (
      String(input.type || '').toLowerCase() === 'password' ||
      /密码|password|pwd/.test(normalize([input.placeholder, input.name, input.id].join(' ')))
    )) || null;
    const hintedAccount = inputs.find((input) => {
      if (input === password || String(input.type || '').toLowerCase() === 'hidden') return false;
      const hint = normalize([input.placeholder, input.name, input.id,
        input.getAttribute && input.getAttribute('aria-label')].join(' '));
      return /邮箱|账号|用户名|小红书号|email|account|username|login/.test(hint);
    }) || null;
    const account = hintedAccount || inputs.find((input) => (
      input !== password && ['text', 'email', ''].includes(String(input.type || '').toLowerCase())
    )) || null;
    return { account, password, accountHinted: Boolean(hintedAccount) };
  }

  function loginFormEvidence(document, text, inputs) {
    const source = inputs && typeof inputs === 'object' ? inputs : findLoginInputs(document);
    if (!source.account || !source.password || !source.accountHinted) return null;
    if (!/账号登录|邮箱登录|密码登录|立即登录|登录小红书/.test(String(text || ''))) return null;
    const submit = findClickable(document, ['登录', '立即登录', '账号登录'], true) ||
      visibleElements(document, 'button[type="submit"],input[type="submit"]').find(isVisible) || null;
    if (!submit) return null;
    const accountForm = typeof source.account.closest === 'function'
      ? source.account.closest('form')
      : null;
    const passwordForm = typeof source.password.closest === 'function'
      ? source.password.closest('form')
      : null;
    if ((accountForm || passwordForm) && accountForm !== passwordForm) return null;
    if (accountForm && typeof accountForm.contains === 'function' && !accountForm.contains(submit)) return null;
    return { account: source.account, password: source.password, submit };
  }

  function verificationVisible(document, text) {
    const selectors = [
      '[id*="captcha" i]', '[class*="captcha" i]',
      '[id*="slider" i]', '[class*="slider" i]',
      '[class*="geetest" i]',
      'iframe[src*="captcha" i]', 'iframe[src*="verify" i]',
    ].join(',');
    if (visibleElements(document, selectors).length) return true;
    return /请完成(?:安全|人机|滑块|图形)?验证|请拖动滑块|人机验证|请输入(?:短信|图形)?验证码|安全校验/.test(text);
  }

  function loginError(document, text) {
    const errorText = visibleElements(
      document,
      '[role="alert"],[class*="error" i],[class*="feedback" i],[class*="message" i]'
    ).map(elementText).join(' ') + ' ' + String(text || '');
    return /邮箱或密码|账号或密码|密码错误|账号不存在|登录失败|账号已被限制/.test(errorText);
  }

  function productApplicationEvidence(document, url, text) {
    if (!expectedProductOrigin(url)) return false;
    const pageText = normalize([
      document && document.title,
      text,
    ].join(' '));
    if (url.origin === 'https://pgy.xiaohongshu.com') {
      return pageText.includes('蒲公英') &&
        /\u5185\u5bb9\u5e7f\u573a|\u5185\u5bb9\u5408\u4f5c|\u521b\u610f\u4e2d\u5fc3|\u5408\u4f5c\u7ba1\u7406|\u62a5\u5907|\u6570\u636e\u4e2d\u5fc3|\u54c1\u724c\u5408\u4f5c/.test(pageText);
    }
    if (url.origin === 'https://ad.xiaohongshu.com') {
      return pageText.includes('聚光') &&
        /\u5e7f\u544a\u6295\u653e|\u8d26\u6237\u7ba1\u7406|\u5173\u952e\u8bcd|\u63a8\u5e7f\u7ba1\u7406|\u6570\u636e\u4e2d\u5fc3|\u6295\u653e\u7ba1\u7406/.test(pageText);
    }
    return false;
  }

  function productSessionEvidence(document, url, text) {
    if (!productApplicationEvidence(document, url, text)) return false;
    const accountCopy = normalize(text);
    if (/退出登录|切换账号|使用其他账号/.test(accountCopy)) return true;

    const accountControls = visibleElements(document, [
      'button', 'a', '[role="button"]',
      '[class*="avatar" i]', '[class*="user-info" i]', '[class*="account-info" i]',
      '[class*="user-name" i]', '[class*="username" i]',
    ].join(','));
    return accountControls.some((element) => {
      const copy = normalize(elementText(element));
      if (/退出登录|切换账号|使用其他账号/.test(copy)) return true;
      const image = element && typeof element.querySelector === 'function'
        ? element.querySelector('img[src]')
        : null;
      const identity = element && element.getAttribute && (
        element.getAttribute('data-user-id') || element.getAttribute('data-account-id')
      );
      return Boolean((image && image.src) || identity);
    });
  }

  function loginEntryEvidence(document, text) {
    if (/账号登录|邮箱登录|密码登录|立即登录|登录小红书/.test(String(text || ''))) return true;
    return Boolean(findClickable(document, [
      '账号登录', '邮箱登录', '密码登录', '立即登录', '登录',
    ], true));
  }

  function loginShellLoadingEvidence(document, url, text) {
    if (!url || !LOGIN_ORIGINS.has(url.origin)) return false;
    if (document.readyState !== 'complete') return true;
    if (!/(^|\/)login(?:\/|$)/i.test(String(url.pathname || ''))) return false;
    const pageText = normalize([document && document.title, text].join(' '));
    if (!pageText || /正在加载|加载中|loading/.test(pageText)) return true;
    return visibleElements(document, [
      '[aria-busy="true"]', '[class*="loading" i]',
      '[class*="skeleton" i]', '[class*="spin" i]',
    ].join(',')).length > 0;
  }

  function detectPageState(environment) {
    const env = environment && typeof environment === 'object' ? environment : {};
    const document = env.document || (root && root.document);
    const location = env.location || (root && root.location) || {};
    if (!document) return { kind: 'loading', message: '小红书登录页正在加载。' };
    if (!isAllowedDocumentUrl(location)) {
      return { kind: 'unsupported', code: 'XHS_LOGIN_ORIGIN_UNTRUSTED', message: '小红书登录页地址不在允许范围内。' };
    }
    const text = bodyText(document);
    if (verificationVisible(document, text)) {
      return { kind: 'verification', message: '小红书登录需要人工完成验证码或安全验证。' };
    }
    const error = loginError(document, text);
    const inputs = findLoginInputs(document);
    if (loginFormEvidence(document, text, inputs)) {
      return error
        ? { kind: 'loginError', message: '小红书账号或密码错误。' }
        : { kind: 'login', message: '等待输入小红书邮箱和密码。' };
    }
    if (error) return { kind: 'loginError', message: '小红书账号或密码错误。' };
    const documentUrl = trustedDocumentUrl(location);
    const origin = documentUrl && documentUrl.origin || '';
    if (productSessionEvidence(document, documentUrl, text)) {
      return { kind: 'loggedIn', message: '小红书平台页面已进入登录会话。' };
    }
    if (loginEntryEvidence(document, text)) {
      return { kind: 'entry', message: '等待打开小红书账号登录表单。' };
    }
    if (productApplicationEvidence(document, documentUrl, text)) {
      return {
        kind: 'productReady',
        message: '小红书平台应用已加载，登录身份将在取数前再次校验。',
      };
    }
    if (LOGIN_ORIGINS.has(origin)) {
      return loginShellLoadingEvidence(document, documentUrl, text)
        ? { kind: 'loading', message: '小红书登录页正在加载。' }
        : { kind: 'unsupported', message: '小红书登录页未提供可用的账号密码表单。' };
    }
    return { kind: 'loading', message: '小红书平台页面正在加载或等待登录态确认。' };
  }

  function findClickable(document, labels, exact) {
    const wanted = labels.map(normalize);
    return visibleElements(document, 'button,a,[role="button"],input[type="button"],input[type="submit"]')
      .find((element) => {
        const text = normalize(elementText(element));
        if (!text || text.length > 80) return false;
        return wanted.some((label) => exact ? text === label : text.includes(label));
      }) || null;
  }

  function nativeInput(element, value) {
    const next = String(value == null ? '' : value);
    let setter = null;
    try {
      const prototype = Object.getPrototypeOf(element);
      setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value') &&
        Object.getOwnPropertyDescriptor(prototype, 'value').set;
    } catch (error) {}
    if (setter) setter.call(element, next);
    else element.value = next;
    const EventCtor = root && root.Event || (typeof Event === 'function' ? Event : null);
    if (EventCtor && typeof element.dispatchEvent === 'function') {
      element.dispatchEvent(new EventCtor('input', { bubbles: true }));
      element.dispatchEvent(new EventCtor('change', { bubbles: true }));
    }
  }

  async function fillPasswordLogin(environment, payload) {
    const env = environment && typeof environment === 'object' ? environment : {};
    const document = env.document || (root && root.document);
    if (!document) return { ok: false, code: 'XHS_LOGIN_DOCUMENT_MISSING', message: '小红书登录页不可用。' };
    const location = env.location || (root && root.location) || {};
    const documentUrl = trustedDocumentUrl(location);
    if (!isAllowedDocumentUrl(location) || !documentUrl || !LOGIN_ORIGINS.has(documentUrl.origin)) {
      return untrustedOriginResult();
    }
    try {
      const operationId = loginOperationId(payload);
      if (await operationCancelled(payload, operationId ? 25 : 0)) {
        return cancelledOperationResult();
      }
      const username = String(payload && payload.username || '').trim().slice(0, 240);
      const password = String(payload && payload.password || '').slice(0, 360);
      if (!username || !password) {
        return { ok: false, code: 'XHS_LOGIN_CREDENTIALS_MISSING', message: '小红书登录凭据不完整。' };
      }
      const accountTab = findClickable(document, ['账号登录', '邮箱登录', '密码登录'], true);
      if (accountTab) {
        accountTab.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (await operationCancelled(payload, 0)) return cancelledOperationResult();
      }
      const inputs = findLoginInputs(document);
      const form = loginFormEvidence(document, bodyText(document), inputs);
      if (!form) {
        return { ok: false, code: 'XHS_LOGIN_FORM_UNAVAILABLE', message: '未找到小红书邮箱或密码输入框。' };
      }
      if (operationId) {
        activeLoginCleanups.set(operationId, () => {
          nativeInput(form.account, '');
          nativeInput(form.password, '');
        });
      }
      if (await operationCancelled(payload, 0)) return cancelledOperationResult();
      nativeInput(form.account, username);
      if (await operationCancelled(payload, 0)) return cancelledOperationResult();
      nativeInput(form.password, password);
      if (await operationCancelled(payload, 0)) return cancelledOperationResult();
      form.submit.click();
      return { ok: true, submitted: true };
    } catch (error) {
      return { ok: false, code: 'XHS_LOGIN_OPERATION_FAILED', message: '小红书登录操作失败。' };
    } finally {
      const operationId = loginOperationId(payload);
      if (operationId) activeLoginCleanups.delete(operationId);
    }
  }

  async function openAccountLogin(environment, payload) {
    const env = environment && typeof environment === 'object' ? environment : {};
    const document = env.document || (root && root.document);
    const location = env.location || (root && root.location) || {};
    if (!isAllowedDocumentUrl(location)) {
      return untrustedOriginResult();
    }
    if (await operationCancelled(payload, loginOperationId(payload) ? 25 : 0)) {
      return cancelledOperationResult();
    }
    const button = document && findClickable(document, [
      '账号登录', '邮箱登录', '密码登录', '立即登录', '登录',
    ], false);
    if (!button) return { ok: false, message: '未找到小红书账号登录入口。' };
    if (await operationCancelled(payload, 0)) return cancelledOperationResult();
    button.click();
    return { ok: true };
  }

  function register() {
    if (registeredListener || !root || !root.chrome || !root.chrome.runtime || !root.document) {
      return registeredListener;
    }
    const listener = (message, sender, sendResponse) => {
      if (!message || !String(message.type || '').startsWith('XHS_LOGIN_')) return;
      if (!sender || sender.id !== root.chrome.runtime.id) {
        sendResponse({ ok: false, code: 'XHS_LOGIN_SENDER_UNTRUSTED', message: '小红书登录操作来源无效。' });
        return false;
      }
      if (message.type === 'XHS_LOGIN_CANCEL') {
        rememberCancelledOperation(loginOperationId(message));
        sendResponse({ ok: true, cancelled: true });
        return false;
      }
      Promise.resolve().then(async () => {
        if (message.type === 'XHS_LOGIN_GET_STATE') {
          const state = detectPageState({ document: root.document, location: root.location });
          return { ok: true, state, href: safeDocumentHref(root.location) };
        }
        if (message.type === 'XHS_LOGIN_FILL_PASSWORD') {
          return fillPasswordLogin({ document: root.document, location: root.location }, message);
        }
        if (message.type === 'XHS_LOGIN_OPEN_ACCOUNT') {
          return openAccountLogin({ document: root.document, location: root.location }, message);
        }
        return { ok: false, message: '未知的小红书登录操作。' };
      }).then(sendResponse).catch((error) => {
        sendResponse({ ok: false, code: 'XHS_LOGIN_OPERATION_FAILED', message: '小红书登录操作失败。' });
      });
      return true;
    };
    root.chrome.runtime.onMessage.addListener(listener);
    registeredListener = listener;
    return registeredListener;
  }

  return Object.freeze({
    detectPageState,
    isAllowedDocumentUrl,
    findLoginInputs,
    fillPasswordLogin,
    openAccountLogin,
    register,
  });
});

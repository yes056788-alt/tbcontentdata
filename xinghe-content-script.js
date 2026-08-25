// xinghe-content-script.js - password login, role selection and logout for batch runs.
(function () {
  'use strict';

  if (window.__taobaoXingheAutomationV1) return;
  window.__taobaoXingheAutomationV1 = true;

  const LOGIN_URL = 'https://adstar.alimama.com/index.htm?forward=https%3A%2F%2Fadstar.alimama.com%2Findex.htm';
  const LOGOUT_URL = 'https://adstar.alimama.com/openapi/param2/1/gateway.unionpub/union.logout?forward=https%3A%2F%2Fadstar.alimama.com%2Findex.htm';
  const cancelledOperations = new Set();
  const activeOperationCleanups = new Map();

  function operationId(payload) {
    return String(payload && payload.operationId || '').trim().slice(0, 120);
  }

  function rememberCancelledOperation(id) {
    if (!id) return;
    cancelledOperations.add(id);
    while (cancelledOperations.size > 200) {
      const oldest = cancelledOperations.values().next().value;
      cancelledOperations.delete(oldest);
    }
    const cleanup = activeOperationCleanups.get(id);
    if (typeof cleanup === 'function') {
      try { cleanup(); } catch (error) {}
    }
  }

  async function operationCancelled(payload, delayMs) {
    const id = operationId(payload);
    if (!id) return false;
    if (Number(delayMs) > 0) {
      await new Promise((resolve) => setTimeout(resolve, Number(delayMs)));
    } else {
      await Promise.resolve();
    }
    return cancelledOperations.has(id);
  }

  function cancelledResult() {
    return { ok: false, code: 'XINGHE_OPERATION_CANCELLED', message: '星河登录操作已取消。' };
  }

  function normalize(value) {
    return String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  }

  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  }

  function visibleElements(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(visible);
  }

  function elementText(element) {
    return String(element && (element.innerText || element.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function bodyText() {
    return elementText(document.body);
  }

  function nativeInput(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findClickable(labels, exact) {
    const wanted = labels.map(normalize).filter(Boolean);
    const candidates = visibleElements('button,a,[role="button"],input[type="button"],input[type="submit"],div,span');
    return candidates.find((element) => {
      const text = normalize(elementText(element) || element.value || element.getAttribute('aria-label'));
      if (!text || text.length > 80) return false;
      return wanted.some((label) => exact ? text === label : text.includes(label));
    }) || null;
  }

  function loginInputs() {
    const inputs = visibleElements('input');
    const password = inputs.find((input) => input.type === 'password' || /\u5bc6\u7801|password/.test(normalize(input.placeholder || input.name)));
    const account = inputs.find((input) => input !== password && input.type !== 'hidden' &&
      (/\u8d26\u53f7|\u7528\u6237|\u624b\u673a|\u90ae\u7bb1|account|username|login/.test(normalize(input.placeholder || input.name || input.id)) ||
        ['text', 'email', 'tel', ''].includes(String(input.type || '').toLowerCase())));
    return { account: account || null, password: password || null };
  }

  function verificationVisible() {
    const challengeSelectors = [
      '[id*="captcha" i]', '[class*="captcha" i]',
      '[id*="slider" i]', '[class*="slider" i]',
      '[id^="nc_"]', '[class*="nc-container" i]', '[class*="nc_wrapper" i]',
      'iframe[src*="captcha" i]', 'iframe[src*="verify" i]', 'iframe[src*="punish" i]',
    ].join(',');
    if (visibleElements(challengeSelectors).length) return true;
    return visibleElements('input,div,span,label,p').some((element) => {
      const text = elementText(element);
      if (!text || text.length > 80) return false;
      return /\u8bf7\u62d6\u52a8\u6ed1\u5757|\u8bf7\u5b8c\u6210\u5b89\u5168\u9a8c\u8bc1|\u56fe\u5f62\u9a8c\u8bc1\u7801|\u77ed\u4fe1\u9a8c\u8bc1\u7801|\u8bf7\u8f93\u5165\u9a8c\u8bc1\u7801|\u4eba\u673a\u9a8c\u8bc1/.test(text);
    });
  }

  function loginError() {
    const candidates = visibleElements('[role="alert"],[class*="error" i],[class*="feedback" i],[class*="message" i]');
    const text = candidates.map(elementText).filter((value) => value.length < 240).join(' ');
    const match = text.match(/\u8d26\u53f7\u6216\u5bc6\u7801[^\u3002\uff01!]{0,40}|\u5bc6\u7801\u9519\u8bef[^\u3002\uff01!]{0,40}|\u8d26\u53f7\u4e0d\u5b58\u5728[^\u3002\uff01!]{0,40}|\u767b\u5f55\u5931\u8d25[^\u3002\uff01!]{0,40}|\u8d26\u53f7\u5df2\u88ab\u9650\u5236[^\u3002\uff01!]{0,40}/);
    return match ? match[0] : '';
  }

  function roleButtons() {
    return visibleElements('button,a,[role="button"]').filter((element) => /\u5458\u5de5\u767b\u5f55|\u8fdb\u5165\u8d26\u53f7/.test(elementText(element)));
  }

  function accountHint(text) {
    const match = String(text || '').match(/\u7ee7\u7eed\u7528\u4ee5\u4e0b\u8d26\u53f7\u767b\u5f55\s*([^\s]{2,40})/);
    return match ? match[1] : '';
  }

  function xingheAccessRestriction(text) {
    const value = String(text || '').normalize('NFKC').replace(/\s+/g, '');
    const unregistered = /(?:\u5f53\u524d|\u8be5|\u6b64)?(?:\u8d26\u53f7|\u7528\u6237)?(?:\u5c1a\u672a|\u8fd8\u672a|\u672a)(?:\u6ce8\u518c|\u5f00\u901a)(?:\u6dd8\u5b9d)?\u661f\u6cb3(?:\u8d26\u53f7|\u8eab\u4efd)?|\u661f\u6cb3(?:\u8d26\u53f7|\u8eab\u4efd)(?:\u5c1a\u672a|\u8fd8\u672a|\u672a)(?:\u6ce8\u518c|\u5f00\u901a)/.test(value) ||
      (value.includes('\u661f\u6cb3') && /(?:\u5f53\u524d|\u8be5|\u6b64)(?:\u8d26\u53f7|\u7528\u6237|\u8eab\u4efd)(?:\u5c1a\u672a|\u8fd8\u672a|\u672a)\u6ce8\u518c(?:\u8d26\u53f7|\u8eab\u4efd)?|\u8bf7\u9009\u62e9\u4ee5\u4e0b\u8eab\u4efd\u8fdb\u884c\u6ce8\u518c|\u7acb\u5373\u6ce8\u518c\/\u67e5\u770b\u8fdb\u5ea6/.test(value));
    if (unregistered) return 'unregistered';
    if (/\u5b50\u8d26\u53f7\u672a\u6388\u6743|(?:\u5f53\u524d|\u8be5|\u6b64)?\u8d26\u53f7(?:\u6682\u65e0|\u65e0|\u6ca1\u6709|\u672a\u83b7\u5f97)(?:\u661f\u6cb3)?(?:\u8bbf\u95ee|\u4f7f\u7528)?\u6743\u9650|(?:\u5f53\u524d|\u8be5|\u6b64)?\u8eab\u4efd(?:\u672a\u6388\u6743|\u6682\u65e0\u6743\u9650|\u65e0\u6743\u9650)|\u661f\u6cb3(?:\u8d26\u53f7|\u8eab\u4efd)?(?:\u672a\u6388\u6743|\u6682\u65e0\u6743\u9650|\u65e0\u6743\u9650|\u65e0\u6743\u8bbf\u95ee)/.test(value) ||
      (value.includes('\u661f\u6cb3') && /(?:\u62b1\u6b49|\u60a8\u5f53\u524d|\u60a8)[^\u3002\uff01!\uff1f?]{0,16}(?:\u65e0\u6743\u8bbf\u95ee|\u6ca1\u6709\u6743\u9650|\u6682\u65e0\u6743\u9650)/.test(value))) {
      return 'noPermission';
    }
    return '';
  }

  function xingheProductApplicationEvidence(text) {
    if (location.origin !== 'https://adstar.alimama.com' ||
        !/^\/portal\/v2\/pages\//.test(location.pathname) ||
        /\/portal\/v2\/pages\/role\/picker\//.test(location.pathname)) {
      return false;
    }
    const pageText = normalize([document.title, text].join(' '));
    if (!pageText.includes(normalize('\u6dd8\u5b9d\u661f\u6cb3'))) return false;
    const navigationLabels = [
      '\u6211\u7684\u661f\u6cb3', '\u6570\u636e\u6d1e\u5bdf', '\u6d3b\u52a8\u62db\u5546', '\u6743\u76ca\u4e2d\u5fc3',
      '\u8d22\u52a1\u7ba1\u7406', '\u7b56\u7565\u4e2d\u5fc3', '\u8d26\u6237\u7ba1\u7406',
    ].map(normalize);
    const navigationCount = navigationLabels.filter((label) => pageText.includes(label)).length;
    return navigationCount >= 2;
  }

  function xingheProductSessionEvidence(text) {
    if (!xingheProductApplicationEvidence(text)) return false;
    const pageText = String(text || '').normalize('NFKC').replace(/\s+/g, '');
    if (/\bID:?\d{4,24}\b/i.test(pageText) || /\u9000\u51fa\u767b\u5f55|\u5207\u6362\u8d26\u53f7|\u4f7f\u7528\u5176\u4ed6\u8d26\u53f7\u767b\u5f55/.test(pageText)) {
      return true;
    }
    const accountControls = visibleElements([
      '[data-user-id]', '[data-account-id]',
      '[class*="avatar" i]', '[class*="user-info" i]', '[class*="account-info" i]',
      '[class*="user-name" i]', '[class*="username" i]',
    ].join(','));
    return accountControls.some((element) => {
      const identity = element.getAttribute && (
        element.getAttribute('data-user-id') || element.getAttribute('data-account-id')
      );
      const image = typeof element.querySelector === 'function'
        ? element.querySelector('img[src]')
        : null;
      return Boolean(identity || (image && image.src));
    });
  }

  function pageState() {
    const text = bodyText();
    const inputs = loginInputs();
    const roles = roleButtons();
    const accessRestriction = xingheAccessRestriction(text);
    if (verificationVisible()) {
      return { kind: 'verification', message: '\u661f\u6cb3\u767b\u5f55\u9700\u8981\u4eba\u5de5\u5b8c\u6210\u9a8c\u8bc1\u7801\u6216\u5b89\u5168\u9a8c\u8bc1\u3002' };
    }
    const error = loginError();
    const hasLoginForm = Boolean(inputs.password ||
      (inputs.account && /\u5bc6\u7801\u767b\u5f55|\u626b\u7801\u767b\u5f55/.test(text)));
    if (hasLoginForm) {
      if (error) return { kind: 'loginError', message: '\u661f\u6cb3\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef\u3002' };
      return { kind: 'login', message: '\u7b49\u5f85\u8f93\u5165\u8d26\u53f7\u5bc6\u7801\u3002' };
    }
    if (roles.length) {
      return { kind: 'rolePicker', roleCount: roles.length, message: '\u7b49\u5f85\u9009\u62e9\u767b\u5f55\u8eab\u4efd\u3002' };
    }
    if (accessRestriction) {
      return {
        kind: 'noPermission',
        accessReason: accessRestriction,
        accountHint: accountHint(text),
        message: accessRestriction === 'unregistered'
          ? '\u661f\u6cb3\u5f53\u524d\u8d26\u53f7\u672a\u6ce8\u518c\u8eab\u4efd\uff0c\u5df2\u4fdd\u7559\u6dd8\u5b9d\u767b\u5f55\u6001\uff0c\u5c06\u7ee7\u7eed\u5176\u4ed6\u5e73\u53f0\u53d6\u6570\u3002'
          : '\u661f\u6cb3\u5f53\u524d\u8eab\u4efd\u672a\u6388\u6743\uff0c\u5df2\u4fdd\u7559\u6dd8\u5b9d\u767b\u5f55\u6001\uff0c\u5c06\u7ee7\u7eed\u5176\u4ed6\u5e73\u53f0\u53d6\u6570\u3002',
      };
    }
    if (error) return { kind: 'loginError', message: '\u661f\u6cb3\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef\u3002' };
    if (/\/portal\/v2\/pages\/role\/picker\//.test(location.pathname)) {
      return { kind: 'rolePicker', roleCount: 0, message: '\u7b49\u5f85\u9009\u62e9\u767b\u5f55\u8eab\u4efd\u3002' };
    }
    const logout = visibleElements('a').find((element) => /union\.logout/.test(String(element.href || ''))) ||
      findClickable(['\u9000\u51fa', '\u9000\u51fa\u767b\u5f55', '\u4f7f\u7528\u5176\u4ed6\u8d26\u53f7\u767b\u5f55'], true);
    if (logout || xingheProductSessionEvidence(text)) {
      return { kind: 'loggedIn', accountHint: accountHint(text), message: '\u661f\u6cb3\u5df2\u767b\u5f55\u3002' };
    }
    if (document.readyState === 'complete' && text.length > 80) {
      return { kind: 'sessionPending', message: '\u661f\u6cb3\u5df2\u79bb\u5f00\u767b\u5f55\u8868\u5355，\u6b63\u5728\u786e\u8ba4\u4f1a\u8bdd\u3002' };
    }
    return { kind: 'loading', message: '\u661f\u6cb3\u9875\u9762\u6b63\u5728\u52a0\u8f7d。' };
  }

  async function fillLogin(payload) {
    const id = operationId(payload);
    if (await operationCancelled(payload, id ? 25 : 0)) return cancelledResult();
    const passwordTab = findClickable(['\u5bc6\u7801\u767b\u5f55'], true);
    if (passwordTab) {
      passwordTab.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (await operationCancelled(payload, 0)) return cancelledResult();
    }
    const inputs = loginInputs();
    if (!inputs.account || !inputs.password) {
      return { ok: false, message: '\u672a\u627e\u5230\u661f\u6cb3\u8d26\u53f7\u6216\u5bc6\u7801\u8f93\u5165\u6846。' };
    }
    if (id) {
      activeOperationCleanups.set(id, () => {
        nativeInput(inputs.account, '');
        nativeInput(inputs.password, '');
      });
    }
    try {
      if (await operationCancelled(payload, 0)) return cancelledResult();
      nativeInput(inputs.account, String(payload && payload.username || ''));
      if (await operationCancelled(payload, 0)) return cancelledResult();
      nativeInput(inputs.password, String(payload && payload.password || ''));
      if (await operationCancelled(payload, 0)) return cancelledResult();
      const submit = visibleElements('button,input[type="submit"],[role="button"]').find((element) => (
        normalize(elementText(element) || element.value) === normalize('\u767b\u5f55')
      ));
      if (!submit) return { ok: false, message: '\u672a\u627e\u5230\u661f\u6cb3\u767b\u5f55\u6309\u94ae。' };
      submit.click();
      return { ok: true, state: pageState() };
    } finally {
      if (id) activeOperationCleanups.delete(id);
    }
  }

  function roleContainer(button) {
    let node = button;
    for (let depth = 0; node && depth < 7; depth += 1) {
      const text = elementText(node);
      if (text.length >= 2 && text.length <= 700 && /\u8eab\u4efd|\u54c1\u724c|\u670d\u52a1\u5546/.test(text)) return node;
      node = node.parentElement;
    }
    return button.parentElement || button;
  }

  async function selectRole(payload) {
    if (await operationCancelled(payload, operationId(payload) ? 25 : 0)) return cancelledResult();
    const buttons = roleButtons();
    if (!buttons.length) return { ok: false, message: '\u661f\u6cb3\u8eab\u4efd\u9875\u672a\u627e\u5230\u53ef\u767b\u5f55\u8eab\u4efd。' };
    const keyword = normalize(payload && payload.roleKeyword || '\u54c1\u724c');
    let selected = buttons.find((button) => normalize(elementText(roleContainer(button))).includes(keyword));
    if (!selected && buttons.length === 1) selected = buttons[0];
    if (!selected) {
      return { ok: false, needsRoleChoice: true, message: '\u661f\u6cb3\u672a\u627e\u5230\u5339\u914d\u7684\u767b\u5f55\u8eab\u4efd。' };
    }
    const label = elementText(roleContainer(selected)).slice(0, 180);
    if (await operationCancelled(payload, 0)) return cancelledResult();
    selected.click();
    return { ok: true, roleLabel: label };
  }

  function logout() {
    const direct = visibleElements('a').find((element) => /union\.logout/.test(String(element.href || '')));
    if (direct) {
      direct.click();
      return { ok: true, method: 'logoutLink' };
    }
    const button = findClickable(['\u9000\u51fa\u767b\u5f55', '\u9000\u51fa', '\u4f7f\u7528\u5176\u4ed6\u8d26\u53f7\u767b\u5f55'], true);
    if (button) {
      button.click();
      return { ok: true, method: 'button' };
    }
    location.assign(LOGOUT_URL);
    return { ok: true, method: 'directUrl' };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !String(message.type || '').startsWith('XINGHE_')) return;
    if (message.type === 'XINGHE_CANCEL_OPERATION') {
      rememberCancelledOperation(operationId(message));
      sendResponse({ ok: true, cancelled: true });
      return false;
    }
    Promise.resolve().then(async () => {
      if (message.type === 'XINGHE_GET_STATE') return { ok: true, state: pageState(), href: location.href };
      if (message.type === 'XINGHE_FILL_LOGIN') return fillLogin(message);
      if (message.type === 'XINGHE_SELECT_ROLE') return selectRole(message);
      if (message.type === 'XINGHE_LOGOUT') return logout();
      if (message.type === 'XINGHE_NAVIGATE_LOGIN') {
        location.assign(LOGIN_URL);
        return { ok: true };
      }
      return { ok: false, message: '\u672a\u77e5\u661f\u6cb3\u81ea\u52a8\u5316\u64cd\u4f5c。' };
    }).then(sendResponse).catch(() => {
      sendResponse({ ok: false, message: '\u661f\u6cb3\u9875\u9762\u81ea\u52a8\u5316\u64cd\u4f5c\u5931\u8d25。' });
    });
    return true;
  });
})();

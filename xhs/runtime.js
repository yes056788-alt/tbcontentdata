(function initXhsRuntime(root, factory) {
  const contract = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.XhsContract;
  const api = factory(contract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsRuntimeApi(contract) {
  'use strict';

  if (!contract) throw new Error('XhsContract must be loaded before XhsRuntime');

  const MESSAGE_TYPE = 'XHS_COLLECTION_START';
  const STATUS_KEY = 'xhsCollectionStatusV1';
  const RUN_KEY_PREFIX = 'xhsCollectionRunV1:';
  const PLATFORM_ORDER = Object.freeze(['adstar', 'pgy', 'juguang']);
  const READY_STATUSES = new Set(['complete', 'verified_no_spend']);
  const PLATFORM_CONFIG = Object.freeze({
    adstar: Object.freeze({
      origin: 'https://adstar.alimama.com', name: '淘宝星河', hookFile: 'adstar-page-hook.js',
    }),
    pgy: Object.freeze({
      origin: 'https://pgy.xiaohongshu.com', name: '蒲公英', hookFile: 'pgy-page-hook.js',
    }),
    juguang: Object.freeze({
      origin: 'https://ad.xiaohongshu.com', name: '聚光', hookFile: 'juguang-page-hook.js',
    }),
  });
  const PLATFORM_CONTENT_FILE = 'xhs-platform-content.js';
  const REPORT_SENDERS = new Set([
    'https://tbdata.aizicheng.com/report.html',
    'http://localhost:3400/report.html',
    'http://127.0.0.1:3400/report.html',
  ]);
  const INTERNAL_KEYS = new Set([
    'raw', 'rawresponse', 'response', 'responses', 'pages', 'indexeddb', 'cache',
    'cachekey', 'fingerprint', 'checkpoint', 'checkpoints',
  ]);

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isoNow(now) {
    const value = now();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    if (Number.isFinite(Number(value))) return new Date(Number(value)).toISOString();
    return new Date().toISOString();
  }

  function errorRecord(error, code, fields) {
    return contract.sanitizeSensitiveData(Object.assign({
      code: code || error && error.code || 'XHS_COLLECTION_FAILED',
      message: String(error && error.message || error || '小红书取数失败'),
    }, fields || {}));
  }

  function compactValue(value, seen) {
    if (value == null || typeof value !== 'object') {
      return contract.sanitizeSensitiveData(value);
    }
    const visited = seen || new WeakSet();
    if (visited.has(value)) return undefined;
    visited.add(value);
    if (Array.isArray(value)) {
      return value.map((item) => compactValue(item, visited)).filter((item) => item !== undefined);
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (INTERNAL_KEYS.has(normalized) || normalized.startsWith('raw') ||
          normalized.startsWith('checkpoint')) continue;
      const compacted = compactValue(item, visited);
      if (compacted !== undefined) output[key] = compacted;
    }
    return contract.sanitizeSensitiveData(output);
  }

  function compactPlatformResult(value, platform, fallback) {
    const source = isObject(value) ? value : {};
    return Object.assign({
      schemaVersion: 1,
      platform,
      status: fallback || 'failed',
      warnings: [],
      errors: [],
    }, compactValue(source));
  }

  function statusOfPlatforms(platforms, requested) {
    const statuses = requested.map((platform) => String(platforms[platform] && platforms[platform].status || 'failed'));
    if (statuses.length && statuses.every((status) => READY_STATUSES.has(status))) return 'complete';
    if (statuses.length && statuses.every((status) => ['failed', 'cancelled'].includes(status))) return 'failed';
    return 'partial';
  }

  function platformAccountSummary(platform, value) {
    const collection = isObject(value) ? value : {};
    if (platform === 'adstar') {
      const identity = isObject(collection.identity) ? collection.identity : {};
      const identified = Boolean(identity.memberId || identity.id || identity.memberName);
      return {
        accountLabel: identified
          ? String(identity.memberName || '已识别淘宝星河账号').trim().slice(0, 128)
          : '',
        accountCount: identified ? 1 : 0,
      };
    }
    if (platform === 'pgy') {
      const identity = isObject(collection.identity) ? collection.identity : {};
      const identified = Boolean(identity.brandUserId || identity.brandUserName);
      return {
        accountLabel: identified
          ? String(identity.brandUserName || '已识别蒲公英品牌账号').trim().slice(0, 128)
          : '',
        accountCount: identified ? 1 : 0,
      };
    }
    if (platform === 'juguang') {
      const units = Array.isArray(collection.accounts) ? collection.accounts : [];
      const accounts = units.map((unit) => isObject(unit && unit.account) ? unit.account : unit)
        .filter(isObject);
      const main = accounts.find((account) => Number(account.accountType) === 4) || null;
      const brand = isObject(main && main.brand) ? main.brand : {};
      const label = main && (
        brand.brandUserName || main.brandUserName || main.name || main.accountName
      );
      return {
        accountLabel: label
          ? String(label).trim().slice(0, 128)
          : accounts.length ? `已识别 ${accounts.length} 个聚光账户` : '',
        accountCount: accounts.length,
      };
    }
    return { accountLabel: '', accountCount: 0 };
  }

  function platformStatusSnapshot(platforms) {
    return Object.fromEntries(Object.entries(platforms).map(([id, value]) => {
      const account = platformAccountSummary(id, value);
      return [id, contract.sanitizeSensitiveData({
        status: value.status,
        collectedAt: value.finishedAt || value.startedAt || null,
        accountLabel: account.accountLabel,
        accountCount: account.accountCount,
        warnings: value.warnings || [],
        errors: value.errors || [],
      })];
    }));
  }

  function senderAllowed(chromeApi, sender) {
    if (!sender || sender.id !== chromeApi.runtime.id || typeof sender.url !== 'string') return false;
    let url;
    try {
      url = new URL(sender.url);
    } catch (error) {
      return false;
    }
    return REPORT_SENDERS.has(`${url.origin}${url.pathname}`);
  }

  function exactPlatformTabs(tabs, platform) {
    const expected = PLATFORM_CONFIG[platform];
    return (Array.isArray(tabs) ? tabs : []).filter((tab) => {
      try {
        return Number.isInteger(Number(tab.id)) && new URL(tab.url).origin === expected.origin;
      } catch (error) {
        return false;
      }
    });
  }

  function validateIdentity(actualValue, expectedValue) {
    const actual = isObject(actualValue) ? actualValue : {};
    const expected = isObject(expectedValue) ? expectedValue : {};
    for (const key of ['advertiserId', 'accountType']) {
      if (expected[key] != null && Number(actual[key]) !== Number(expected[key])) {
        throw new Error(`Juguang account identity ${key} mismatch`);
      }
    }
    if ((Number(expected.accountType) === 602 || expected.vSellerId) &&
        String(actual.vSellerId || '') !== String(expected.vSellerId || '')) {
      throw new Error('Juguang account identity vSellerId mismatch');
    }
    return compactValue(actual);
  }

  function juguangAccountDisplayNames(value) {
    const source = isObject(value) ? value : {};
    const normalizeName = (candidate) => {
      if (typeof candidate !== 'string') return '';
      return String(contract.sanitizeSensitiveData(candidate) || '')
        .replace(/\s+/g, ' ')
        .trim();
    };
    const accountNames = [
      source.name,
      source.accountName,
      source.agentSubAccountName,
      isObject(source.owner) ? source.owner.name : null,
      isObject(source.subAccount) ? source.subAccount.agentSubAccountName : null,
    ].map(normalizeName).filter(Boolean);
    const brandNames = [
      source.brandUserName,
      isObject(source.brand) ? source.brand.brandUserName : null,
    ].map(normalizeName).filter(Boolean);
    const names = [];
    const addName = (safe) => {
      if (!safe || safe.length > 128 || names.includes(safe)) return;
      names.push(safe);
    };
    if (Number(source.accountType) === 602) {
      for (const brand of brandNames) {
        for (const account of accountNames) {
          if (brand === account || account.includes(brand)) continue;
          addName(`${brand}-${account}`);
        }
      }
    }
    for (const safe of accountNames) addName(safe);
    for (const safe of brandNames) addName(safe);
    return names;
  }

  function createXhsRuntime(options) {
    const settings = isObject(options) ? options : {};
    const chromeApi = settings.chrome;
    if (!chromeApi || !chromeApi.runtime || !chromeApi.tabs || !chromeApi.storage || !chromeApi.storage.local) {
      throw new Error('XHS runtime requires chrome runtime, tabs and storage APIs.');
    }
    if (!settings.pageClient || typeof settings.pageClient.request !== 'function') {
      throw new Error('XHS runtime pageClient is required.');
    }
    if (!settings.cache) throw new Error('XHS runtime collection cache is required.');
    const collectorFactories = isObject(settings.collectors) ? settings.collectors : {};
    const now = typeof settings.now === 'function' ? settings.now : () => new Date().toISOString();
    const createRunId = typeof settings.createRunId === 'function'
      ? settings.createRunId
      : () => `xhs-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const wait = typeof settings.wait === 'function'
      ? settings.wait
      : (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));
    const bridgeRetry = Object.assign({ attempts: 5, delayMs: 500 }, settings.bridgeRetry || {});
    const navigationRetry = Object.assign({ attempts: 60, delayMs: 250 }, settings.navigationRetry || {});
    const allowLegacyNavigationFallback = settings.allowLegacyNavigationFallback === true;
    const monotonicNow = typeof settings.monotonicNow === 'function'
      ? settings.monotonicNow
      : () => Date.now();
    const transitionTimeoutMs = Math.max(10, Number(settings.transitionTimeoutMs) || 15000);
    const identityProbeTimeoutMs = Math.max(10, Number(settings.identityProbeTimeoutMs) || 1500);

    function bridgeRecoveryError(message, cause) {
      const error = new Error(message || 'Juguang page bridge recovery failed.');
      error.code = 'XHS_PAGE_BRIDGE_RECOVERY_FAILED';
      error.retryable = true;
      if (cause) error.cause = cause;
      return error;
    }

    async function withinTransitionDeadline(operation, deadlineAt, message) {
      const remaining = Number(deadlineAt) - monotonicNow();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        throw bridgeRecoveryError(message || 'Juguang transition deadline expired.');
      }
      const pending = Promise.resolve().then(operation);
      pending.catch(() => {});
      let timer = null;
      try {
        return await Promise.race([
          pending,
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(bridgeRecoveryError(
              message || 'Juguang transition deadline expired.'
            )), Math.max(1, remaining));
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    function juguangUrlMatches(value, expectation) {
      let url;
      try {
        url = new URL(String(value || ''));
      } catch (error) {
        return false;
      }
      if (url.origin !== PLATFORM_CONFIG.juguang.origin) return false;
      const expected = isObject(expectation) ? expectation : {};
      if (!Object.prototype.hasOwnProperty.call(expected, 'vSellerId')) return true;
      const actualVSellerId = url.searchParams.get('vSellerId');
      return expected.vSellerId == null
        ? !actualVSellerId
        : String(actualVSellerId || '') === String(expected.vSellerId);
    }

    async function waitForJuguangDocument(tabId, expectation) {
      if (!chromeApi.tabs || typeof chromeApi.tabs.get !== 'function') return;
      const attempts = Math.max(1, Math.floor(Number(navigationRetry.attempts) || 1));
      const expected = isObject(expectation) ? expectation : {};
      let lastError = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const tab = await chromeApi.tabs.get(tabId);
          if (tab && juguangUrlMatches(tab.url, expected) && tab.status === 'complete') return;
        } catch (error) {
          lastError = error;
        }
        if (attempt < attempts) {
          await wait(Math.max(0, Number(navigationRetry.delayMs) || 0));
        }
      }
      throw bridgeRecoveryError(
        'Juguang navigation did not reach a complete platform document before bridge recovery.',
        lastError,
      );
    }

    async function armJuguangNavigation(tabId, expectation, deadlineAt) {
      const navigation = chromeApi.webNavigation;
      const committedEvent = navigation && navigation.onCommitted;
      if (!navigation || typeof navigation.getFrame !== 'function' || !committedEvent ||
          typeof committedEvent.addListener !== 'function' ||
          typeof committedEvent.removeListener !== 'function') {
        if (allowLegacyNavigationFallback) return null;
        throw bridgeRecoveryError('Juguang document lifecycle tracking is unavailable.');
      }

      let baseline;
      try {
        baseline = await withinTransitionDeadline(
          () => navigation.getFrame({ tabId: Number(tabId), frameId: 0 }),
          deadlineAt,
          'Juguang current document identity timed out.',
        );
      } catch (error) {
        throw bridgeRecoveryError('Juguang current document identity could not be read.', error);
      }
      const previousDocumentId = String(baseline && baseline.documentId || '');
      if (!previousDocumentId) {
        throw bridgeRecoveryError('Juguang current documentId is unavailable.');
      }

      let settled = false;
      let timer = null;
      let listener = null;
      let settleReject;
      const cleanup = () => {
        if (listener) committedEvent.removeListener(listener);
        if (timer) clearTimeout(timer);
        listener = null;
        timer = null;
      };
      const promise = new Promise((resolve, reject) => {
        settleReject = reject;
        listener = (details) => {
          if (settled || !details || Number(details.tabId) !== Number(tabId) ||
              Number(details.frameId) !== 0 ||
              (details.documentLifecycle && details.documentLifecycle !== 'active') ||
              !details.documentId || String(details.documentId) === previousDocumentId ||
              !juguangUrlMatches(details.url, expectation)) return;
          settled = true;
          cleanup();
          resolve({
            documentId: String(details.documentId),
            url: String(details.url || ''),
          });
        };
        committedEvent.addListener(listener);
        const remaining = Math.max(1, Number(deadlineAt) - monotonicNow());
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(bridgeRecoveryError('Juguang navigation did not commit a new platform document in time.'));
        }, remaining);
      });
      // The navigation trigger may itself be pending while the lifecycle timer settles.
      // Mark the promise observed immediately; callers still receive the same rejection when awaiting it.
      promise.catch(() => {});
      return {
        promise,
        cancel(error) {
          if (settled) return;
          settled = true;
          cleanup();
          settleReject(error || bridgeRecoveryError('Juguang navigation was cancelled.'));
        },
      };
    }

    async function recoverJuguangBridgeAfterNavigation(tabId, expectation, lifecycle, deadlineAt) {
      if (!lifecycle) {
        await waitForJuguangDocument(tabId, expectation);
        await recoverPlatformBridge(tabId, 'juguang', null, deadlineAt);
        return null;
      }
      const committed = await lifecycle.promise;
      await recoverPlatformBridge(tabId, 'juguang', committed.documentId, deadlineAt);
      return committed;
    }

    async function requestJuguangCurrent(tabId, expectedIdentity, deadlineAt) {
      const attempts = Math.max(1, Math.floor(Number(bridgeRetry.attempts) || 1));
      let lastError = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const remaining = Number.isFinite(Number(deadlineAt))
          ? Number(deadlineAt) - monotonicNow()
          : identityProbeTimeoutMs;
        if (remaining <= 0) break;
        try {
          const actual = await settings.pageClient.request({
            tabId,
            platform: 'juguang',
            endpoint: 'accounts.current',
            payload: {},
            timeoutMs: Math.max(1, Math.min(identityProbeTimeoutMs, remaining)),
          });
          return expectedIdentity ? validateIdentity(actual, expectedIdentity) : actual;
        } catch (error) {
          lastError = error;
          if (attempt < attempts) {
            const delayMs = Math.max(0, Number(bridgeRetry.delayMs) || 0);
            const remainingAfter = Number.isFinite(Number(deadlineAt))
              ? Number(deadlineAt) - monotonicNow()
              : delayMs;
            if (remainingAfter <= 0) break;
            await wait(Math.min(delayMs, remainingAfter));
          }
        }
      }
      throw lastError || new Error('Juguang page bridge unavailable after navigation.');
    }

    async function switchJuguangAccount(input) {
      const source = isObject(input) ? input : {};
      const tabId = Number(source.tabId);
      const target = isObject(source.target) ? source.target : {};
      const safePath = /^\/aurora\/ad\/datareports-basic\/[a-z0-9/_-]+$/i.test(String(source.reportPath || ''))
        ? String(source.reportPath)
        : '/aurora/ad/datareports-basic/note';
      const url = new URL(safePath, PLATFORM_CONFIG.juguang.origin);
      if (target.vSellerId) url.searchParams.set('vSellerId', String(target.vSellerId));
      const expectation = { vSellerId: target.vSellerId || null };
      const deadlineAt = monotonicNow() + transitionTimeoutMs;
      const lifecycle = await armJuguangNavigation(tabId, expectation, deadlineAt);
      try {
        await withinTransitionDeadline(
          () => chromeApi.tabs.update(tabId, { url: url.toString() }),
          deadlineAt,
          'Juguang account navigation timed out.',
        );
      } catch (error) {
        if (lifecycle) {
          lifecycle.cancel(error);
          await lifecycle.promise.catch(() => {});
        }
        throw error;
      }
      await recoverJuguangBridgeAfterNavigation(tabId, expectation, lifecycle, deadlineAt);
      return requestJuguangCurrent(tabId, target, deadlineAt);
    }

    async function returnToJuguangMainAccount(input) {
      const source = isObject(input) ? input : {};
      const tabId = Number(source.tabId);
      if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Juguang tabId is required.');

      const knownCurrent = isObject(source.current) ? source.current : null;
      if (knownCurrent && Number(knownCurrent.accountType) === 4) {
        const deadlineAt = monotonicNow() + transitionTimeoutMs;
        return requestJuguangCurrent(tabId, { accountType: 4 }, deadlineAt);
      }
      if (!chromeApi.scripting || typeof chromeApi.scripting.executeScript !== 'function') {
        throw new Error('Juguang return-to-main requires chrome.scripting.executeScript.');
      }

      const accountDisplayNames = juguangAccountDisplayNames(knownCurrent);
      const expectation = { vSellerId: null };
      const deadlineAt = monotonicNow() + transitionTimeoutMs;
      const lifecycle = await armJuguangNavigation(tabId, expectation, deadlineAt);
      let recoveryError = null;
      const actionPromise = (async () => {
        try {
          await chromeApi.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            args: [accountDisplayNames],
            func: async function clickJuguangReturnToMain(displayNames) {
            const normalizedText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const exactNames = (Array.isArray(displayNames) ? displayNames : [])
              .map(normalizedText)
              .filter(Boolean);
            const clickable = (element) => element && (
              element.closest && element.closest('button,[role="button"],a,li,[role="menuitem"]') || element
            );
            const visibleClickable = (element) => {
              const target = clickable(element);
              if (!target || typeof target.click !== 'function' ||
                  typeof target.getBoundingClientRect !== 'function') return null;
              const rect = target.getBoundingClientRect();
              if (Number(rect.width) <= 0 || Number(rect.height) <= 0) return null;
              if (target.disabled === true || target.getAttribute && (
                target.getAttribute('aria-hidden') === 'true' ||
                target.getAttribute('aria-disabled') === 'true'
              )) return null;
              const view = target.ownerDocument && target.ownerDocument.defaultView;
              const style = view && typeof view.getComputedStyle === 'function'
                ? view.getComputedStyle(target)
                : null;
              if (style && (
                style.display === 'none' || style.visibility === 'hidden' ||
                style.pointerEvents === 'none' || String(style.opacity) === '0'
              )) return null;
              return target;
            };
            const findReturnAction = () => {
              for (const element of Array.from(document.querySelectorAll(
                'button,[role="button"],a,li,[role="menuitem"],span,div'
              ))) {
                if (normalizedText(element.textContent) !== '返回主账户') continue;
                const target = visibleClickable(element);
                if (target) return target;
              }
              return null;
            };
            const clickReturnAction = () => {
              const target = findReturnAction();
              if (!target) return false;
              target.click();
              return true;
            };

            const accountTriggerSelector = [
              'button', '[role="button"]', 'a', '[aria-haspopup="menu"]',
              '[class*="account"]', '[class*="Account"]',
            ].join(',');
            const findExactAccountTrigger = () => {
              const elements = Array.from(document.querySelectorAll(accountTriggerSelector));
              for (const exactName of exactNames) {
                const match = elements.find((element) => {
                  if (!element || typeof element.getBoundingClientRect !== 'function') return false;
                  const rect = element.getBoundingClientRect();
                  if (Number(rect.width) <= 0 || Number(rect.height) <= 0) return false;
                  const values = [
                    element.textContent,
                    element.getAttribute && element.getAttribute('aria-label'),
                    element.getAttribute && element.getAttribute('title'),
                  ].map(normalizedText).filter(Boolean);
                  return values.some((text) => text === exactName);
                });
                if (match) return match;
              }
              return null;
            };
            const findVisibleHeaderAvatar = () => {
              const viewportWidth = Number(
                document.documentElement && document.documentElement.clientWidth
              ) || Number.POSITIVE_INFINITY;
              let selected = null;
              let selectedRight = Number.NEGATIVE_INFINITY;
              for (const element of Array.from(document.querySelectorAll(
                'img.avatar,[class*="avatar"],[class*="Avatar"]'
              ))) {
                if (!element || typeof element.getBoundingClientRect !== 'function') continue;
                const rect = element.getBoundingClientRect();
                const right = Number(rect.right);
                const visible = Number(rect.width) > 0 && Number(rect.height) > 0 &&
                  Number(rect.top) >= 0 && Number(rect.top) < 80 &&
                  Number(rect.left) >= 0 && right <= viewportWidth + 1;
                if (!visible || right <= selectedRight) continue;
                selected = element;
                selectedRight = right;
              }
              return selected;
            };

            if (clickReturnAction()) return true;
            const exactTrigger = findExactAccountTrigger();
            const headerAvatar = exactTrigger ? null : findVisibleHeaderAvatar();
            const triggers = exactTrigger || headerAvatar ? [] : Array.from(document.querySelectorAll(
              accountTriggerSelector
            ));
            const trigger = exactTrigger || headerAvatar || triggers.find((element) => {
              const text = normalizedText(element.textContent);
              const label = normalizedText(element.getAttribute && element.getAttribute('aria-label'));
              return /账户|切换|广告主/.test(`${text} ${label}`);
            });
            const triggerTarget = clickable(trigger);
            if (triggerTarget && typeof triggerTarget.click === 'function') triggerTarget.click();

            const deadline = Date.now() + 3000;
            while (Date.now() < deadline) {
              if (clickReturnAction()) return true;
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            throw new Error('Juguang return-to-main action was not found.');
            },
          });
        } catch (error) {
          // Clicking the action navigates the tab and may destroy the execution context before
          // Chrome can return the function result. The committed document and identity are authoritative.
          if (!lifecycle) throw error;
          if (lifecycle && !/frame.*removed|execution context|context.*invalidated|document.*unload/i.test(
            String(error && error.message || error || '')
          )) lifecycle.cancel(error);
        }
      })();

      try {
        if (!lifecycle) await actionPromise;
        await recoverJuguangBridgeAfterNavigation(tabId, expectation, lifecycle, deadlineAt);
      } catch (error) {
        recoveryError = error;
      }
      // Observe rejection without allowing a destroyed execution context to become unhandled.
      actionPromise.catch(() => {});
      if (recoveryError) throw recoveryError;
      return requestJuguangCurrent(tabId, { accountType: 4 }, deadlineAt);
    }

    const collectorInstances = {};
    for (const platform of PLATFORM_ORDER) {
      const factory = collectorFactories[platform];
      if (typeof factory !== 'function') continue;
      collectorInstances[platform] = factory({
        chrome: chromeApi,
        pageClient: settings.pageClient,
        cache: settings.cache,
        now,
        switchAccount: platform === 'juguang' ? switchJuguangAccount : undefined,
        returnToMainAccount: platform === 'juguang' ? returnToJuguangMainAccount : undefined,
      });
    }

    async function writeStatus(value) {
      await chromeApi.storage.local.set({ [STATUS_KEY]: compactValue(value) });
    }

    async function recoverPlatformBridge(tabId, platform, documentId, deadlineAt) {
      const config = PLATFORM_CONFIG[platform];
      if (!config || !config.hookFile || !chromeApi.scripting ||
          typeof chromeApi.scripting.executeScript !== 'function') {
        const unavailable = new Error(`${config && config.name || platform}页面桥接自动恢复不可用。`);
        unavailable.code = 'XHS_PAGE_BRIDGE_RECOVERY_FAILED';
        unavailable.retryable = false;
        throw unavailable;
      }
      try {
        const target = documentId
          ? { tabId: Number(tabId), documentIds: [String(documentId)] }
          : { tabId: Number(tabId), frameIds: [0] };
        const execute = (details) => Number.isFinite(Number(deadlineAt))
          ? withinTransitionDeadline(
            () => chromeApi.scripting.executeScript(details),
            deadlineAt,
            `${config.name}页面桥接注入超时。`,
          )
          : chromeApi.scripting.executeScript(details);
        await execute({
          target,
          world: 'MAIN',
          files: [config.hookFile],
          injectImmediately: true,
        });
        await execute({
          target,
          world: 'ISOLATED',
          files: [PLATFORM_CONTENT_FILE],
          injectImmediately: true,
        });
      } catch (error) {
        const recoveryError = new Error(
          `${config.name}页面桥接自动恢复失败，请刷新该平台页面后重试：` +
          String(error && error.message || error || '脚本注入失败')
        );
        recoveryError.code = 'XHS_PAGE_BRIDGE_RECOVERY_FAILED';
        recoveryError.retryable = true;
        throw recoveryError;
      }
    }

    async function executeRun(input) {
      const source = isObject(input) ? input : {};
      const runId = String(source.runId || createRunId()).trim();
      const accountKey = String(source.accountKey || '').trim();
      const dateRange = compactValue(source.dateRange || {});
      const requested = PLATFORM_ORDER.filter((platform) => (
        !Array.isArray(source.platforms) || source.platforms.includes(platform)
      ));
      const startedAt = isoNow(now);
      const platforms = {};
      if (!runId || !accountKey || !dateRange.from || !dateRange.to || requested.length === 0) {
        throw new Error('XHS runId, accountKey, dateRange and supported platforms are required.');
      }

      await writeStatus({
        schemaVersion: 1, runId, running: true, status: 'running',
        startedAt, updatedAt: startedAt, requestedPlatforms: requested, platforms: {},
      });
      try {
        const tabs = await chromeApi.tabs.query({});

        for (const platform of requested) {
          const matchingTabs = exactPlatformTabs(tabs, platform);
          const tab = matchingTabs.length === 1 ? matchingTabs[0] : null;
          if (matchingTabs.length === 0) {
            const expected = PLATFORM_CONFIG[platform];
            platforms[platform] = compactPlatformResult({
              platform,
              status: 'failed',
              schemaValid: false,
              paginationComplete: false,
              reconciled: false,
              dateRange,
              warnings: [],
              errors: [{
                code: 'XHS_PLATFORM_TAB_MISSING',
                message: `未找到已登录的${expected.name}页面，请先打开 ${expected.origin}。`,
              }],
            }, platform);
          } else if (matchingTabs.length > 1) {
            const expected = PLATFORM_CONFIG[platform];
            platforms[platform] = compactPlatformResult({
              platform,
              status: 'failed',
              schemaValid: false,
              paginationComplete: false,
              reconciled: false,
              dateRange,
              warnings: [],
              errors: [{
                code: 'XHS_PLATFORM_TAB_AMBIGUOUS',
                message: `检测到多个已登录的${expected.name}页面，请关闭重复标签页后重试，仅保留一个 ${expected.origin} 页面。`,
              }],
            }, platform);
          } else if (!collectorInstances[platform] || typeof collectorInstances[platform].collect !== 'function') {
            platforms[platform] = compactPlatformResult({
              platform,
              status: 'failed',
              dateRange,
              errors: [{ code: 'XHS_COLLECTOR_UNAVAILABLE', message: `${PLATFORM_CONFIG[platform].name}采集器未加载。` }],
            }, platform);
          } else {
            try {
              await recoverPlatformBridge(Number(tab.id), platform);
              const result = await collectorInstances[platform].collect({
                tabId: Number(tab.id), runId, accountKey, dateRange,
                pageSize: source.pageSize,
                maxPages: source.maxPages,
                maxProjects: source.maxProjects,
                maxOrders: source.maxOrders,
                memberType: source.memberType,
                verifiedIdentity: source.verifiedIdentity,
              });
              platforms[platform] = compactPlatformResult(result, platform);
            } catch (error) {
              platforms[platform] = compactPlatformResult({
                platform,
                runId,
                accountKey,
                dateRange,
                status: 'failed',
                schemaValid: false,
                paginationComplete: false,
                reconciled: false,
                warnings: [],
                errors: [errorRecord(error, error && error.code || 'XHS_COLLECTION_FAILED', {
                  retryable: error && error.retryable !== false,
                })],
              }, platform);
            }
          }
          await writeStatus({
            schemaVersion: 1, runId, running: true, status: 'running',
            startedAt, updatedAt: isoNow(now), requestedPlatforms: requested,
            platforms: platformStatusSnapshot(platforms),
          });
        }

        const finishedAt = isoNow(now);
        const status = statusOfPlatforms(platforms, requested);
        const compactRun = compactValue({
          schema: 'xhsCollectionRunV1', schemaVersion: 1, runId, accountKey, dateRange,
          status, startedAt, finishedAt, requestedPlatforms: requested, platforms,
        });
        await chromeApi.storage.local.set({ [`${RUN_KEY_PREFIX}${runId}`]: compactRun });
        await writeStatus({
          schemaVersion: 1, runId, running: false, status, startedAt, finishedAt,
          updatedAt: finishedAt, requestedPlatforms: requested,
          platforms: platformStatusSnapshot(platforms),
        });
        return compactRun;
      } catch (error) {
        const failedAt = isoNow(now);
        try {
          await writeStatus({
            schemaVersion: 1,
            runId,
            running: false,
            status: 'failed',
            startedAt,
            finishedAt: failedAt,
            updatedAt: failedAt,
            requestedPlatforms: requested,
            platforms: platformStatusSnapshot(platforms),
            errors: [errorRecord(error, 'XHS_RUN_FAILED')],
          });
        } catch (statusError) {}
        throw error;
      }
    }

    let activeRunPromise = null;

    function run(input) {
      if (activeRunPromise) {
        const error = new Error('已有小红书取数任务正在运行。');
        error.code = 'XHS_RUN_ACTIVE';
        return Promise.reject(error);
      }
      let guardedPromise;
      guardedPromise = (async () => {
        try {
          return await executeRun(input);
        } finally {
          if (activeRunPromise === guardedPromise) activeRunPromise = null;
        }
      })();
      activeRunPromise = guardedPromise;
      return guardedPromise;
    }

    async function handleMessage(message, sender) {
      if (!message || message.type !== MESSAGE_TYPE) return { handled: false };
      try {
        if (!senderAllowed(chromeApi, sender)) {
          return { ok: false, code: 'XHS_SENDER_DENIED', error: '小红书取数请求来源不受信任。' };
        }
        return { ok: true, result: await run(message.payload) };
      } catch (error) {
        const failure = errorRecord(error, error && error.code || 'XHS_RUN_INVALID');
        return { ok: false, code: failure.code, error: failure.message };
      }
    }

    function register() {
      chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || message.type !== MESSAGE_TYPE) return undefined;
        handleMessage(message, sender).then(sendResponse, (error) => sendResponse({
          ok: false,
          code: 'XHS_RUNTIME_ERROR',
          error: errorRecord(error, 'XHS_RUNTIME_ERROR').message,
        }));
        return true;
      });
    }

    return Object.freeze({ handleMessage, register, run });
  }

  return Object.freeze({
    MESSAGE_TYPE,
    PLATFORM_CONFIG,
    RUN_KEY_PREFIX,
    STATUS_KEY,
    createXhsRuntime,
  });
});

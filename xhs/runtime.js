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
  const BRIDGE_UNAVAILABLE_CODE = 'XHS_PAGE_BRIDGE_UNAVAILABLE';
  const VERIFICATION_REQUIRED_CODE = 'VERIFICATION_REQUIRED';
  const CONFIRMED_VERIFICATION_ERROR = Symbol('confirmedVerificationError');
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

  function abortError(signal) {
    const reason = signal && signal.reason;
    if (reason && typeof reason === 'object' && reason.name === 'AbortError') return reason;
    const error = new Error(
      typeof reason === 'string' && reason.trim() ? reason : '小红书取数任务已取消。'
    );
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    error.retryable = false;
    return error;
  }

  function isAbortError(_error, signal) {
    return Boolean(signal && signal.aborted);
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw abortError(signal);
  }

  function isVerificationRequiredError(error) {
    return Boolean(error) && error.code === VERIFICATION_REQUIRED_CODE &&
      error[CONFIRMED_VERIFICATION_ERROR] === true;
  }

  function verificationRequiredError(platform, tabId) {
    const config = PLATFORM_CONFIG[platform];
    const error = new Error(`${config && config.name || platform}需要人工安全验证。`);
    error.code = VERIFICATION_REQUIRED_CODE;
    error.platform = platform;
    error.tabId = Number(tabId);
    error.retryable = false;
    Object.defineProperty(error, CONFIRMED_VERIFICATION_ERROR, { value: true });
    return error;
  }

  function raceWithSignal(value, signal) {
    throwIfAborted(signal);
    const pending = Promise.resolve(value);
    if (!signal || typeof signal.addEventListener !== 'function') return pending;
    let listener = null;
    const cancelled = new Promise((_resolve, reject) => {
      listener = () => reject(abortError(signal));
      signal.addEventListener('abort', listener, { once: true });
      if (signal.aborted) listener();
    });
    return Promise.race([pending, cancelled]).finally(() => {
      if (listener) signal.removeEventListener('abort', listener);
    });
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
    if (expected.requireAdvertiserId === true &&
        (!Number.isFinite(Number(actual.advertiserId)) || Number(actual.advertiserId) <= 0)) {
      throw new Error('Juguang main-account identity advertiserId is missing');
    }
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
    const probeVerification = typeof settings.probeVerification === 'function'
      ? settings.probeVerification
      : null;
    const stateMutationPromises = new Set();
    const activePlatformTabIds = new Map();
    const taskOwnedPlatformTabIds = new Map();
    const concurrentJuguangTabIds = new Set();
    const successfulPlatformResponses = new Set();

    function trackStateMutation(value) {
      const pending = Promise.resolve(value);
      stateMutationPromises.add(pending);
      pending.then(
        () => stateMutationPromises.delete(pending),
        () => stateMutationPromises.delete(pending),
      );
      // A cancellation may stop awaiting the public operation while Chrome still owns it.
      pending.catch(() => {});
      return pending;
    }

    async function drainStateMutations() {
      while (stateMutationPromises.size > 0) {
        await Promise.allSettled(Array.from(stateMutationPromises));
      }
    }

    function waitWithSignal(delayMs, signal) {
      return raceWithSignal(wait(delayMs), signal);
    }

    async function assertVerificationNotRequired(platform, tabId, signal) {
      if (!probeVerification) return null;
      throwIfAborted(signal);
      const probing = Promise.resolve().then(() => probeVerification({
        platform,
        tabId: Number(tabId),
        signal,
      }));
      probing.catch(() => {});
      let state;
      try {
        state = await raceWithSignal(probing, signal);
      } catch (error) {
        if (isAbortError(error, signal)) throw abortError(signal);
        return null;
      }
      throwIfAborted(signal);
      if (isObject(state) && String(state.kind || '') === 'verification') {
        throw verificationRequiredError(platform, tabId);
      }
      return state;
    }

    function platformTabError(platform, code) {
      const expected = PLATFORM_CONFIG[platform];
      const ambiguous = code === 'XHS_PLATFORM_TAB_AMBIGUOUS';
      const error = new Error(ambiguous
        ? `检测到多个${expected.name}同源页面（可能位于其他窗口、折叠标签组或来自旧任务），请关闭重复标签页后重试，仅保留一个 ${expected.origin} 页面。`
        : `未找到已登录的${expected.name}页面，请先打开 ${expected.origin}。`);
      error.code = ambiguous ? 'XHS_PLATFORM_TAB_AMBIGUOUS' : 'XHS_PLATFORM_TAB_MISSING';
      error.retryable = false;
      return error;
    }

    async function queryUniquePlatformTab(platform, signal, activate) {
      throwIfAborted(signal);
      const shouldActivate = activate !== false;
      const tabs = await raceWithSignal(chromeApi.tabs.query({}), signal);
      const matchingTabs = exactPlatformTabs(tabs, platform);
      if (matchingTabs.length !== 1) {
        if (shouldActivate) activePlatformTabIds.delete(platform);
        throw platformTabError(
          platform,
          matchingTabs.length > 1 ? 'XHS_PLATFORM_TAB_AMBIGUOUS' : 'XHS_PLATFORM_TAB_MISSING',
        );
      }
      const tab = matchingTabs[0];
      if (shouldActivate) activePlatformTabIds.set(platform, Number(tab.id));
      return tab;
    }

    function platformTabChangedError(platform) {
      const expected = PLATFORM_CONFIG[platform];
      const error = new Error(
        `${expected && expected.name || platform}页面在取数过程中被替换；为避免跨账号数据混合，已停止本次采集。`
      );
      error.code = 'XHS_PLATFORM_TAB_CHANGED';
      error.retryable = false;
      return error;
    }

    function activePlatformTabId(platform, fallback) {
      const active = activePlatformTabIds.get(platform);
      return Number.isInteger(active) ? active : Number(fallback);
    }

    function requestedTaskOwnedTabId(source, platform) {
      const values = isObject(source && source.taskOwnedTabIds) ? source.taskOwnedTabIds : {};
      const tabId = Number(values[platform]);
      return Number.isInteger(tabId) && tabId > 0 ? tabId : null;
    }

    function isPinnedPlatformRequest(source) {
      const platform = String(source && source.platform || '');
      return source && (source.pinnedTabId === true ||
        taskOwnedPlatformTabIds.get(platform) === Number(source.tabId) ||
        concurrentJuguangTabIds.has(Number(source.tabId)));
    }

    async function resolvePinnedPlatformTab(platform, tabId, signal) {
      throwIfAborted(signal);
      let tab = null;
      try {
        if (chromeApi.tabs && typeof chromeApi.tabs.get === 'function') {
          tab = await raceWithSignal(chromeApi.tabs.get(Number(tabId)), signal);
        } else {
          const tabs = await raceWithSignal(chromeApi.tabs.query({}), signal);
          tab = (tabs || []).find((entry) => Number(entry && entry.id) === Number(tabId)) || null;
        }
      } catch (error) {
        if (isAbortError(error, signal)) throw abortError(signal);
        tab = null;
      }
      if (!tab || exactPlatformTabs([tab], platform).length !== 1) {
        throw platformTabChangedError(platform);
      }
      return tab;
    }

    async function requestPageWithBridgeRecovery(input) {
      const source = isObject(input) ? input : {};
      const platform = String(source.platform || '');
      const signal = source.signal;
      const pinned = isPinnedPlatformRequest(source);
      throwIfAborted(signal);
      const firstRequest = Object.assign({}, source, {
        tabId: pinned ? Number(source.tabId) : activePlatformTabId(platform, source.tabId),
      });
      try {
        const result = await settings.pageClient.request(firstRequest);
        successfulPlatformResponses.add(platform);
        return result;
      } catch (error) {
        if (isAbortError(error, signal)) throw abortError(signal);
        if (!error || error.code !== BRIDGE_UNAVAILABLE_CODE) throw error;
        const tab = pinned
          ? await resolvePinnedPlatformTab(platform, firstRequest.tabId, signal)
          : await queryUniquePlatformTab(platform, signal, false);
        const replacementTabId = Number(tab.id);
        if (!pinned && replacementTabId !== Number(firstRequest.tabId) &&
            successfulPlatformResponses.has(platform)) {
          throw platformTabChangedError(platform);
        }
        if (!pinned) activePlatformTabIds.set(platform, replacementTabId);
        await recoverPlatformBridge(Number(tab.id), platform, null, undefined, signal);
        throwIfAborted(signal);
        const result = await settings.pageClient.request(Object.assign({}, source, {
          tabId: replacementTabId,
        }));
        successfulPlatformResponses.add(platform);
        return result;
      }
    }

    const runtimePageClient = Object.freeze({ request: requestPageWithBridgeRecovery });

    function bridgeRecoveryError(message, cause) {
      const error = new Error(message || 'Juguang page bridge recovery failed.');
      error.code = 'XHS_PAGE_BRIDGE_RECOVERY_FAILED';
      error.retryable = true;
      if (cause) error.cause = cause;
      return error;
    }

    async function withinTransitionDeadline(operation, deadlineAt, message, signal) {
      throwIfAborted(signal);
      const remaining = Number(deadlineAt) - monotonicNow();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        throw bridgeRecoveryError(message || 'Juguang transition deadline expired.');
      }
      const pending = Promise.resolve().then(operation);
      pending.catch(() => {});
      let timer = null;
      try {
        return await raceWithSignal(Promise.race([
          pending,
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(bridgeRecoveryError(
              message || 'Juguang transition deadline expired.'
            )), Math.max(1, remaining));
          }),
        ]), signal);
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

    async function waitForJuguangDocument(tabId, expectation, signal) {
      throwIfAborted(signal);
      if (!chromeApi.tabs || typeof chromeApi.tabs.get !== 'function') return;
      const attempts = Math.max(1, Math.floor(Number(navigationRetry.attempts) || 1));
      const expected = isObject(expectation) ? expectation : {};
      let lastError = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        throwIfAborted(signal);
        try {
          const tab = await raceWithSignal(chromeApi.tabs.get(tabId), signal);
          if (tab && juguangUrlMatches(tab.url, expected) && tab.status === 'complete') return;
        } catch (error) {
          lastError = error;
        }
        if (attempt < attempts) {
          await waitWithSignal(Math.max(0, Number(navigationRetry.delayMs) || 0), signal);
        }
      }
      throw bridgeRecoveryError(
        'Juguang navigation did not reach a complete platform document before bridge recovery.',
        lastError,
      );
    }

    async function armJuguangNavigation(tabId, expectation, deadlineAt, signal) {
      throwIfAborted(signal);
      const navigation = chromeApi.webNavigation;
      const committedEvent = navigation && navigation.onCommitted;
      const beforeNavigateEvent = navigation && navigation.onBeforeNavigate;
      const historyStateEvent = navigation && navigation.onHistoryStateUpdated;
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
          signal,
        );
      } catch (error) {
        throw bridgeRecoveryError('Juguang current document identity could not be read.', error);
      }
      const previousDocumentId = String(baseline && baseline.documentId || '');
      if (!previousDocumentId) {
        throw bridgeRecoveryError('Juguang current documentId is unavailable.');
      }

      let settled = false;
      let navigationStarted = false;
      let timer = null;
      let listener = null;
      let beforeNavigateListener = null;
      let historyStateListener = null;
      let abortListener = null;
      let settleReject;
      let navigationStartedSettled = false;
      let resolveNavigationStarted;
      let rejectNavigationStarted;
      let sameDocumentSettled = false;
      let sameDocumentUpdated = false;
      let resolveSameDocument;
      let rejectSameDocument;
      const sameDocumentPromise = new Promise((resolve, reject) => {
        resolveSameDocument = resolve;
        rejectSameDocument = reject;
      });
      const navigationStartedPromise = new Promise((resolve, reject) => {
        resolveNavigationStarted = resolve;
        rejectNavigationStarted = reject;
      });
      sameDocumentPromise.catch(() => {});
      navigationStartedPromise.catch(() => {});
      const settleNavigationStarted = (error, value) => {
        if (navigationStartedSettled) return;
        navigationStartedSettled = true;
        if (error) rejectNavigationStarted(error);
        else resolveNavigationStarted(value);
      };
      const settleSameDocument = (error, value) => {
        if (sameDocumentSettled) return;
        sameDocumentSettled = true;
        if (error) rejectSameDocument(error);
        else resolveSameDocument(value);
      };
      const cleanup = () => {
        if (listener) committedEvent.removeListener(listener);
        if (beforeNavigateListener && beforeNavigateEvent &&
            typeof beforeNavigateEvent.removeListener === 'function') {
          beforeNavigateEvent.removeListener(beforeNavigateListener);
        }
        if (historyStateListener && historyStateEvent &&
            typeof historyStateEvent.removeListener === 'function') {
          historyStateEvent.removeListener(historyStateListener);
        }
        if (timer) clearTimeout(timer);
        if (abortListener && signal) signal.removeEventListener('abort', abortListener);
        listener = null;
        beforeNavigateListener = null;
        historyStateListener = null;
        timer = null;
        abortListener = null;
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
          settleNavigationStarted(null, {
            documentId: String(details.documentId),
            url: String(details.url || ''),
          });
          settleSameDocument(bridgeRecoveryError(
            'Juguang return continued in a newly committed document.'
          ));
          cleanup();
          resolve({
            documentId: String(details.documentId),
            url: String(details.url || ''),
          });
        };
        if (beforeNavigateEvent && typeof beforeNavigateEvent.addListener === 'function' &&
            typeof beforeNavigateEvent.removeListener === 'function') {
          beforeNavigateListener = (details) => {
            if (settled || !details || Number(details.tabId) !== Number(tabId) ||
                Number(details.frameId) !== 0 || !juguangUrlMatches(details.url, expectation)) return;
            navigationStarted = true;
            settleNavigationStarted(null, {
              documentId: previousDocumentId,
              url: String(details.url || ''),
            });
          };
          beforeNavigateEvent.addListener(beforeNavigateListener);
        }
        if (historyStateEvent && typeof historyStateEvent.addListener === 'function' &&
            typeof historyStateEvent.removeListener === 'function') {
          historyStateListener = (details) => {
            if (settled || !details || Number(details.tabId) !== Number(tabId) ||
                Number(details.frameId) !== 0 ||
                (details.documentLifecycle && details.documentLifecycle !== 'active') ||
                (details.documentId && String(details.documentId) !== previousDocumentId) ||
                !juguangUrlMatches(details.url, expectation)) return;
            sameDocumentUpdated = true;
            settleSameDocument(null, {
              documentId: previousDocumentId,
              url: String(details.url || ''),
            });
          };
          historyStateEvent.addListener(historyStateListener);
        }
        committedEvent.addListener(listener);
        if (signal && typeof signal.addEventListener === 'function') {
          abortListener = () => {
            if (settled) return;
            settled = true;
            settleNavigationStarted(abortError(signal));
            settleSameDocument(abortError(signal));
            cleanup();
            reject(abortError(signal));
          };
          signal.addEventListener('abort', abortListener, { once: true });
          if (signal.aborted) abortListener();
        }
        if (settled) return;
        const remaining = Math.max(1, Number(deadlineAt) - monotonicNow());
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          settleNavigationStarted(bridgeRecoveryError(
            'Juguang navigation did not commit a new platform document in time.'
          ));
          settleSameDocument(bridgeRecoveryError(
            'Juguang navigation did not commit a new platform document in time.'
          ));
          cleanup();
          reject(bridgeRecoveryError('Juguang navigation did not commit a new platform document in time.'));
        }, remaining);
      });
      // The navigation trigger may itself be pending while the lifecycle timer settles.
      // Mark the promise observed immediately; callers still receive the same rejection when awaiting it.
      promise.catch(() => {});
      return {
        promise,
        navigationStartedPromise,
        sameDocumentPromise,
        previousDocumentId,
        hasStarted() {
          return navigationStarted;
        },
        hasSameDocumentUpdate() {
          return sameDocumentUpdated;
        },
        isSettled() {
          return settled;
        },
        cancel(error) {
          if (settled) return;
          settled = true;
          settleNavigationStarted(error || bridgeRecoveryError('Juguang navigation was cancelled.'));
          settleSameDocument(error || bridgeRecoveryError('Juguang navigation was cancelled.'));
          cleanup();
          settleReject(error || bridgeRecoveryError('Juguang navigation was cancelled.'));
        },
      };
    }

    async function recoverVerifiedJuguangDocumentIfChanged(
      tabId, expectation, lifecycle, expectedIdentity, deadlineAt, signal
    ) {
      if (!lifecycle || !lifecycle.previousDocumentId || !chromeApi.webNavigation ||
          typeof chromeApi.webNavigation.getFrame !== 'function') return null;
      const frame = await withinTransitionDeadline(
        () => chromeApi.webNavigation.getFrame({ tabId: Number(tabId), frameId: 0 }),
        deadlineAt,
        'Juguang current document reconciliation timed out.',
        signal,
      );
      const documentId = String(frame && frame.documentId || '');
      if (!documentId || documentId === String(lifecycle.previousDocumentId)) return null;
      if (!juguangUrlMatches(frame.url, expectation)) {
        throw bridgeRecoveryError('Juguang changed to an unverified platform document.');
      }
      if (frame.documentLifecycle && frame.documentLifecycle !== 'active') return null;
      if (chromeApi.tabs && typeof chromeApi.tabs.get === 'function') {
        const tab = await withinTransitionDeadline(
          () => chromeApi.tabs.get(Number(tabId)),
          deadlineAt,
          'Juguang current tab reconciliation timed out.',
          signal,
        );
        if (!tab || tab.status !== 'complete' || tab.pendingUrl ||
            !juguangUrlMatches(tab.url, expectation)) return null;
      }
      await recoverPlatformBridge(tabId, 'juguang', documentId, deadlineAt, signal);
      const actual = await requestJuguangCurrentUntilDeadline(
        tabId, expectedIdentity, deadlineAt, signal
      );
      const confirmed = await withinTransitionDeadline(
        () => chromeApi.webNavigation.getFrame({ tabId: Number(tabId), frameId: 0 }),
        deadlineAt,
        'Juguang recovered document confirmation timed out.',
        signal,
      );
      if (!confirmed || String(confirmed.documentId || '') !== documentId ||
          (confirmed.documentLifecycle && confirmed.documentLifecycle !== 'active') ||
          !juguangUrlMatches(confirmed.url, expectation)) {
        throw bridgeRecoveryError('Juguang document changed during main-account verification.');
      }
      return actual;
    }

    function waitForTransitionPoll(delayMs, signal) {
      throwIfAborted(signal);
      let timer = null;
      let abortListener = null;
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          if (timer) clearTimeout(timer);
          if (abortListener && signal) signal.removeEventListener('abort', abortListener);
          timer = null;
          abortListener = null;
        };
        timer = setTimeout(() => {
          cleanup();
          resolve();
        }, Math.max(1, Number(delayMs) || 1));
        if (signal && typeof signal.addEventListener === 'function') {
          abortListener = () => {
            cleanup();
            reject(abortError(signal));
          };
          signal.addEventListener('abort', abortListener, { once: true });
          if (signal.aborted) abortListener();
        }
      });
    }

    async function waitForVerifiedJuguangDocumentChange(
      tabId, expectation, lifecycle, expectedIdentity, deadlineAt, signal
    ) {
      while (Number(deadlineAt) - monotonicNow() > 0) {
        throwIfAborted(signal);
        if (!lifecycle || (typeof lifecycle.isSettled === 'function' && lifecycle.isSettled())) {
          throw bridgeRecoveryError('Juguang navigation reconciliation was superseded.');
        }
        const actual = await recoverVerifiedJuguangDocumentIfChanged(
          tabId,
          expectation,
          lifecycle,
          expectedIdentity,
          deadlineAt,
          signal,
        );
        if (actual) return actual;
        const remaining = Number(deadlineAt) - monotonicNow();
        if (remaining <= 0) break;
        await waitForTransitionPoll(Math.min(50, remaining), signal);
      }
      throw bridgeRecoveryError('Juguang main document could not be reconciled before timeout.');
    }

    async function isStableJuguangBaselineDocument(
      tabId, expectation, lifecycle, deadlineAt, signal
    ) {
      if (!lifecycle || !lifecycle.previousDocumentId || !chromeApi.webNavigation ||
          typeof chromeApi.webNavigation.getFrame !== 'function') return false;
      const frame = await withinTransitionDeadline(
        () => chromeApi.webNavigation.getFrame({ tabId: Number(tabId), frameId: 0 }),
        deadlineAt,
        'Juguang same-document confirmation timed out.',
        signal,
      );
      if (!frame || String(frame.documentId || '') !== String(lifecycle.previousDocumentId) ||
          (frame.documentLifecycle && frame.documentLifecycle !== 'active') ||
          !juguangUrlMatches(frame.url, expectation)) return false;
      if (!chromeApi.tabs || typeof chromeApi.tabs.get !== 'function') return true;
      const tab = await withinTransitionDeadline(
        () => chromeApi.tabs.get(Number(tabId)),
        deadlineAt,
        'Juguang same-document tab confirmation timed out.',
        signal,
      );
      return Boolean(tab && tab.status === 'complete' && !tab.pendingUrl &&
        juguangUrlMatches(tab.url, expectation));
    }

    async function recoverJuguangBridgeAfterNavigation(
      tabId, expectation, lifecycle, deadlineAt, signal
    ) {
      throwIfAborted(signal);
      if (!lifecycle) {
        await waitForJuguangDocument(tabId, expectation, signal);
        await recoverPlatformBridge(tabId, 'juguang', null, deadlineAt, signal);
        return null;
      }
      const committed = await lifecycle.promise;
      await recoverPlatformBridge(tabId, 'juguang', committed.documentId, deadlineAt, signal);
      return committed;
    }

    async function requestJuguangCurrent(tabId, expectedIdentity, deadlineAt, signal) {
      const attempts = Math.max(1, Math.min(16, Math.floor(Number(bridgeRetry.attempts) || 1)));
      let lastError = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        throwIfAborted(signal);
        const remaining = Number.isFinite(Number(deadlineAt))
          ? Number(deadlineAt) - monotonicNow()
          : identityProbeTimeoutMs;
        if (remaining <= 0) break;
        try {
          const actual = await runtimePageClient.request({
            tabId,
            platform: 'juguang',
            endpoint: 'accounts.current',
            payload: {},
            timeoutMs: Math.max(1, Math.min(identityProbeTimeoutMs, remaining)),
            signal,
          });
          return expectedIdentity ? validateIdentity(actual, expectedIdentity) : actual;
        } catch (error) {
          if (isAbortError(error, signal)) throw abortError(signal);
          lastError = error;
          if (attempt < attempts) {
            const delayMs = Math.max(0, Number(bridgeRetry.delayMs) || 0);
            const remainingAfter = Number.isFinite(Number(deadlineAt))
              ? Number(deadlineAt) - monotonicNow()
              : delayMs;
            if (remainingAfter <= 0) break;
            await waitWithSignal(Math.min(delayMs, remainingAfter), signal);
          }
        }
      }
      throw lastError || new Error('Juguang page bridge unavailable after navigation.');
    }

    async function requestJuguangCurrentUntilDeadline(tabId, expectedIdentity, deadlineAt, signal) {
      let lastError = null;
      const delayMs = Math.max(1, Number(bridgeRetry.delayMs) || 1);
      const attemptsPerBatch = Math.max(
        1,
        Math.min(16, Math.floor(Number(bridgeRetry.attempts) || 1)),
      );
      const maxBatches = Math.min(
        Math.max(1, Math.floor(64 / attemptsPerBatch)),
        Math.max(1, Math.ceil(transitionTimeoutMs / delayMs)),
      );
      for (let batch = 0; batch < maxBatches && Number(deadlineAt) - monotonicNow() > 0; batch += 1) {
        throwIfAborted(signal);
        try {
          return await requestJuguangCurrent(tabId, expectedIdentity, deadlineAt, signal);
        } catch (error) {
          if (isAbortError(error, signal)) throw abortError(signal);
          lastError = error;
        }
        const remaining = Number(deadlineAt) - monotonicNow();
        if (remaining <= 0) break;
        await waitWithSignal(Math.min(delayMs, remaining), signal);
      }
      throw lastError || bridgeRecoveryError('Juguang main-account identity verification timed out.');
    }

    async function switchJuguangAccount(input) {
      const source = isObject(input) ? input : {};
      const signal = source.signal;
      throwIfAborted(signal);
      const tabId = isPinnedPlatformRequest(source)
        ? Number(source.tabId)
        : activePlatformTabId('juguang', source.tabId);
      const target = isObject(source.target) ? source.target : {};
      const safePath = /^\/aurora\/ad\/datareports-basic\/[a-z0-9/_-]+$/i.test(String(source.reportPath || ''))
        ? String(source.reportPath)
        : '/aurora/ad/datareports-basic/note';
      const url = new URL(safePath, PLATFORM_CONFIG.juguang.origin);
      if (target.vSellerId) url.searchParams.set('vSellerId', String(target.vSellerId));
      const expectation = { vSellerId: target.vSellerId || null };
      const deadlineAt = monotonicNow() + transitionTimeoutMs;
      const lifecycle = await armJuguangNavigation(tabId, expectation, deadlineAt, signal);
      try {
        await withinTransitionDeadline(
          () => trackStateMutation(chromeApi.tabs.update(tabId, { url: url.toString() })),
          deadlineAt,
          'Juguang account navigation timed out.',
          signal,
        );
      } catch (error) {
        if (lifecycle) {
          lifecycle.cancel(error);
          await lifecycle.promise.catch(() => {});
        }
        throw error;
      }
      await recoverJuguangBridgeAfterNavigation(
        tabId, expectation, lifecycle, deadlineAt, signal
      );
      // A newly created background tab can finish its document navigation before the
      // advertiser identity has converged from the main account to the requested child.
      // Keep probing for the remainder of the same bounded transition budget instead of
      // treating the first short retry batch as a permanent tab-isolation failure.
      return requestJuguangCurrentUntilDeadline(tabId, target, deadlineAt, signal);
    }

    async function returnToJuguangMainAccount(input) {
      const source = isObject(input) ? input : {};
      const signal = source.signal;
      throwIfAborted(signal);
      const tabId = isPinnedPlatformRequest(source)
        ? Number(source.tabId)
        : activePlatformTabId('juguang', source.tabId);
      if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Juguang tabId is required.');

      const knownCurrent = isObject(source.current) ? source.current : null;
      const expectedMainIdentity = { accountType: 4, requireAdvertiserId: true };
      if (knownCurrent && Number(knownCurrent.accountType) === 4) {
        const deadlineAt = monotonicNow() + transitionTimeoutMs;
        return requestJuguangCurrentUntilDeadline(
          tabId, expectedMainIdentity, deadlineAt, signal
        );
      }
      if (!chromeApi.scripting || typeof chromeApi.scripting.executeScript !== 'function') {
        throw new Error('Juguang return-to-main requires chrome.scripting.executeScript.');
      }

      const accountDisplayNames = juguangAccountDisplayNames(knownCurrent);
      // Returning to the main account may be an in-document SPA transition and some
      // main-account URLs retain a vSellerId query value. The verified account identity,
      // not the URL shape, is the authoritative completion signal for this direction.
      const expectation = {};
      const deadlineAt = monotonicNow() + transitionTimeoutMs;
      const lifecycle = await armJuguangNavigation(tabId, expectation, deadlineAt, signal);
      let actionError = null;
      const actionPromise = (async () => {
        try {
          await raceWithSignal(trackStateMutation(chromeApi.scripting.executeScript({
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
          })), signal);
        } catch (error) {
          if (isAbortError(error, signal)) {
            if (lifecycle) lifecycle.cancel(abortError(signal));
            throw abortError(signal);
          }
          // Clicking the action navigates the tab and may destroy the execution context before
          // Chrome can return the function result. The committed document and identity are authoritative.
          if (!lifecycle) throw error;
          if (!/frame.*removed|execution context|context.*invalidated|document.*unload/i.test(
            String(error && error.message || error || '')
          )) {
            actionError = error;
            lifecycle.cancel(error);
          }
        }
      })();

      // Observe rejection without allowing a destroyed execution context to become unhandled.
      actionPromise.catch(() => {});
      if (!lifecycle) {
        return withinTransitionDeadline(async () => {
          await actionPromise;
          await recoverJuguangBridgeAfterNavigation(
            tabId, expectation, lifecycle, deadlineAt, signal
          );
          return requestJuguangCurrentUntilDeadline(
            tabId, expectedMainIdentity, deadlineAt, signal
          );
        }, deadlineAt, 'Juguang main-account verification timed out.', signal);
      }

      let navigationError = null;
      let sameDocumentError = null;
      const navigationIdentity = (async () => {
        let committedIdentityError = null;
        let reconciledIdentityError = null;
        try {
          return await Promise.any([
            (async () => {
              try {
                await recoverJuguangBridgeAfterNavigation(
                  tabId, expectation, lifecycle, deadlineAt, signal
                );
                return await requestJuguangCurrentUntilDeadline(
                  tabId, expectedMainIdentity, deadlineAt, signal
                );
              } catch (error) {
                committedIdentityError = error;
                throw error;
              }
            })(),
            (async () => {
              try {
                return await waitForVerifiedJuguangDocumentChange(
                  tabId,
                  expectation,
                  lifecycle,
                  expectedMainIdentity,
                  deadlineAt,
                  signal,
                );
              } catch (error) {
                reconciledIdentityError = error;
                throw error;
              }
            })(),
          ]);
        } catch (error) {
          navigationError = reconciledIdentityError || committedIdentityError || error;
          throw navigationError;
        }
      })();
      navigationIdentity.catch(() => {});
      const navigationOutcome = navigationIdentity.then(
        (value) => ({ status: 'fulfilled', value }),
        (error) => ({ status: 'rejected', error }),
      );

      const sameDocumentIdentity = (async () => {
        try {
          await Promise.any([actionPromise, lifecycle.sameDocumentPromise]);
          const remaining = Math.max(1, Number(deadlineAt) - monotonicNow());
          const graceMs = Math.min(100, Math.max(1, Math.floor(remaining / 4)));
          let graceTimer = null;
          const earlyNavigation = await Promise.race([
            navigationOutcome,
            new Promise((resolve) => {
              graceTimer = setTimeout(() => resolve(null), graceMs);
            }),
          ]);
          if (graceTimer) clearTimeout(graceTimer);
          if (earlyNavigation && earlyNavigation.status === 'fulfilled') {
            return earlyNavigation.value;
          }
          const reconciledDocumentIdentity = await recoverVerifiedJuguangDocumentIfChanged(
            tabId,
            expectation,
            lifecycle,
            expectedMainIdentity,
            deadlineAt,
            signal,
          );
          if (reconciledDocumentIdentity) return reconciledDocumentIdentity;
          if (!await isStableJuguangBaselineDocument(
            tabId, expectation, lifecycle, deadlineAt, signal
          )) {
            return await navigationIdentity;
          }
          const actual = await requestJuguangCurrentUntilDeadline(
            tabId,
            expectedMainIdentity,
            deadlineAt,
            signal,
          );
          const stabilityRemaining = Math.max(1, Number(deadlineAt) - monotonicNow());
          const stabilityMs = Math.min(250, Math.max(1, Math.floor(stabilityRemaining / 4)));
          let stabilityTimer = null;
          const lateCommit = await Promise.race([
            navigationOutcome,
            new Promise((resolve) => {
              stabilityTimer = setTimeout(() => resolve(null), stabilityMs);
            }),
          ]);
          if (stabilityTimer) clearTimeout(stabilityTimer);
          if (lateCommit && lateCommit.status === 'fulfilled') {
            return lateCommit.value;
          }
          if (typeof lifecycle.hasStarted === 'function' && lifecycle.hasStarted()) {
            return await navigationIdentity;
          }
          if (!await isStableJuguangBaselineDocument(
            tabId, expectation, lifecycle, deadlineAt, signal
          )) {
            return await navigationIdentity;
          }
          return actual;
        } catch (error) {
          sameDocumentError = error;
          throw error;
        }
      })();
      sameDocumentIdentity.catch(() => {});

      try {
        return await withinTransitionDeadline(
          () => Promise.any([navigationIdentity, sameDocumentIdentity]),
          deadlineAt,
          'Juguang main-account verification timed out.',
          signal,
        );
      } catch (error) {
        throw actionError || sameDocumentError || navigationError || error;
      } finally {
        lifecycle.cancel(isAbortError(null, signal)
          ? abortError(signal)
          : bridgeRecoveryError('Juguang main-account identity was resolved.'));
      }
    }

    async function closeConcurrentJuguangTabs(input) {
      const source = isObject(input) ? input : {};
      const tabIds = (Array.isArray(source.tabIds) ? source.tabIds : [])
        .map(Number)
        .filter((tabId) => Number.isInteger(tabId) && concurrentJuguangTabIds.has(tabId));
      if (tabIds.length === 0) return [];
      if (!chromeApi.tabs || typeof chromeApi.tabs.remove !== 'function') {
        throw new Error('Juguang concurrent tab cleanup requires chrome.tabs.remove.');
      }
      await trackStateMutation(chromeApi.tabs.remove(tabIds));
      tabIds.forEach((tabId) => concurrentJuguangTabIds.delete(tabId));
      return tabIds;
    }

    async function createConcurrentJuguangTabs(input) {
      const source = isObject(input) ? input : {};
      const signal = source.signal;
      const count = Math.min(3, Math.max(2, Math.floor(Number(source.count) || 0)));
      if (!chromeApi.tabs || typeof chromeApi.tabs.create !== 'function' ||
          typeof chromeApi.tabs.remove !== 'function') {
        throw new Error('Juguang concurrent collection requires chrome.tabs.create/remove.');
      }
      const created = [];
      try {
        for (let index = 0; index < count; index += 1) {
          throwIfAborted(signal);
          const tab = await raceWithSignal(trackStateMutation(chromeApi.tabs.create({
            url: 'about:blank',
            active: false,
          })), signal);
          const tabId = Number(tab && tab.id);
          if (!Number.isInteger(tabId) || tabId < 0) {
            throw new Error('Juguang temporary tab did not return a valid tabId.');
          }
          concurrentJuguangTabIds.add(tabId);
          created.push(tabId);
        }
        return created;
      } catch (error) {
        await closeConcurrentJuguangTabs({ tabIds: created }).catch(() => {});
        if (isAbortError(error, signal)) throw abortError(signal);
        throw error;
      }
    }

    const collectorInstances = {};
    for (const platform of PLATFORM_ORDER) {
      const factory = collectorFactories[platform];
      if (typeof factory !== 'function') continue;
      collectorInstances[platform] = factory({
        chrome: chromeApi,
        pageClient: runtimePageClient,
        cache: settings.cache,
        now,
        switchAccount: platform === 'juguang' ? switchJuguangAccount : undefined,
        returnToMainAccount: platform === 'juguang' ? returnToJuguangMainAccount : undefined,
        createConcurrentAccountTabs: platform === 'juguang'
          ? createConcurrentJuguangTabs
          : undefined,
        closeConcurrentAccountTabs: platform === 'juguang'
          ? closeConcurrentJuguangTabs
          : undefined,
      });
    }

    async function writeStatus(value) {
      await chromeApi.storage.local.set({ [STATUS_KEY]: compactValue(value) });
    }

    async function removeRunIfExact(key, expectedRun) {
      const storage = chromeApi.storage && chromeApi.storage.local;
      if (!storage || typeof storage.get !== 'function' || typeof storage.remove !== 'function') {
        return false;
      }
      const stored = await storage.get(key);
      const actual = isObject(stored) ? stored[key] : null;
      if (!actual || JSON.stringify(compactValue(actual)) !== JSON.stringify(expectedRun)) {
        return false;
      }
      await storage.remove(key);
      return true;
    }

    async function recoverPlatformBridge(tabId, platform, documentId, deadlineAt, signal) {
      throwIfAborted(signal);
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
        const execute = (details) => {
          const operation = () => trackStateMutation(chromeApi.scripting.executeScript(details));
          return deadlineAt != null && Number.isFinite(Number(deadlineAt))
            ? withinTransitionDeadline(
              operation,
              deadlineAt,
              `${config.name}页面桥接注入超时。`,
              signal,
            )
            : raceWithSignal(operation(), signal);
        };
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
        if (isAbortError(error, signal)) throw abortError(signal);
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
      const signal = source.signal;
      const runId = String(source.runId || createRunId()).trim();
      const accountKey = String(source.accountKey || '').trim();
      const dateRange = compactValue(source.dateRange || {});
      const requested = PLATFORM_ORDER.filter((platform) => (
        !Array.isArray(source.platforms) || source.platforms.includes(platform)
      ));
      const startedAt = isoNow(now);
      const platforms = {};
      const runStorageKey = `${RUN_KEY_PREFIX}${runId}`;
      let archiveCandidate = null;
      let runningStatusWrite = Promise.resolve();
      if (!runId || !accountKey || !dateRange.from || !dateRange.to || requested.length === 0) {
        throw new Error('XHS runId, accountKey, dateRange and supported platforms are required.');
      }

      activePlatformTabIds.clear();
      taskOwnedPlatformTabIds.clear();
      successfulPlatformResponses.clear();

      for (const platform of requested) {
        platforms[platform] = compactPlatformResult({
          platform,
          runId,
          accountKey,
          dateRange,
          status: 'running',
          startedAt,
          warnings: [],
          errors: [],
        }, platform, 'running');
      }

      function publishRunningStatus() {
        const pending = runningStatusWrite.then(() => {
          throwIfAborted(signal);
          return writeStatus({
            schemaVersion: 1, runId, running: true, status: 'running',
            startedAt, updatedAt: isoNow(now), requestedPlatforms: requested,
            platforms: platformStatusSnapshot(platforms),
          });
        });
        runningStatusWrite = pending.catch(() => {});
        return pending;
      }

      async function collectPlatform(platform) {
        throwIfAborted(signal);
        let tab = null;
        let tabError = null;
        try {
          const taskOwnedTabId = requestedTaskOwnedTabId(source, platform);
          if (taskOwnedTabId !== null) {
            tab = await resolvePinnedPlatformTab(platform, taskOwnedTabId, signal);
            taskOwnedPlatformTabIds.set(platform, taskOwnedTabId);
            activePlatformTabIds.set(platform, taskOwnedTabId);
          } else {
            tab = await queryUniquePlatformTab(platform, signal);
          }
        } catch (error) {
          if (isAbortError(error, signal)) throw abortError(signal);
          if (['XHS_PLATFORM_TAB_MISSING', 'XHS_PLATFORM_TAB_AMBIGUOUS'].includes(error && error.code)) {
            tabError = error;
          } else {
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
              errors: [errorRecord(error, error && error.code || 'XHS_RUN_FAILED')],
            }, platform);
            await publishRunningStatus();
            return;
          }
        }
        if (tabError) {
          platforms[platform] = compactPlatformResult({
            platform,
            status: 'failed',
            schemaValid: false,
            paginationComplete: false,
            reconciled: false,
            dateRange,
            warnings: [],
            errors: [errorRecord(tabError, tabError.code, { retryable: false })],
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
            await assertVerificationNotRequired(platform, Number(tab.id), signal);
            await recoverPlatformBridge(Number(tab.id), platform, null, undefined, signal);
            const result = await raceWithSignal(collectorInstances[platform].collect({
              tabId: Number(tab.id), runId, accountKey, dateRange,
              pageSize: source.pageSize,
              maxPages: source.maxPages,
              maxProjects: source.maxProjects,
              maxOrders: source.maxOrders,
              taskConcurrency: source.taskConcurrency,
              concurrentAccountTabs: source.concurrentAccountTabs,
              memberType: source.memberType,
              verifiedIdentity: source.verifiedIdentity,
              signal,
            }), signal);
            throwIfAborted(signal);
            const compactResult = compactPlatformResult(result, platform);
            if (!READY_STATUSES.has(String(compactResult.status || 'failed'))) {
              await assertVerificationNotRequired(platform, Number(tab.id), signal);
            }
            platforms[platform] = compactResult;
          } catch (error) {
            if (isAbortError(error, signal)) throw abortError(signal);
            if (isVerificationRequiredError(error)) throw error;
            await assertVerificationNotRequired(platform, Number(tab.id), signal);
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
        throwIfAborted(signal);
        await publishRunningStatus();
      }

      await writeStatus({
        schemaVersion: 1, runId, running: true, status: 'running',
        startedAt, updatedAt: startedAt, requestedPlatforms: requested,
        platforms: platformStatusSnapshot(platforms),
      });
      try {
        throwIfAborted(signal);
        const platformRuns = await Promise.allSettled(requested.map((platform) => (
          collectPlatform(platform)
        )));
        throwIfAborted(signal);
        const verificationRun = platformRuns.find((result) => (
          result.status === 'rejected' && isVerificationRequiredError(result.reason)
        ));
        const rejectedRun = verificationRun || platformRuns.find((result) => result.status === 'rejected');
        if (rejectedRun) {
          throw rejectedRun.reason;
        }

        throwIfAborted(signal);
        const finishedAt = isoNow(now);
        const status = statusOfPlatforms(platforms, requested);
        const compactRun = compactValue({
          schema: 'xhsCollectionRunV1', schemaVersion: 1, runId, accountKey, dateRange,
          status, startedAt, finishedAt, requestedPlatforms: requested, platforms,
        });
        archiveCandidate = compactRun;
        await chromeApi.storage.local.set({ [runStorageKey]: compactRun });
        throwIfAborted(signal);
        await writeStatus({
          schemaVersion: 1, runId, running: false, status, startedAt, finishedAt,
          updatedAt: finishedAt, requestedPlatforms: requested,
          platforms: platformStatusSnapshot(platforms),
        });
        throwIfAborted(signal);
        return compactRun;
      } catch (error) {
        const failedAt = isoNow(now);
        const cancelled = isAbortError(error, signal);
        for (const platform of requested) {
          const current = isObject(platforms[platform]) ? platforms[platform] : {};
          if (String(current.status || '') !== 'running') continue;
          platforms[platform] = compactPlatformResult(Object.assign({}, current, {
            status: cancelled ? 'cancelled' : 'failed',
            finishedAt: failedAt,
            errors: cancelled
              ? []
              : [errorRecord(error, error && error.code || 'XHS_RUN_FAILED')],
          }), platform, cancelled ? 'cancelled' : 'failed');
        }
        if (cancelled && archiveCandidate) {
          try {
            await removeRunIfExact(runStorageKey, archiveCandidate);
          } catch (rollbackError) {}
        }
        try {
          await writeStatus({
            schemaVersion: 1,
            runId,
            running: false,
            status: cancelled ? 'cancelled' : 'failed',
            startedAt,
            finishedAt: failedAt,
            updatedAt: failedAt,
            requestedPlatforms: requested,
            platforms: platformStatusSnapshot(platforms),
            errors: cancelled ? [] : [errorRecord(error, 'XHS_RUN_FAILED')],
          });
        } catch (statusError) {}
        throw cancelled ? abortError(signal) : error;
      } finally {
        if (concurrentJuguangTabIds.size > 0) {
          await closeConcurrentJuguangTabs({
            tabIds: Array.from(concurrentJuguangTabIds),
          }).catch(() => {});
        }
        taskOwnedPlatformTabIds.clear();
      }
    }

    let activeRunPromise = null;
    let startupRecoveryPromise = null;

    function statusRevision(value) {
      const status = isObject(value) ? value : {};
      return JSON.stringify([
        status.runId || null,
        status.startedAt || null,
        status.updatedAt || null,
        status.status || null,
        status.running === true,
      ]);
    }

    async function recoverInterruptedRun() {
      if (activeRunPromise || !chromeApi.storage.local ||
          typeof chromeApi.storage.local.get !== 'function') return false;
      const stored = await chromeApi.storage.local.get(STATUS_KEY);
      const stale = isObject(stored) && isObject(stored[STATUS_KEY])
        ? stored[STATUS_KEY]
        : null;
      if (!stale || stale.running !== true) return false;

      // A second read prevents a different extension context from replacing the status while
      // startup recovery was inspecting it. Runs started through this runtime await this recovery.
      const confirmed = await chromeApi.storage.local.get(STATUS_KEY);
      const latest = isObject(confirmed) && isObject(confirmed[STATUS_KEY])
        ? confirmed[STATUS_KEY]
        : null;
      if (!latest || latest.running !== true || statusRevision(latest) !== statusRevision(stale)) {
        return false;
      }

      const finishedAt = isoNow(now);
      const interrupted = {
        code: 'XHS_RUN_INTERRUPTED',
        message: '扩展重启或后台中断，上一次小红书取数任务已终止。',
      };
      const platforms = Object.fromEntries(Object.entries(isObject(latest.platforms)
        ? latest.platforms : {}).map(([platform, value]) => {
        const safe = isObject(value) ? compactValue(value) : {};
        if (safe.status !== 'running' && safe.running !== true) return [platform, safe];
        return [platform, Object.assign({}, safe, {
          running: false,
          status: 'cancelled',
          errors: [{ ...interrupted }],
        })];
      }));
      await writeStatus(Object.assign({}, compactValue(latest), {
        running: false,
        status: 'cancelled',
        finishedAt,
        updatedAt: finishedAt,
        platforms,
        errors: [{ ...interrupted }],
      }));
      return true;
    }

    function run(input) {
      if (activeRunPromise) {
        const error = new Error('已有小红书取数任务正在运行。');
        error.code = 'XHS_RUN_ACTIVE';
        return Promise.reject(error);
      }
      let guardedPromise;
      guardedPromise = (async () => {
        if (startupRecoveryPromise) await startupRecoveryPromise;
        return executeRun(input);
      })();
      activeRunPromise = guardedPromise;
      const releaseOwnership = () => {
        if (activeRunPromise !== guardedPromise) return;
        if (stateMutationPromises.size === 0) {
          activeRunPromise = null;
          return;
        }
        drainStateMutations().then(() => {
          if (activeRunPromise === guardedPromise) activeRunPromise = null;
        });
      };
      guardedPromise.then(releaseOwnership, releaseOwnership);
      return guardedPromise;
    }

    async function handleMessage(message, sender) {
      if (!message || message.type !== MESSAGE_TYPE) return { handled: false };
      try {
        if (!senderAllowed(chromeApi, sender)) {
          return { ok: false, code: 'XHS_SENDER_DENIED', error: '小红书取数请求来源不受信任。' };
        }
        const payload = isObject(message.payload) ? Object.assign({}, message.payload) : message.payload;
        if (isObject(payload)) delete payload.taskOwnedTabIds;
        return { ok: true, result: await run(payload) };
      } catch (error) {
        const failure = errorRecord(error, error && error.code || 'XHS_RUN_INVALID');
        return { ok: false, code: failure.code, error: failure.message };
      }
    }

    function register() {
      if (!startupRecoveryPromise) {
        startupRecoveryPromise = recoverInterruptedRun().catch(() => false);
      }
      chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || message.type !== MESSAGE_TYPE) return undefined;
        handleMessage(message, sender).then(sendResponse, (error) => sendResponse({
          ok: false,
          code: 'XHS_RUNTIME_ERROR',
          error: errorRecord(error, 'XHS_RUNTIME_ERROR').message,
        }));
        return true;
      });
      return startupRecoveryPromise;
    }

    return Object.freeze({ handleMessage, register, run });
  }

  return Object.freeze({
    MESSAGE_TYPE,
    PLATFORM_CONFIG,
    RUN_KEY_PREFIX,
    STATUS_KEY,
    VERIFICATION_REQUIRED_CODE,
    createXhsRuntime,
  });
});

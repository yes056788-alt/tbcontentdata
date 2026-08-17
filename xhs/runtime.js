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
    const candidates = [
      source.name,
      source.accountName,
      source.brandUserName,
      source.agentSubAccountName,
      isObject(source.owner) ? source.owner.name : null,
      isObject(source.brand) ? source.brand.brandUserName : null,
      isObject(source.subAccount) ? source.subAccount.agentSubAccountName : null,
    ];
    const names = [];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const safe = String(contract.sanitizeSensitiveData(candidate) || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!safe || safe.length > 128 || names.includes(safe)) continue;
      names.push(safe);
    }
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

    async function requestJuguangCurrent(tabId) {
      const attempts = Math.max(1, Math.floor(Number(bridgeRetry.attempts) || 1));
      let lastError = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return await settings.pageClient.request({
            tabId,
            platform: 'juguang',
            endpoint: 'accounts.current',
            payload: {},
          });
        } catch (error) {
          lastError = error;
          if (attempt < attempts) await wait(Math.max(0, Number(bridgeRetry.delayMs) || 0));
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
      await chromeApi.tabs.update(tabId, { url: url.toString() });

      const attempts = Math.max(1, Math.floor(Number(bridgeRetry.attempts) || 1));
      let lastError = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const actual = await settings.pageClient.request({
            tabId,
            platform: 'juguang',
            endpoint: 'accounts.current',
            payload: {},
          });
          return validateIdentity(actual, target);
        } catch (error) {
          lastError = error;
          if (attempt < attempts) await wait(Math.max(0, Number(bridgeRetry.delayMs) || 0));
        }
      }
      throw lastError || new Error('Juguang page bridge unavailable after navigation.');
    }

    async function returnToJuguangMainAccount(input) {
      const source = isObject(input) ? input : {};
      const tabId = Number(source.tabId);
      if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Juguang tabId is required.');

      const knownCurrent = isObject(source.current) ? source.current : null;
      if (knownCurrent && Number(knownCurrent.accountType) === 4) {
        return validateIdentity(await requestJuguangCurrent(tabId), { accountType: 4 });
      }
      if (!chromeApi.scripting || typeof chromeApi.scripting.executeScript !== 'function') {
        throw new Error('Juguang return-to-main requires chrome.scripting.executeScript.');
      }

      const accountDisplayNames = juguangAccountDisplayNames(knownCurrent);
      let actionError = null;
      try {
        const executions = await chromeApi.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          args: [accountDisplayNames],
          func: async function clickJuguangReturnToMain(displayNames) {
            const normalizedText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const exactNames = new Set((Array.isArray(displayNames) ? displayNames : [])
              .map(normalizedText)
              .filter(Boolean));
            const clickable = (element) => element && (
              element.closest && element.closest('button,[role="button"],a,li,[role="menuitem"]') || element
            );
            const findReturnAction = () => Array.from(document.querySelectorAll(
              'button,[role="button"],a,li,[role="menuitem"],span,div'
            )).find((element) => normalizedText(element.textContent) === '返回主账户');
            const clickReturnAction = () => {
              const action = findReturnAction();
              if (!action) return false;
              const target = clickable(action);
              if (!target || typeof target.click !== 'function') return false;
              target.click();
              return true;
            };

            const accountTriggerSelector = [
              'button', '[role="button"]', 'a', '[aria-haspopup="menu"]',
              '[class*="account"]', '[class*="Account"]',
            ].join(',');
            const findExactAccountTrigger = () => Array.from(document.querySelectorAll(
              accountTriggerSelector
            )).find((element) => {
              const values = [
                element.textContent,
                element.getAttribute && element.getAttribute('aria-label'),
                element.getAttribute && element.getAttribute('title'),
              ].map(normalizedText).filter(Boolean);
              return values.some((text) => exactNames.has(text));
            });

            if (clickReturnAction()) return true;
            const exactTrigger = findExactAccountTrigger();
            const triggers = exactTrigger ? [] : Array.from(document.querySelectorAll(
              accountTriggerSelector
            ));
            const trigger = exactTrigger || triggers.find((element) => {
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
        const executed = Array.isArray(executions) && executions.some((entry) => (
          entry && (entry.result === true || entry.result && entry.result.ok === true)
        ));
        if (!executed) actionError = new Error('Juguang return-to-main action did not complete.');
      } catch (error) {
        // Clicking the action navigates the tab and may destroy the execution context before
        // Chrome can return the function result. The post-navigation identity is authoritative.
        actionError = error;
      }

      const attempts = Math.max(1, Math.floor(Number(bridgeRetry.attempts) || 1));
      let lastError = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const actual = await settings.pageClient.request({
            tabId,
            platform: 'juguang',
            endpoint: 'accounts.current',
            payload: {},
          });
          return validateIdentity(actual, { accountType: 4 });
        } catch (error) {
          lastError = error;
          if (attempt < attempts) await wait(Math.max(0, Number(bridgeRetry.delayMs) || 0));
        }
      }
      throw lastError || actionError || new Error('Juguang main-account identity could not be verified.');
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

    async function recoverPlatformBridge(tabId, platform) {
      const config = PLATFORM_CONFIG[platform];
      if (!config || !config.hookFile || !chromeApi.scripting ||
          typeof chromeApi.scripting.executeScript !== 'function') {
        const unavailable = new Error(`${config && config.name || platform}页面桥接自动恢复不可用。`);
        unavailable.code = 'XHS_PAGE_BRIDGE_RECOVERY_FAILED';
        unavailable.retryable = false;
        throw unavailable;
      }
      try {
        await chromeApi.scripting.executeScript({
          target: { tabId: Number(tabId), frameIds: [0] },
          world: 'MAIN',
          files: [config.hookFile],
        });
        await chromeApi.scripting.executeScript({
          target: { tabId: Number(tabId), frameIds: [0] },
          world: 'ISOLATED',
          files: [PLATFORM_CONTENT_FILE],
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

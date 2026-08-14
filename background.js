// background.js - 用 webRequest 拦截下载请求，获取文件内容后发给 content-script

importScripts(
  'xhs/contract.js',
  'xhs/quality.js',
  'xhs/local-cache.js',
  'xhs/collector-core.js',
  'xhs/page-client.js',
  'xhs/adstar-collector.js',
  'xhs/pgy-collector.js',
  'xhs/juguang-accounts.js',
  'xhs/juguang-collector.js'
);

const TAG = '[光合分析]';
const xhsPageClient = XhsPageClient.createPageClient({
  sendMessage: (tabId, envelope) => chrome.tabs.sendMessage(tabId, envelope),
});
const xhsLocalCollectionCache = XhsLocalCache.createIndexedDbCache({});
const xhsAdstarCollector = XhsAdstarCollector.createAdstarCollector({
  pageClient: xhsPageClient,
  cache: xhsLocalCollectionCache,
});
const SYCM_CONTENT_ANALYSIS_PATH = '/xsite/contentanalysis/overview_new_v2';
const WXT_TRACE_STORAGE_KEY = 'wxtReportApiTraceV1';
const WXT_TRACE_MAX_RECORDS = 120;
const BUSINESS_DEFENSE_XINGHE_URL = 'https://adstar.alimama.com/index.htm?forward=https%3A%2F%2Fadstar.alimama.com%2Findex.htm';
const BUSINESS_DEFENSE_XINGHE_LOGOUT_URL = 'https://adstar.alimama.com/openapi/param2/1/gateway.unionpub/union.logout?forward=https%3A%2F%2Fadstar.alimama.com%2Findex.htm';
const BUSINESS_DEFENSE_GH_URL = 'https://creator.guanghe.taobao.com/page/unify/asset-overview';
const GUANGHE_SETTINGS_HOST = 'xstore.insights.1688.com';
const GUANGHE_DATA_PATH = '/s-guanghe-creator/asset-overview';
const BUSINESS_DEFENSE_SYCM_TRAFFIC_URL = 'https://sycm.taobao.com/flow/monitor/overview';
const BUSINESS_DEFENSE_WXT_URL = 'https://one.alimama.com/indexbp.html#!/report/account?rptType=account';
const CONTENT_DIAGNOSIS_WXT_SHORT_URL = 'https://one.alimama.com/indexbp.html#!/report/short_video_migrate?rptType=short_video_migrate&bizCode=onebpShortVideo';
const BUSINESS_DEFENSE_DMP_URL = 'https://dmp.taobao.com/index_new.html#!/crowds-new/list';
const BUSINESS_DEFENSE_AUTO_STATUS_KEY = 'businessDefenseAutoCollectStatusV1';
const CONTENT_DIAGNOSIS_STATUS_KEY = 'taobaoContentDiagnosisReportStatusV1';
const CONTENT_DIAGNOSIS_REPORT_KEY = 'taobaoContentDiagnosisReportV1';
const CONTENT_DIAGNOSIS_WXT_KEY = 'taobaoContentDiagnosisWxtReportV1';
const ACCOUNT_BATCH_STATUS_KEY = 'taobaoAccountBatchStatusV1';
const ACCOUNT_VAULT_SESSION_KEY = 'taobaoAccountVaultSessionV1';
const PROJECT_TASK_STATUS_KEY = 'taobaoProjectTaskStatusV1';
const STORE_RUN_INDEX_KEY = 'taobaoStoreRunIndexV1';
const STORE_RUN_KEY_PREFIX = 'taobaoStoreRunV1:';
const PLATFORM_TASK_IDS = ['sycm', 'guanghe', 'wxt', 'dmp'];
const PLATFORM_RETRY_ATTEMPTS = 5;
const wxtTraceTabs = new Map();
let wxtTraceWriteQueue = Promise.resolve();
let businessDefenseAutoCollectPromise = null;
let contentDiagnosisReportPromise = null;
let accountBatchPromise = null;
let projectTaskPromise = null;
let accountBatchCancelRequested = false;

chrome.storage.local.get(BUSINESS_DEFENSE_AUTO_STATUS_KEY).then((stored) => {
  const previous = stored && stored[BUSINESS_DEFENSE_AUTO_STATUS_KEY];
  if (!previous || previous.running !== true || businessDefenseAutoCollectPromise) return;
  return chrome.storage.local.set({
    [BUSINESS_DEFENSE_AUTO_STATUS_KEY]: Object.assign({}, previous, {
      running: false,
      updatedAt: Date.now(),
      finishedAt: Date.now(),
      error: '上次自动取数在扩展重载或浏览器休眠后中断，请重新执行。',
    }),
  });
}).catch(() => {});

chrome.storage.local.get(CONTENT_DIAGNOSIS_STATUS_KEY).then((stored) => {
  const previous = stored && stored[CONTENT_DIAGNOSIS_STATUS_KEY];
  if (!previous || previous.running !== true || contentDiagnosisReportPromise) return;
  return chrome.storage.local.set({
    [CONTENT_DIAGNOSIS_STATUS_KEY]: Object.assign({}, previous, {
      running: false,
      updatedAt: Date.now(),
      finishedAt: Date.now(),
      error: '上次报告任务在扩展重载或浏览器休眠后中断，请重新生成。',
    }),
  });
}).catch(() => {});

chrome.storage.local.get(ACCOUNT_BATCH_STATUS_KEY).then((stored) => {
  const previous = stored && stored[ACCOUNT_BATCH_STATUS_KEY];
  if (!previous || previous.running !== true || accountBatchPromise) return;
  return chrome.storage.local.set({
    [ACCOUNT_BATCH_STATUS_KEY]: Object.assign({}, previous, {
      running: false,
      paused: true,
      updatedAt: Date.now(),
      pauseReason: '\u4e0a\u6b21\u6279\u91cf\u4efb\u52a1\u5728\u6269\u5c55\u91cd\u8f7d\u6216\u6d4f\u89c8\u5668\u4f11\u7720\u540e中断，请解锁账号库后继续。',
    }),
  });
}).catch(() => {});

chrome.storage.local.get(PROJECT_TASK_STATUS_KEY).then((stored) => {
  const previous = stored && stored[PROJECT_TASK_STATUS_KEY];
  if (!previous || previous.running !== true || projectTaskPromise) return;
  return chrome.storage.local.set({
    [PROJECT_TASK_STATUS_KEY]: Object.assign({}, previous, {
      running: false,
      updatedAt: Date.now(),
      finishedAt: Date.now(),
      phase: '任务已中断',
      error: '上次任务在扩展重载或浏览器休眠后中断，请重新执行。',
    }),
  });
}).catch(() => {});

function isSensitiveTraceKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.includes('token') ||
    normalized.includes('cookie') ||
    normalized.startsWith('csrf') ||
    normalized === 'sign' ||
    normalized.endsWith('signature') ||
    normalized === 'cna' ||
    normalized === 'utdid' ||
    normalized === 'sid' ||
    normalized === 'sessionid' ||
    normalized === 'userid' ||
    normalized === 'memberid' ||
    normalized === 'loginpointid';
}

function sanitizeTraceValue(value, depth) {
  const level = Number(depth || 0);
  if (level > 7) return '[max-depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const text = value.length > 30000 ? value.slice(0, 30000) + '...[truncated]' : value;
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return sanitizeTraceValue(JSON.parse(trimmed), level + 1);
      } catch (error) {}
    }
    return text;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 60).map((item) => sanitizeTraceValue(item, level + 1));
  }
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).slice(0, 160).forEach((key) => {
      result[key] = isSensitiveTraceKey(key)
        ? '[redacted]'
        : sanitizeTraceValue(value[key], level + 1);
    });
    return result;
  }
  return String(value);
}

function sanitizeTraceUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveTraceKey(key)) url.searchParams.set(key, '[redacted]');
    }
    return url.toString();
  } catch (error) {
    return String(rawUrl || '').slice(0, 3000);
  }
}

function decodeTraceRequestBody(requestBody) {
  if (!requestBody) return null;
  if (requestBody.formData) return sanitizeTraceValue(requestBody.formData, 0);
  const raw = requestBody.raw || [];
  if (!raw.length) return null;
  try {
    const chunks = raw
      .map((item) => item && item.bytes ? new Uint8Array(item.bytes) : null)
      .filter(Boolean);
    const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const joined = new Uint8Array(Math.min(totalLength, 120000));
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= joined.byteLength) break;
      const available = Math.min(chunk.byteLength, joined.byteLength - offset);
      joined.set(chunk.subarray(0, available), offset);
      offset += available;
    }
    const text = new TextDecoder().decode(joined.subarray(0, offset));
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
      return sanitizeTraceValue(JSON.parse(trimmed), 0);
    } catch (error) {}
    try {
      const params = new URLSearchParams(trimmed);
      const parsed = {};
      for (const [key, value] of params.entries()) {
        parsed[key] = isSensitiveTraceKey(key)
          ? '[redacted]'
          : sanitizeTraceValue(value, 0);
      }
      if (Object.keys(parsed).length) return parsed;
    } catch (error) {}
    return sanitizeTraceValue(trimmed, 0);
  } catch (error) {
    return '[request-body-unreadable]';
  }
}

function shouldTraceWxtRequest(details) {
  const expiresAt = wxtTraceTabs.get(details.tabId);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    wxtTraceTabs.delete(details.tabId);
    return false;
  }
  try {
    const url = new URL(details.url);
    if (
      url.hostname !== 'one.alimama.com' &&
      !url.hostname.endsWith('.alimama.com') &&
      url.hostname !== 'one.alimama.hk' &&
      !url.hostname.endsWith('.alimama.hk')
    ) return false;
    return /(?:report|settlement|conclusion|case|content|video|creative|campaign)/i.test(url.pathname) &&
      !/(?:mmstat|log|track|monitor|strategy|popup)/i.test(url.pathname);
  } catch (error) {
    return false;
  }
}

function appendWxtTraceRecord(record) {
  wxtTraceWriteQueue = wxtTraceWriteQueue.then(async () => {
    const stored = await chrome.storage.local.get(WXT_TRACE_STORAGE_KEY);
    const records = Array.isArray(stored[WXT_TRACE_STORAGE_KEY])
      ? stored[WXT_TRACE_STORAGE_KEY]
      : [];
    records.push(record);
    await chrome.storage.local.set({
      [WXT_TRACE_STORAGE_KEY]: records.slice(-WXT_TRACE_MAX_RECORDS),
    });
  }).catch((error) => {
    console.warn(TAG, '万相台请求观察记录失败:', error);
  });
}

chrome.webRequest.onBeforeRequest.addListener((details) => {
  if (!shouldTraceWxtRequest(details)) return;
  appendWxtTraceRecord({
    capturedAt: new Date().toISOString(),
    tabId: details.tabId,
    method: details.method,
    type: details.type,
    url: sanitizeTraceUrl(details.url),
    body: decodeTraceRequestBody(details.requestBody),
  });
}, {
  urls: ['*://*.alimama.com/*', '*://*.alimama.hk/*'],
  types: ['xmlhttprequest'],
}, ['requestBody']);

chrome.tabs.onRemoved.addListener((tabId) => {
  wxtTraceTabs.delete(tabId);
});

function isDmpSender(sender) {
  try {
    const senderUrl = new URL(String(sender.url || sender.tab && sender.tab.url || ''));
    return senderUrl.hostname === 'dmp.taobao.com';
  } catch (error) {
    return false;
  }
}

async function runDmpCrowdPresetAction(tabId, action, payload) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    world: 'MAIN',
    func: async function (requestedAction, requestedPayload) {
      if (location.hostname !== 'dmp.taobao.com') {
        throw new Error('当前标签页不是达摩盘。');
      }

      const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

      function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
      }

      function appendQuery(path, params) {
        const url = new URL(path, location.origin);
        Object.keys(params || {}).forEach((key) => {
          const value = params[key];
          if (value === undefined || value === null || value === '') return;
          url.searchParams.set(key, String(value));
        });
        return url.toString();
      }

      async function rawRequest(path, options) {
        const config = options || {};
        const method = String(config.method || 'GET').toUpperCase();
        const response = await fetch(appendQuery(path, config.params), {
          method: method,
          credentials: 'include',
          cache: 'no-store',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: method === 'GET' ? undefined : JSON.stringify(config.body || {}),
        });
        const text = await response.text();
        let body = {};
        try {
          body = text ? JSON.parse(text) : {};
        } catch (error) {
          throw new Error('达摩盘返回了无法解析的数据。');
        }
        if (!response.ok) {
          throw new Error('HTTP ' + response.status + ': ' + (body.msg || body.message || text || path));
        }
        if (body && body.success === false) {
          throw new Error(body.msg || body.message || '达摩盘接口返回失败。');
        }
        return body && body.data !== undefined ? body.data : body;
      }

      const loginData = await rawRequest('/api/login/loginuserinfo', { method: 'GET' });
      const user = loginData && (loginData.user || loginData) || {};
      const authParams = {};
      if (user.csrfId) authParams.csrfId = user.csrfId;
      if (user.__udToken) authParams.__tk = user.__udToken;

      async function request(path, options) {
        const config = options || {};
        return rawRequest(path, Object.assign({}, config, {
          params: Object.assign({}, config.params || {}, authParams),
        }));
      }

      function accountSummary() {
        return {
          nick: user.nick || user.nickName || user.userName || user.customerName || '',
          customerId: user.customerId || user.memberId || user.id || '',
        };
      }

      function firstCrowdArray(data) {
        const candidates = [
          Array.isArray(data) ? data : null,
          data && data.crowds,
          data && data.crowdList,
          data && data.list,
          data && data.records,
          data && data.rows,
          data && data.items,
          data && data.result,
          data && data.data && data.data.crowds,
          data && data.data && data.data.crowdList,
          data && data.data && data.data.list,
          data && data.data && data.data.records,
          data && data.data && data.data.rows,
          data && data.data && data.data.items,
          data && data.data && data.data.result,
        ];
        return candidates.find(Array.isArray) || [];
      }

      async function listCrowds(maxPages) {
        const pageSize = 500;
        const pageLimit = Math.max(1, Math.min(Number(maxPages) || 100, 100));
        const crowds = [];
        const seen = new Set();
        for (let page = 1; page <= pageLimit; page += 1) {
          const data = await request('/api/crowd/insight', {
            method: 'GET',
            params: { pageSize: pageSize, page: page },
          });
          const batch = firstCrowdArray(data);
          let added = 0;
          batch.forEach((crowd) => {
            const crowdId = String(crowd && (crowd.crowdId || crowd.id) || '');
            if (!crowdId || seen.has(crowdId)) return;
            seen.add(crowdId);
            crowds.push(crowd);
            added += 1;
          });
          const totals = [
            data && data.total,
            data && data.totalCount,
            data && data.page && data.page.total,
            data && data.pagination && data.pagination.total,
          ].map(Number).filter(Number.isFinite);
          const total = totals.find((value) => value >= 0);
          if (!batch.length || !added || (total !== undefined && crowds.length >= total)) break;
          if (total === undefined && batch.length < pageSize) break;
          await sleep(80);
        }
        return crowds;
      }

      function stripRuleIdentity(value) {
        if (Array.isArray(value)) return value.map(stripRuleIdentity);
        if (!value || typeof value !== 'object') return value;
        const result = {};
        const isRuleNode = Array.isArray(value.selectTagOptionSet);
        Object.keys(value).forEach((key) => {
          if (
            isRuleNode &&
            (key === 'id' || key === 'crowdId' || key === 'crowdName' ||
              key === 'coverage' || key === 'storageType')
          ) return;
          result[key] = stripRuleIdentity(value[key]);
        });
        return result;
      }

      function resolveValidDate(sourceDate) {
        const source = /^\d{4}-\d{2}-\d{2}$/.test(String(sourceDate || ''))
          ? new Date(sourceDate + 'T00:00:00')
          : null;
        const minimum = new Date();
        minimum.setHours(0, 0, 0, 0);
        minimum.setDate(minimum.getDate() + 29);
        const selected = source && source.getTime() >= minimum.getTime() ? source : minimum;
        const year = selected.getFullYear();
        const month = String(selected.getMonth() + 1).padStart(2, '0');
        const day = String(selected.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
      }

      function createPayload(template) {
        const source = template && template.crowd || {};
        const extra = clone(source.extra || {});
        extra.DMP_PLUS = 1;
        if (extra.autoExtendDate === undefined) extra.autoExtendDate = 'true';
        return {
          crowdNew: 1,
          crowdName: String(template.name || template.sourceName || ''),
          groupId: source.groupId || '0',
          validDate: resolveValidDate(source.validDate),
          extra: extra,
          selectTagOptionSet: stripRuleIdentity(source.selectTagOptionSet),
          lookalikeAlgoType: source.lookalikeAlgoType === undefined ? 0 : source.lookalikeAlgoType,
          lookalikeMultiple: source.lookalikeMultiple,
          businessType: source.businessType || 1,
          isIter: source.isIter,
          iterTarget: source.iterTarget,
        };
      }

      const currentCrowds = await listCrowds();
      const crowdNameOf = (crowd) => String(crowd && (crowd.crowdName || crowd.name) || '').trim();
      const crowdIdOf = (crowd) => String(crowd && (crowd.crowdId || crowd.id) || '').trim();
      const crowdCoverageOf = (crowd) => crowd && (
        crowd.crowdNum ?? crowd.coverNum ?? crowd.coverage ?? crowd.crowdSize ??
        crowd.size ?? crowd.num ?? crowd.uv ?? crowd.count ?? ''
      );
      const currentByName = new Map(currentCrowds.map((crowd) => [crowdNameOf(crowd), crowd]).filter((item) => item[0]));
      const currentNames = new Set(currentByName.keys());

      function normalizedCrowdName(value) {
        return String(value || '')
          .normalize('NFKC')
          .toLowerCase()
          .replace(/[\s_\-—–·:：()（）【】\[\]]+/g, '');
      }

      function crowdMatchScore(requestedName, crowd) {
        const target = normalizedCrowdName(requestedName);
        const candidate = normalizedCrowdName(crowdNameOf(crowd));
        if (!target || !candidate) return 0;
        if (candidate === target) return 100;
        if (candidate.startsWith(target) || candidate.endsWith(target)) return 90;
        if (target.includes('小红书') && target.includes('进店')) {
          return candidate.includes('小红书') && candidate.includes('进店') ? 80 : 0;
        }
        if (target.includes('小红书') && target.includes('内容')) {
          return candidate.includes('小红书') && candidate.includes('内容') && !candidate.includes('进店')
            ? 80
            : 0;
        }
        if (target.includes('全店')) {
          return candidate.includes('全店') && /人群|资产|浏览/.test(candidate) ? 80 : 0;
        }
        if (target.includes('淘天') && target.includes('内容')) {
          return !candidate.includes('小红书') && candidate.includes('内容') && /人群|资产/.test(candidate)
            ? 70
            : 0;
        }
        return 0;
      }

      function crowdForRequestedName(requestedName) {
        const ranked = currentCrowds
          .map((crowd) => ({ crowd: crowd, score: crowdMatchScore(requestedName, crowd) }))
          .filter((item) => item.score > 0)
          .sort((left, right) => right.score - left.score);
        return ranked.length ? ranked[0].crowd : null;
      }

      function rememberCrowd(crowd) {
        const name = crowdNameOf(crowd);
        if (!name) return;
        currentByName.set(name, crowd);
        currentNames.add(name);
      }

      function createdCrowdId(value, depth) {
        if (!value || typeof value !== 'object' || (depth || 0) > 3) return '';
        const direct = value.crowdId ?? value.id;
        if (direct !== undefined && direct !== null && direct !== '') return String(direct);
        for (const key of ['crowd', 'data', 'result', 'model']) {
          const nested = createdCrowdId(value[key], (depth || 0) + 1);
          if (nested) return nested;
        }
        return '';
      }

      async function waitForCreatedCrowd(name, expectedCrowdId) {
        let lastError = null;
        for (let attempt = 0; attempt < 15; attempt += 1) {
          try {
            const refreshed = await listCrowds(attempt === 0 || attempt % 5 === 4 ? 100 : 3);
            const byName = refreshed.find((crowd) => crowdNameOf(crowd) === name);
            const byId = expectedCrowdId
              ? refreshed.find((crowd) => crowdIdOf(crowd) === String(expectedCrowdId))
              : null;
            const found = byName || byId;
            if (found) {
              rememberCrowd(found);
              return { crowd: found, error: null };
            }
          } catch (error) {
            lastError = error;
          }
          if (attempt < 14) await sleep(2000);
        }
        return { crowd: null, error: lastError };
      }

      function templateFromRules(name, rules) {
        return {
          name: name,
          crowd: {
            groupId: '0',
            validDate: '',
            extra: {},
            selectTagOptionSet: rules,
            lookalikeAlgoType: 0,
            businessType: 1,
          },
        };
      }

      function tagList(data, depth) {
        const candidates = [
          Array.isArray(data) ? data : null,
          data && data.list,
          data && data.tags,
          data && data.options,
          data && data.optionList,
          data && data.rows,
          data && data.result,
          data && data.data && data.data.list,
        ];
        const direct = candidates.find(Array.isArray);
        if (direct) return direct;
        if ((depth || 0) < 2 && data && typeof data === 'object') {
          for (const key of ['data', 'result', 'model', 'page']) {
            const nested = tagList(data[key], (depth || 0) + 1);
            if (nested.length) return nested;
          }
        }
        return [];
      }

      function normalizeDmpLabel(value) {
        return String(value || '').normalize('NFKC').replace(/[^a-z0-9\u4e00-\u9fff]/gi, '');
      }

      function tagOptionName(option) {
        return normalizeDmpLabel(option && (
          option.optionName || option.name || option.label || option.tagOptionName
        ));
      }

      function tagOptionValue(option) {
        if (!option) return null;
        for (const key of ['optionValue', 'value', 'code', 'id', 'tagOptionValue']) {
          if (option[key] !== undefined && option[key] !== null && option[key] !== '') return option[key];
        }
        return null;
      }

      async function findTagDefinition(searchQuery, aliases) {
        const searched = await request('/api/tag/search', {
          method: 'GET',
          params: { query: searchQuery, groupType: 7, pageSize: 200 },
        });
        const normalizedAliases = aliases.map(normalizeDmpLabel);
        const matched = tagList(searched).map((tag) => {
          const name = normalizeDmpLabel(tag && (tag.tagName || tag.name || tag.label || tag.title));
          let score = normalizedAliases.some((alias) => name === alias) ? 100 : 0;
          if (!score && normalizedAliases.some((alias) => name.includes(alias))) score = 50;
          if (name.includes('升级版')) score += 10;
          return { tag, score };
        }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score)[0];
        const tagId = matched && matched.tag && (
          matched.tag.id || matched.tag.tagId || matched.tag.value || matched.tag.code
        );
        if (!tagId) return null;
        const detailData = await request('/api/tag/' + encodeURIComponent(tagId), {
          method: 'GET',
          params: { appCode: 'dmpBase' },
        });
        const detail = detailData && (detailData.result || detailData.tag || detailData);
        if (!detail || typeof detail !== 'object') return null;
        detail.id = detail.id || tagId;
        detail.tagName = detail.tagName || matched.tag.tagName || matched.tag.name || matched.tag.label || matched.tag.title;
        if (!Array.isArray(detail.optionGroups)) {
          detail.optionGroups = [
            detail.tagOptionGroupDTOs,
            detail.tagOptionGroups,
            detail.optionGroupList,
            detail.groups,
          ].find(Array.isArray) || [];
        }
        if (!Array.isArray(detail.options)) {
          detail.options = [];
          (detail.optionGroups || []).forEach((group) => {
            (group.tagOptionDTOs || group.options || []).forEach((option) => detail.options.push(option));
          });
        }
        return detail;
      }

      async function tagGroupsWithOptions(tag) {
        let groups = Array.isArray(tag && tag.optionGroups) ? tag.optionGroups : [];
        const allOptions = Array.isArray(tag && tag.options) ? tag.options : [];
        if (!groups.length && allOptions.length) {
          const derived = new Map();
          allOptions.forEach((option) => {
            const id = option && (option.optionGroupId || option.tagOptionGroupId || option.groupId);
            if (id === undefined || id === null || derived.has(String(id))) return;
            derived.set(String(id), {
              id,
              optionGroupName: option.optionGroupName || option.tagOptionGroupName || option.groupName || '',
            });
          });
          groups = Array.from(derived.values());
        }
        const output = [];
        for (let index = 0; index < groups.length; index += 1) {
          const group = groups[index];
          const groupId = group && (group.id ?? group.optionGroupId ?? group.tagOptionGroupId ?? group.groupId);
          if (groupId === undefined || groupId === null) continue;
          const embeddedOptions = group.tagOptionDTOs || group.options || [];
          let options = Array.isArray(embeddedOptions) ? embeddedOptions.slice() : [];
          if (!options.length) {
            options = allOptions.filter((option) => String(
              option.optionGroupId ?? option.tagOptionGroupId ?? option.groupId
            ) === String(groupId));
          }
          let ext = group.ext || {};
          if (typeof ext === 'string') {
            try { ext = JSON.parse(ext); } catch (error) { ext = {}; }
          }
          if (!options.length || ext.filterOptions) {
            try {
              const dynamic = await request('/api/tag/' + encodeURIComponent(tag.id) + '/option', {
                method: 'GET',
                params: { optionGroupId: groupId, appCode: 'dmpBase' },
              });
              const dynamicOptions = tagList(dynamic);
              if (dynamicOptions.length) options = dynamicOptions;
            } catch (error) {}
          }
          output.push({ id: groupId, group, options });
        }
        return output;
      }

      function tagGroupName(groupRecord) {
        const group = groupRecord && groupRecord.group || {};
        return normalizeDmpLabel(
          group.optionGroupName || group.tagOptionGroupName || group.groupName ||
          group.name || group.label || group.title || group.displayName
        );
      }

      function optionDisplayName(option) {
        return String(option && (
          option.optionName || option.name || option.label || option.tagOptionName
        ) || '');
      }

      function optionMatches(option, aliases) {
        const name = tagOptionName(option);
        const normalizedAliases = (aliases || []).map(normalizeDmpLabel).filter(Boolean);
        if (normalizedAliases.some((alias) => name === alias)) return true;
        return normalizedAliases.some((alias) => (
          alias.length >= 2 && (name.includes(alias) || alias.includes(name))
        ));
      }

      function groupMatchScore(group, aliases) {
        const name = tagGroupName(group);
        let score = 0;
        (aliases || []).forEach((alias, index) => {
          if (!name || !alias) return;
          if (name === alias) score = Math.max(score, 1000 - index);
          else if (name.includes(alias) || alias.includes(name)) {
            score = Math.max(score, 100 + alias.length - index);
          }
        });
        return score;
      }

      async function buildRuleTagSet(config) {
        const tag = await findTagDefinition(config.searchQuery, config.tagAliases);
        if (!tag) throw new Error('未找到“' + config.label + '”标签。');
        const groups = await tagGroupsWithOptions(tag);
        if (!groups.length) throw new Error('“' + config.label + '”没有可用选项分组。');
        const selectedByGroup = new Map();
        for (const requirement of config.requirements) {
          const groupAliases = (requirement.groupAliases || []).map(normalizeDmpLabel).filter(Boolean);
          const matchedCandidates = groups.map((group) => ({ group, score: groupMatchScore(group, groupAliases) }))
            .filter((item) => item.score > 0)
            .sort((left, right) => right.score - left.score);
          let candidates = matchedCandidates.map((item) => item.group);
          if (!candidates.length) candidates = groups;

          if (Object.prototype.hasOwnProperty.call(requirement, 'literalValue')) {
            const selectedGroup = matchedCandidates[0] && matchedCandidates[0].group;
            if (!selectedGroup) {
              throw new Error('“' + config.label + '”缺少“' + requirement.label + '”数值组。');
            }
            const key = String(selectedGroup.id);
            if (!selectedByGroup.has(key)) {
              selectedByGroup.set(key, { group: selectedGroup, options: [], literals: [] });
            }
            const literals = selectedByGroup.get(key).literals;
            const literal = {
              value: String(requirement.literalValue),
              name: String(requirement.literalName ?? requirement.literalValue),
            };
            if (!literals.some((item) => item.value === literal.value)) literals.push(literal);
            continue;
          }

          let selectedGroup = null;
          let selectedOptions = [];
          for (const group of candidates) {
            const options = (group.options || []).filter((option) => tagOptionValue(option) !== null);
            const matching = options.filter((option) => optionMatches(option, requirement.optionAliases));
            if (matching.length) {
              selectedGroup = group;
              selectedOptions = requirement.selectAllMatches ? matching : [matching[0]];
              break;
            }
          }
          if (!selectedGroup && requirement.fallback === 'first') {
            selectedGroup = candidates.find((group) => (
              (group.options || []).some((option) => tagOptionValue(option) !== null)
            ));
            if (selectedGroup) {
              selectedOptions = [(selectedGroup.options || []).find((option) => tagOptionValue(option) !== null)];
            }
          }
          if (!selectedGroup && requirement.fallback === 'all') {
            selectedGroup = candidates.find((group) => (
              (group.options || []).some((option) => tagOptionValue(option) !== null)
            ));
            if (selectedGroup) {
              selectedOptions = (selectedGroup.options || []).filter((option) => tagOptionValue(option) !== null);
            }
          }
          if (!selectedGroup || !selectedOptions.length) {
            throw new Error('“' + config.label + '”缺少“' + requirement.label + '”选项。');
          }
          const key = String(selectedGroup.id);
          if (!selectedByGroup.has(key)) {
            selectedByGroup.set(key, { group: selectedGroup, options: [], literals: [] });
          }
          const saved = selectedByGroup.get(key).options;
          selectedOptions.forEach((option) => {
            if (!saved.some((candidate) => String(tagOptionValue(candidate)) === String(tagOptionValue(option)))) {
              saved.push(option);
            }
          });
        }
        return {
          operator: 1,
          selects: Array.from(selectedByGroup.values()).map((item) => ({
            tagId: tag.id,
            optionGroupId: item.group.id,
            tagName: tag.tagName,
            values: item.options.map(tagOptionValue).concat(item.literals.map((literal) => literal.value)).join(','),
            names: item.options.map(optionDisplayName).concat(item.literals.map((literal) => literal.name)).join(','),
          })),
        };
      }

      function buildContentBehaviorSet(contentSourceAliases) {
        return buildRuleTagSet({
          label: '淘宝内容行为人群',
          searchQuery: '淘宝内容行为人群',
          tagAliases: ['淘宝内容行为人群'],
          requirements: [
            { label: '店铺', groupAliases: ['店铺'], optionAliases: ['当前店铺', '本店铺'], fallback: 'first' },
            { label: '内容类型-视频', groupAliases: ['内容类型'], optionAliases: ['视频'] },
            { label: '内容来源', groupAliases: ['内容来源'], optionAliases: contentSourceAliases },
            { label: '投放内容-全选', groupAliases: ['投放内容', '内容'], optionAliases: ['全部', '全选', '所有'], fallback: 'all' },
            { label: '流量来源-全部', groupAliases: ['流量来源', '渠道'], optionAliases: ['全部', '全选', '所有'], fallback: 'all' },
            { label: '行为类型-播放', groupAliases: ['行为类型', '用户行为', '行为'], optionAliases: ['播放'] },
            { label: '近30天', groupAliases: ['时间', '日期'], optionAliases: ['近30天', '最近30天', '近30日', '30天', '30日'] },
          ],
        });
      }

      function buildWxtExposureSet() {
        return buildRuleTagSet({
          label: '万相台无界版回流再营销',
          searchQuery: '万相台无界版回流再营销',
          tagAliases: ['万相台无界版回流再营销'],
          requirements: [
            { label: '广告主', groupAliases: ['广告主'], optionAliases: ['当前广告主', '本广告主'], fallback: 'first' },
            { label: '一级场景-内容营销', groupAliases: ['一级场景'], optionAliases: ['内容营销'] },
            { label: '二级场景-超级短视频', groupAliases: ['二级场景'], optionAliases: ['超级短视频'] },
            { label: '全部计划', groupAliases: ['计划选择', '计划'], optionAliases: ['全部计划', '全部', '全选'], fallback: 'all' },
            { label: '用户行为-曝光', groupAliases: ['用户行为', '行为'], optionAliases: ['曝光'] },
            { label: '曝光频次范围-1次以上', groupAliases: ['曝光频次范围', '曝光频次下限', '曝光频次'], literalValue: '1,', literalName: '1次以上' },
            { label: '时间类型-最近N天', groupAliases: ['时间类型'], optionAliases: ['最近N天', '近N天'] },
            { label: '最近天数-30', groupAliases: ['最近天数', '天数'], literalValue: '30', literalName: '30' },
          ],
        });
      }

      let storeBehaviorSetPromise = null;

      function buildStoreBehaviorSet() {
        if (!storeBehaviorSetPromise) {
          storeBehaviorSetPromise = buildRuleTagSet({
            label: '店铺行为人群',
            searchQuery: '店铺行为人群',
            tagAliases: ['店铺行为人群'],
            requirements: [
              { label: '店铺', groupAliases: ['选择店铺', '店铺'], optionAliases: ['当前店铺', '默认店铺', '本店铺'], fallback: 'first' },
              { label: '全部类目', groupAliases: ['选择类目', '类目'], optionAliases: ['全部类目', '所有类目', '全部'], fallback: 'all' },
              { label: '用户行为-浏览', groupAliases: ['用户行为', '行为'], optionAliases: ['浏览'] },
              { label: '浏览限定条件', groupAliases: ['浏览限定条件', '限定条件'], optionAliases: ['浏览次数'] },
              { label: '浏览次数范围-1次以上', groupAliases: ['浏览次数范围', '浏览次数下限', '浏览次数'], literalValue: '1,', literalName: '1次以上' },
              { label: '时间类型-最近N天', groupAliases: ['时间类型'], optionAliases: ['最近N天', '近N天'] },
              { label: '最近天数-30', groupAliases: ['最近天数', '天数'], literalValue: '30', literalName: '30' },
            ],
          });
        }
        return storeBehaviorSetPromise;
      }

      let xhsTagDefinitionPromise = null;

      async function buildXhsTagSet(includeSeeding) {
        if (!xhsTagDefinitionPromise) {
          xhsTagDefinitionPromise = findTagDefinition('淘宝种草回流人群', [
            '淘宝种草回流人群_升级版',
            '淘宝种草回流人群',
            '淘宝种草人群行为',
          ]);
        }
        const tag = await xhsTagDefinitionPromise;
        if (!tag) return null;
        const groups = await tagGroupsWithOptions(tag);
        const requirements = [
          ['星河新模式'],
          ['当前项目'],
          ['种草自选'],
          ['小红书种草'],
          ['所有订单', '全部订单'],
          ['进店'],
          ['近30天', '近30日', '30天', '30日', '30'],
        ];
        if (includeSeeding) requirements.push(['种草']);
        const selectedByGroup = new Map();
        for (const aliases of requirements) {
          const normalizedAliases = aliases.map(normalizeDmpLabel);
          let found = null;
          for (const group of groups) {
            const option = group.options.find((candidate) => {
              const name = tagOptionName(candidate);
              return normalizedAliases.some((alias) => name === alias);
            }) || group.options.find((candidate) => {
              const name = tagOptionName(candidate);
              return normalizedAliases.some((alias) => (
                (alias === '30' && name.includes('30')) || (alias.length >= 4 && name.includes(alias))
              ));
            });
            if (option) {
              found = { group, option };
              break;
            }
          }
          if (!found || tagOptionValue(found.option) === null) return null;
          const key = String(found.group.id);
          if (!selectedByGroup.has(key)) selectedByGroup.set(key, { group: found.group, options: [] });
          const selected = selectedByGroup.get(key).options;
          if (!selected.some((option) => String(tagOptionValue(option)) === String(tagOptionValue(found.option)))) {
            selected.push(found.option);
          }
        }
        const selectedNames = Array.from(selectedByGroup.values()).flatMap((item) => item.options.map(tagOptionName));
        if (!selectedNames.includes('进店') || selectedNames.includes('种草') !== includeSeeding) return null;
        return {
          operator: 1,
          selects: Array.from(selectedByGroup.values()).map((item) => ({
            tagId: tag.id,
            optionGroupId: item.group.id,
            tagName: tag.tagName,
            values: item.options.map(tagOptionValue).join(','),
            names: item.options.map((option) => String(option.optionName || option.name || option.label || '')).join(','),
          })),
        };
      }

      async function createTemplateNow(template) {
        const name = String(template && template.name || '').trim();
        if (!name || !template.crowd || !template.crowd.selectTagOptionSet) {
          return { name: name || '未命名人群', ok: false, message: '未生成完整的人群规则。' };
        }
        if (currentNames.has(name)) {
          const existing = currentByName.get(name);
          return {
            name: name,
            ok: true,
            skipped: true,
            crowdId: crowdIdOf(existing),
            coverage: crowdCoverageOf(existing),
            verified: true,
            message: '已在“我的人群”找到同名人群。',
          };
        }
        try {
          const data = await request('/api/crowd/', {
            method: 'POST',
            body: createPayload(template),
          });
          const submittedCrowdId = createdCrowdId(data);
          const verification = await waitForCreatedCrowd(name, submittedCrowdId);
          if (!verification.crowd) {
            const detail = verification.error && verification.error.message
              ? '；最后一次列表查询失败：' + verification.error.message
              : '';
            return {
              name: name,
              ok: false,
              submitted: true,
              submittedCrowdId: submittedCrowdId,
              verified: false,
              message: '创建接口已返回，但 30 秒内未在“我的人群”查到该名称，未判定为创建成功' + detail + '。',
            };
          }
          return {
            name: name,
            ok: true,
            crowdId: crowdIdOf(verification.crowd),
            coverage: crowdCoverageOf(verification.crowd),
            skipped: false,
            verified: true,
          };
        } catch (error) {
          return {
            name: name,
            ok: false,
            message: error && error.message ? error.message : String(error),
          };
        }
      }

      if (requestedAction === 'createStore30D') {
        const crowdName = String(
          requestedPayload && requestedPayload.name || '全店人群资产'
        ).trim();
        if (!crowdName) {
          return { ok: false, message: '人群名称不能为空。', results: [] };
        }
        if (currentNames.has(crowdName)) {
          const existing = currentByName.get(crowdName);
          const skipped = {
            name: crowdName,
            ok: true,
            skipped: true,
            crowdId: crowdIdOf(existing),
            coverage: crowdCoverageOf(existing),
            verified: true,
            message: '已在“我的人群”找到同名人群。',
          };
          return {
            ok: true,
            method: 'api',
            account: accountSummary(),
            result: skipped,
            results: [skipped],
          };
        }

        let storeTemplate;
        try {
          const storeSet = await buildStoreBehaviorSet();
          storeTemplate = templateFromRules(crowdName, {
            operator: 1,
            selectTagOptionSet: [
              { operator: 1, selectTagOptionSet: [storeSet] },
              { operator: 2, selectTagOptionSet: [] },
            ],
          });
        } catch (error) {
          return {
            ok: false,
            method: 'api',
            account: accountSummary(),
            message: error && error.message ? error.message : String(error),
            results: [],
          };
        }

        const created = await createTemplateNow(storeTemplate);
        return {
          ok: Boolean(created.ok),
          method: 'api',
          account: accountSummary(),
          result: created,
          results: [created],
          message: created.message || '',
        };
      }

      if (requestedAction === 'ensureBusinessDefense') {
        const targets = [
          { key: 'tt', name: '淘天内容人群资产' },
          { key: 'store', name: '全店人群资产' },
          { key: 'xhs', name: '小红书内容人群资产' },
          { key: 'xhsVisit', name: '小红书进店人群' },
        ];
        const existingByName = new Map(targets.map((target) => (
          [target.name, crowdForRequestedName(target.name)]
        )).filter((item) => item[1]));
        const missingKeys = new Set(targets.filter((target) => !existingByName.has(target.name)).map((target) => target.key));
        if (!missingKeys.size) {
          return {
            ok: true,
            account: accountSummary(),
            results: targets.map((target) => ({ name: target.name, ok: true, skipped: true, message: '已存在同名人群。' })),
          };
        }

        const templateByKey = {};
        const directTemplateErrors = {};
        if (missingKeys.has('store')) {
          try {
            const storeSet = await buildStoreBehaviorSet();
            templateByKey.store = templateFromRules('全店人群资产', {
              operator: 1,
              selectTagOptionSet: [
                { operator: 1, selectTagOptionSet: [storeSet] },
                { operator: 2, selectTagOptionSet: [] },
              ],
            });
          } catch (error) {
            directTemplateErrors.store = error && error.message ? error.message : String(error);
          }
        }
        if (missingKeys.has('tt')) {
          try {
            const merchantContentSet = await buildContentBehaviorSet(['商家自制', '自制']);
            const partnerContentSet = await buildContentBehaviorSet(['达人合作', '合作']);
            const wxtExposureSet = await buildWxtExposureSet();
            const storeSet = await buildStoreBehaviorSet();
            templateByKey.tt = templateFromRules('淘天内容人群资产', {
              operator: 1,
              selectTagOptionSet: [
                { operator: 1, selectTagOptionSet: [merchantContentSet, partnerContentSet, wxtExposureSet] },
                { operator: 1, selectTagOptionSet: [storeSet] },
                { operator: 2, selectTagOptionSet: [] },
              ],
            });
          } catch (error) {
            directTemplateErrors.tt = error && error.message ? error.message : String(error);
          }
        }
        if (missingKeys.has('xhsVisit')) {
          try {
            const visitSet = await buildXhsTagSet(false);
            if (!visitSet) throw new Error('小红书进店规则缺少必需的星河项目或行为选项。');
            templateByKey.xhsVisit = templateFromRules('小红书进店人群', {
              operator: 1,
              selectTagOptionSet: [
                { operator: 1, selectTagOptionSet: [visitSet] },
                { operator: 2, selectTagOptionSet: [] },
              ],
            });
          } catch (error) {
            directTemplateErrors.xhsVisit = error && error.message ? error.message : String(error);
          }
        }
        if (missingKeys.has('xhs')) {
          try {
            const contentSet = await buildXhsTagSet(true);
            if (!contentSet) throw new Error('小红书内容规则缺少必需的星河项目、进店或种草选项。');
            templateByKey.xhs = templateFromRules('小红书内容人群资产', {
              operator: 1,
              selectTagOptionSet: [
                { operator: 1, selectTagOptionSet: [contentSet] },
                { operator: 2, selectTagOptionSet: [] },
              ],
            });
          } catch (error) {
            directTemplateErrors.xhs = error && error.message ? error.message : String(error);
          }
        }

        const ensured = [];
        for (let index = 0; index < targets.length; index += 1) {
          const target = targets[index];
          if (existingByName.has(target.name)) {
            const existing = existingByName.get(target.name);
            ensured.push({
              name: target.name,
              ok: true,
              skipped: true,
              crowdId: crowdIdOf(existing),
              coverage: crowdCoverageOf(existing),
              verified: true,
              message: '已在“我的人群”找到同名人群。',
            });
            continue;
          }
          const template = templateByKey[target.key];
          if (!template) {
            ensured.push({
              name: target.name,
              ok: false,
              message: directTemplateErrors[target.key] || '无法按文档规则生成人群。',
            });
            continue;
          }
          ensured.push(await createTemplateNow(template));
          if (index < targets.length - 1) await sleep(1200);
        }
        return {
          ok: ensured.every((item) => item.ok),
          account: accountSummary(),
          results: ensured,
        };
      }

      if (requestedAction === 'inspect') {
        const names = Array.isArray(requestedPayload && requestedPayload.names)
          ? requestedPayload.names
          : [];
        return {
          ok: true,
          account: accountSummary(),
          results: names.map((name) => {
            const crowd = crowdForRequestedName(name);
            return {
              name: name,
              actualName: crowdNameOf(crowd),
              exists: Boolean(crowd && crowdIdOf(crowd)),
              crowdId: crowdIdOf(crowd),
              coverage: crowdCoverageOf(crowd),
            };
          }),
        };
      }

      throw new Error('未知的人群操作。');
    },
    args: [action, payload || {}],
  });
  const result = results && results[0] && results[0].result;
  if (!result) throw new Error('达摩盘页面未返回操作结果。');
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  if (message.type === 'DMP_CROWD_PRESET_ACTION') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId || !isDmpSender(sender)) {
      sendResponse({ ok: false, message: '只能在达摩盘页面执行人群操作。' });
      return;
    }
    if (message.action !== 'inspect') {
      sendResponse({ ok: false, message: '自动建包已关闭，请手动创建后刷新读取。' });
      return;
    }
    runDmpCrowdPresetAction(tabId, message.action, message.payload).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({
        ok: false,
        message: error && error.message ? error.message : '达摩盘人群操作失败。',
      });
    });
    return true;
  }
  if (message.type === 'WXT_STORE_API_RESPONSE') {
    const senderUrl = String(sender.url || sender.tab && sender.tab.url || '');
    let isWxtTracePage = false;
    try {
      const parsedSenderUrl = new URL(senderUrl);
      isWxtTracePage = (
        parsedSenderUrl.hostname === 'one.alimama.com' ||
        parsedSenderUrl.hostname === 'one.alimama.hk'
      ) && parsedSenderUrl.searchParams.get('__wxtTrace') === '1';
    } catch (error) {}
    if (!isWxtTracePage) {
      sendResponse({ ok: false, message: '当前页面未开启万相台接口观察。' });
      return;
    }
    const event = sanitizeTraceValue(message.event || {}, 0);
    appendWxtTraceRecord({
      capturedAt: new Date().toISOString(),
      tabId: sender.tab && sender.tab.id,
      kind: 'response',
      method: event.method || '',
      status: event.status,
      url: sanitizeTraceUrl(event.url || ''),
      response: event.response,
    });
    sendResponse({ ok: true });
    return;
  }
  if (message.type !== 'WXT_ENABLE_API_TRACE') return;
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) {
    sendResponse({ ok: false, message: '无法定位万相台调试标签页。' });
    return;
  }
  wxtTraceTabs.set(tabId, Date.now() + 10 * 60 * 1000);
  chrome.storage.local.set({ [WXT_TRACE_STORAGE_KEY]: [] }).then(() => {
    sendResponse({ ok: true });
  }).catch((error) => {
    sendResponse({
      ok: false,
      message: error && error.message ? error.message : '无法清空万相台调试记录。',
    });
  });
  return true;
});

function canonicalDateRange(context) {
  if (!context) return '';
  const source = String(context.dateRange || context.visibleRange || '');
  const dates = source.match(/20\d{2}[./-]\d{1,2}[./-]\d{1,2}/g) || [];
  if (!dates.length) return '';
  const normalized = dates.slice(0, 2).map((date) => {
    const parts = date.replace(/[./]/g, '-').split('-');
    return parts[0] + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');
  });
  if (normalized.length === 1) normalized.push(normalized[0]);
  return normalized.join('|');
}

function displayDateRange(range) {
  if (!range) return '未识别';
  const dates = range.split('|');
  return dates[0] === dates[1] ? dates[0] : dates.join(' 至 ');
}

function isMissingSycmReceiver(error) {
  const message = String(error && error.message || error || '');
  return message.includes('Receiving end does not exist') ||
    message.includes('Could not establish connection') ||
    message.includes('message port closed');
}

async function getSycmFrameIds(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  return (frames || []).map((frame) => frame.frameId);
}

async function sendSycmFrameMessage(tabId, frameId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch (error) {
    if (!isMissingSycmReceiver(error)) throw error;
    return null;
  }
}

async function sendSycmMessageToFrames(tabId, message) {
  let frameIds = await getSycmFrameIds(tabId);
  let responses = await Promise.all(frameIds.map((frameId) => (
    sendSycmFrameMessage(tabId, frameId, message)
  )));
  const hasHandler = responses.some((response) => (
    response && (response.ok || response.handled || response.message)
  ));
  if (hasHandler) return responses.filter(Boolean);

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['sycm-content-script.js'],
  });
  frameIds = await getSycmFrameIds(tabId);
  responses = await Promise.all(frameIds.map((frameId) => (
    sendSycmFrameMessage(tabId, frameId, message)
  )));
  return responses.filter(Boolean);
}

async function requestSycmDataFrame(tabId, message) {
  const responses = await sendSycmMessageToFrames(tabId, message);
  const success = responses.find((response) => response && response.ok);
  if (success) return success;
  const failure = responses.find((response) => response && response.message);
  return failure || { ok: false, message: '内容指标层未响应。' };
}

// 监听下载事件，捕获 xlsx 文件
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  const url = downloadItem.url || '';
  const filename = downloadItem.filename || '';
  if (filename.includes('万相台数据报告_')) return;

  const isExcel = url.includes('.xlsx') || url.includes('.xls') ||
                  filename.includes('.xlsx') || filename.includes('.xls') ||
                  downloadItem.mime?.includes('spreadsheet') ||
                  downloadItem.mime?.includes('excel') ||
                  downloadItem.mime?.includes('octet-stream');

  if (!isExcel) return;

  console.log(TAG, '检测到 Excel 下载:', url.substring(0, 100), 'mime:', downloadItem.mime);

  // 等待下载完成后读取文件
  const downloadId = downloadItem.id;

  const onChanged = async (delta) => {
    if (delta.id !== downloadId) return;
    if (delta.state?.current !== 'complete') return;

    chrome.downloads.onChanged.removeListener(onChanged);

    // 获取下载完成的文件路径
    chrome.downloads.search({ id: downloadId }, async (items) => {
      if (!items || items.length === 0) return;
      const item = items[0];
      console.log(TAG, '下载完成，文件路径:', item.filename);

      // 通过 fetch 读取本地文件（需要 file:// 权限，MV3 不支持）
      // 改用：直接 fetch 原始 URL 获取文件内容
      try {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        console.log(TAG, '成功获取文件内容，大小:', buffer.byteLength);

        // ArrayBuffer 转 base64，分块处理避免栈溢出
        const uint8 = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8.length; i += chunkSize) {
          binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);

        // 仅向独立光合平台发送数据；卖家后台的嵌入版接口不同，明确不适配。
        const tabs = await chrome.tabs.query({ url: '*://creator.guanghe.taobao.com/*' });
        for (const tab of tabs) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'GH_XLSX_FROM_BACKGROUND',
              base64: base64
            });
            console.log(TAG, '已发送数据到 tab:', tab.id);
          } catch (e) {
            // content-script 未就绪，先注入再重发
            console.log(TAG, 'content-script 未就绪，尝试注入后重发，tab:', tab.id);
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['vendor/xlsx.full.min.js', 'rules.js', 'content-script.js']
              });
              await chrome.tabs.sendMessage(tab.id, {
                type: 'GH_XLSX_FROM_BACKGROUND',
                base64: base64
              });
              console.log(TAG, '注入后重发成功，tab:', tab.id);
            } catch (e2) {
              console.error(TAG, '注入重发失败:', e2);
            }
          }
        }
      } catch (e) {
        console.error(TAG, '获取文件内容失败:', e);
      }
    });
  };

  chrome.downloads.onChanged.addListener(onChanged);
});

function isSycmTrafficPageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.hostname === 'sycm.taobao.com' && url.pathname === '/flow/monitor/overview';
  } catch (error) {
    return false;
  }
}

const BUSINESS_DEFENSE_WEB_TOOL_ORIGINS = new Set([
  'http://localhost:3400',
  'http://127.0.0.1:3400',
  'https://tbdata.aizicheng.com',
]);

function isBusinessDefenseWebToolSender(message, sender) {
  if (!message || message.source !== 'business-defense-web-tool') return false;
  try {
    const url = new URL(String(sender && (sender.url || sender.tab && sender.tab.url) || ''));
    return BUSINESS_DEFENSE_WEB_TOOL_ORIGINS.has(url.origin);
  } catch (error) {
    return false;
  }
}

function isAccountManagementWebToolSender(sender) {
  try {
    const url = new URL(String(sender && (sender.url || sender.tab && sender.tab.url) || ''));
    return BUSINESS_DEFENSE_WEB_TOOL_ORIGINS.has(url.origin) &&
      url.pathname === '/accounts.html';
  } catch (error) {
    return false;
  }
}

function isOneClickWebToolSender(message, sender) {
  if (!isBusinessDefenseWebToolSender(message, sender)) return false;
  try {
    const url = new URL(String(sender && (sender.url || sender.tab && sender.tab.url) || ''));
    return url.pathname === '/report.html';
  } catch (error) {
    return false;
  }
}

async function syncActionAvailability(tabId) {
  if (!Number.isFinite(tabId)) return;
  try {
    await chrome.action.enable(tabId);
    await chrome.action.setTitle({
      tabId,
      title: '淘宝经营数据助手 · 请从团队网页“一键取数”发起任务',
    });
  } catch (error) {}
}

async function syncAllActionAvailability() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => syncActionAvailability(tab.id, tab.url)));
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await syncActionAvailability(tabId, tab && tab.url);
  } catch (error) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    syncActionAvailability(tabId, changeInfo.url || tab && tab.url);
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  syncActionAvailability(tab.id, tab.url);
});

chrome.runtime.onInstalled.addListener(() => {
  console.log(TAG, '扩展已安装');
  syncAllActionAvailability().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  syncAllActionAvailability().catch(() => {});
});
syncAllActionAvailability().catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'SYCM_MAIN_WORLD_CLICK') return;
  const tabId = sender.tab && sender.tab.id;
  const frameId = sender.frameId;
  const clientX = Number(message.clientX);
  const clientY = Number(message.clientY);
  const expectedText = String(message.expectedText || '');
  const targetToken = String(message.targetToken || '');
  if (
    !tabId ||
    !Number.isFinite(frameId) ||
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    !/^[a-z0-9-]{12,80}$/i.test(targetToken)
  ) {
    sendResponse({ ok: false, message: '无法定位页面点击目标。' });
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    func: (payload) => {
      const normalize = (value) => String(value || '')
        .replace(/\s+/g, '')
        .replace(/[：:]/g, '')
        .trim();
      const markedTarget = document.querySelector(
        '[data-sycm-diagnosis-click-token="' + payload.targetToken + '"]'
      );
      if (!markedTarget) return { ok: false, message: '页面主环境未找到已标记的点击元素。' };
      markedTarget.removeAttribute('data-sycm-diagnosis-click-token');

      const expected = normalize(payload.expectedText);
      const targetText = normalize(markedTarget.innerText || markedTarget.textContent);
      if (expected && targetText !== expected) {
        return { ok: false, message: '已标记的点击元素不是“' + expected + '”。' };
      }

      const clickTarget = markedTarget;
      const rect = clickTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return { ok: false, message: '已标记的点击元素当前不可见。' };
      }
      if (typeof clickTarget.focus === 'function') {
        try {
          clickTarget.focus({ preventScroll: true });
        } catch (error) {
          clickTarget.focus();
        }
      }
      if (typeof clickTarget.dispatchEvent !== 'function' || typeof clickTarget.click !== 'function') {
        return { ok: false, message: '页面目标没有可用的点击方法。' };
      }

      const commonEventOptions = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: payload.clientX,
        clientY: payload.clientY,
        button: 0,
      };
      const handlerNames = ['onPointerDown', 'onMouseDown', 'onClick'];
      const componentHandlers = [];
      let componentNode = clickTarget;
      for (let level = 0; level < 8 && componentNode; level += 1, componentNode = componentNode.parentElement) {
        const frameworkKeys = Object.getOwnPropertyNames(componentNode).filter((key) => (
          key.startsWith('__reactProps$') ||
          key.startsWith('__reactEventHandlers$')
        ));
        for (const frameworkKey of frameworkKeys) {
          const props = componentNode[frameworkKey];
          if (!props) continue;
          for (const handlerName of handlerNames) {
            if (typeof props[handlerName] === 'function') {
              componentHandlers.push({
                handler: props[handlerName],
                handlerName,
                node: componentNode,
              });
            }
          }
        }
        if (componentHandlers.length) break;
      }

      if (!componentHandlers.length) {
        let fiberNode = clickTarget;
        for (let level = 0; level < 5 && fiberNode && !componentHandlers.length; level += 1, fiberNode = fiberNode.parentElement) {
          const fiberKey = Object.getOwnPropertyNames(fiberNode).find((key) => (
            key.startsWith('__reactFiber$') ||
            key.startsWith('__reactInternalInstance$')
          ));
          let fiber = fiberKey ? fiberNode[fiberKey] : null;
          for (let fiberLevel = 0; fiberLevel < 12 && fiber; fiberLevel += 1, fiber = fiber.return) {
            const props = fiber.memoizedProps || fiber.pendingProps;
            if (!props) continue;
            for (const handlerName of handlerNames) {
              if (typeof props[handlerName] === 'function') {
                componentHandlers.push({
                  handler: props[handlerName],
                  handlerName,
                  node: fiberNode,
                });
              }
            }
            if (componentHandlers.length) break;
          }
        }
      }

      const invokedHandlers = [];
      for (const componentHandler of componentHandlers) {
        let defaultPrevented = false;
        let propagationStopped = false;
        const eventType = componentHandler.handlerName
          .replace(/^on/, '')
          .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
        const componentEvent = {
          ...commonEventOptions,
          type: eventType,
          target: clickTarget,
          currentTarget: componentHandler.node,
          nativeEvent: new MouseEvent(eventType, commonEventOptions),
          defaultPrevented: false,
          preventDefault() {
            defaultPrevented = true;
            this.defaultPrevented = true;
          },
          stopPropagation() {
            propagationStopped = true;
          },
          isDefaultPrevented() {
            return defaultPrevented;
          },
          isPropagationStopped() {
            return propagationStopped;
          },
          persist() {},
        };
        componentHandler.handler.call(componentHandler.node, componentEvent);
        invokedHandlers.push(componentHandler.handlerName);
      }

      if (!invokedHandlers.length) {
        if (typeof PointerEvent === 'function') {
          clickTarget.dispatchEvent(new PointerEvent('pointerdown', {
            ...commonEventOptions,
            buttons: 1,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
          }));
        }
        clickTarget.dispatchEvent(new MouseEvent('mousedown', {
          ...commonEventOptions,
          buttons: 1,
        }));
        if (typeof PointerEvent === 'function') {
          clickTarget.dispatchEvent(new PointerEvent('pointerup', {
            ...commonEventOptions,
            buttons: 0,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
          }));
        }
        clickTarget.dispatchEvent(new MouseEvent('mouseup', {
          ...commonEventOptions,
          buttons: 0,
        }));
        clickTarget.click();
      }
      const className = String(clickTarget.className || '').replace(/\s+/g, '.').slice(0, 100);
      return {
        ok: true,
        summary: (invokedHandlers.length
          ? 'component-' + invokedHandlers.join('+')
          : 'mouse-events') + ':' +
          clickTarget.tagName.toLowerCase() + (className ? '.' + className : ''),
      };
    },
    args: [{ clientX, clientY, expectedText, targetToken }],
  }).then((results) => {
    const result = results && results[0] && results[0].result;
    sendResponse(result || { ok: false, message: '页面主环境未返回点击结果。' });
  }).catch((error) => {
    sendResponse({
      ok: false,
      message: error && error.message ? error.message : '页面主环境点击失败。',
    });
  });
  return true;
});

async function restoreSourceTab(sourceTabId, contentTabId, shouldCloseContentTab, shouldActivateSource) {
  if (sourceTabId && shouldActivateSource !== false) {
    try {
      await chrome.tabs.update(sourceTabId, { active: true });
    } catch (error) {
      console.warn(TAG, '恢复流量页失败:', error);
    }
  }
  if (shouldCloseContentTab && contentTabId) {
    try {
      await chrome.tabs.remove(contentTabId);
    } catch (error) {
      console.warn(TAG, '关闭自动创建的内容页失败:', error);
    }
  }
}

// 一次只操作一个内容页：DOM 对齐日期，等待指标稳定，再顺序采集渠道。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'SYCM_CAPTURE_CONTENT_TOTALS') return;

  (async () => {
    const sourceTabId = sender.tab && sender.tab.id;
    const backgroundOnly = message.backgroundOnly === true;
    let contentTab = null;
    const fail = async (failureMessage) => {
      await restoreSourceTab(sourceTabId, contentTab && contentTab.id, true, !backgroundOnly);
      sendResponse({ ok: false, message: failureMessage });
    };
    try {
      const expectedDateRange = String(message.expectedDateRange || '');
      const expectedDateMode = String(message.expectedDateMode || '');
      const supportedDateModes = ['last30'];
      if (!expectedDateRange) {
        await fail('未能识别流量页当前日期范围。');
        return;
      }
      if (!supportedDateModes.includes(expectedDateMode)) {
        await fail('当前版本仅支持30天日期口径。');
        return;
      }
      contentTab = await chrome.tabs.create({
        url: 'https://sycm.taobao.com' + SYCM_CONTENT_ANALYSIS_PATH,
        active: !backgroundOnly,
      });

      let lastError = null;
      let alignment = null;
      const maxAttempts = 36;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          const result = await requestSycmDataFrame(contentTab.id, {
            type: 'SYCM_ALIGN_CONTENT_DATE',
            expectedDateRange,
            expectedDateMode,
          });
          if (result && result.ok) {
            alignment = result;
            break;
          }
          lastError = result && result.message ? result.message : lastError;
          if (result && result.retryable === false) {
            await fail(lastError || '内容页日期自动对齐失败。');
            return;
          }
        } catch (error) {
          lastError = error && error.message ? error.message : lastError;
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
      }

      if (!alignment) {
        await fail(lastError || '内容页未完成加载。');
        return;
      }

      const channelResult = await requestSycmDataFrame(contentTab.id, {
        type: 'SYCM_RUN_CHANNEL_DIAGNOSIS',
        expectedDateRange,
      });
      if (!channelResult || !channelResult.ok) {
        await fail(channelResult && channelResult.message
          ? channelResult.message
          : '内容页渠道数据采集失败。');
        return;
      }

      const actualDateRange = canonicalDateRange(channelResult.dateContext);
      if (actualDateRange !== expectedDateRange) {
        await fail('渠道采集完成时日期发生变化。流量页：' + displayDateRange(expectedDateRange) +
          '；内容页：' + displayDateRange(actualDateRange) + '。');
        return;
      }

      await restoreSourceTab(sourceTabId, contentTab.id, true, !backgroundOnly);
      sendResponse({
        ok: true,
        snapshot: channelResult.snapshot,
        rows: channelResult.rows,
        dateContext: channelResult.dateContext,
        dateAligned: Boolean(alignment.changed),
      });
    } catch (error) {
      console.warn(TAG, '内容页自动对齐与取数失败:', error);
      await fail(error && error.message
        ? error.message
        : '无法读取内容页，请确认页面已登录后重试。');
    }
  })();
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'SYCM_RUN_CHANNEL_DIAGNOSIS') return;
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) {
    sendResponse({ ok: false, message: '无法定位当前内容页标签。' });
    return;
  }

  (async () => {
    try {
      const result = await requestSycmDataFrame(tabId, {
        type: 'SYCM_RUN_CHANNEL_DIAGNOSIS',
        expectedDateRange: String(message.expectedDateRange || ''),
      });
      if (result && result.ok && message.expectedDateRange) {
        const actual = canonicalDateRange(result.dateContext);
        if (actual !== String(message.expectedDateRange)) {
          sendResponse({
            ok: false,
            message: '内容页日期在渠道采集期间发生变化。',
          });
          return;
        }
      }
      sendResponse(result || { ok: false, message: '内容指标层未响应。' });
    } catch (error) {
      console.warn(TAG, '渠道诊断转发失败:', error);
      sendResponse({ ok: false, message: '内容页脚本未加载，请刷新内容页后重试。' });
    }
  })();
  return true;
});

const GH_AUTOMATIC_SYNC_URL =
  'https://creator.guanghe.taobao.com/page/unify/asset-overview?tab=singleEffect';

function isWxtReportSender(sender) {
  try {
    const url = new URL(String(sender.url || sender.tab && sender.tab.url || ''));
    return url.hostname === 'one.alimama.com' || url.hostname === 'one.alimama.hk';
  } catch (error) {
    return false;
  }
}

function waitMilliseconds(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function normalizePlatformTaskIds(value) {
  if (value === undefined || value === null) return PLATFORM_TASK_IDS.slice();
  const selected = Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter((item) => PLATFORM_TASK_IDS.includes(item))));
  if (!selected.length) throw new Error('请至少选择一个平台任务。');
  return selected;
}

function shouldRetryPlatformError(error) {
  if (error && error.retryable === false) return false;
  const message = String(error && error.message || error || '');
  return !/(?:滑块|验证码|账号或密码|无权限|未授权|尚未找到.*人群|未找到.*人群包|请先手动创建.*人群|Cannot access contents of url|Extension manifest must request permission)/i.test(message);
}

async function runPlatformStepWithRetry(step) {
  let lastError = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= PLATFORM_RETRY_ATTEMPTS; attempt += 1) {
    attempts = attempt;
    try {
      return { detail: await step.run(), attempts };
    } catch (error) {
      lastError = error;
      if (attempt >= PLATFORM_RETRY_ATTEMPTS || !shouldRetryPlatformError(error)) break;
      // Each platform runner re-enters and reloads its page before collecting again.
      await waitMilliseconds(Math.min(5000, 1200 + attempt * 650));
    }
  }
  const message = String(lastError && lastError.message || lastError || '平台任务失败。');
  if (attempts > 1) {
    const wrapped = new Error(message + '（已重新打开并尝试 ' + attempts + ' 次）');
    if (lastError && lastError.code) wrapped.code = lastError.code;
    if (lastError && lastError.retryable === false) wrapped.retryable = false;
    throw wrapped;
  }
  throw lastError || new Error(message);
}

async function waitTabComplete(tabId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.status === 'complete') return tab;
    } catch (error) {
      throw new Error('标签页已关闭。');
    }
    await waitMilliseconds(500);
  }
  throw new Error('页面加载超时。');
}

async function reloadPlatformTab(tabId, timeoutMs) {
  await chrome.tabs.reload(tabId);
  await waitTabComplete(tabId, timeoutMs);
  // 页面 status=complete 后，单页应用仍需要一小段时间初始化路由和原生请求。
  await waitMilliseconds(1200);
}

async function openOrReuseTab(url, queryPatterns, options) {
  const patterns = Array.isArray(queryPatterns) ? queryPatterns : [url];
  for (const pattern of patterns) {
    const tabs = await chrome.tabs.query({ url: pattern });
    const existing = tabs.find((tab) => tab && tab.id);
    if (existing) {
      const shouldNavigate = !options || options.navigate !== false;
      const update = { active: false };
      if (shouldNavigate && existing.url !== url) update.url = url;
      await chrome.tabs.update(existing.id, update);
      return existing.id;
    }
  }
  const tab = await chrome.tabs.create({ url, active: false });
  return tab.id;
}

async function injectScripts(tabId, scripts) {
  for (const script of scripts) {
    const target = { tabId };
    if (Array.isArray(script.frameIds) && script.frameIds.length) {
      target.frameIds = script.frameIds;
    } else {
      target.allFrames = script.allFrames === true;
    }
    await chrome.scripting.executeScript({
      target,
      files: script.files,
      world: script.world || 'ISOLATED',
    });
  }
}

async function sendTabMessageWithRetry(tabId, message, timeoutMs, messageOptions) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = messageOptions
        ? await chrome.tabs.sendMessage(tabId, message, messageOptions)
        : await chrome.tabs.sendMessage(tabId, message);
      if (response) return response;
    } catch (error) {
      lastError = error;
    }
    await waitMilliseconds(700);
  }
  throw lastError || new Error('页面脚本未响应。');
}

function wxtReportRouteDescriptor(url) {
  try {
    const parsed = new URL(String(url || ''));
    if (!['one.alimama.com', 'one.alimama.hk'].includes(parsed.hostname)) return null;
    if (!parsed.hash.startsWith('#!')) return null;
    const routeAndQuery = parsed.hash.slice(2);
    const queryIndex = routeAndQuery.indexOf('?');
    const route = queryIndex >= 0 ? routeAndQuery.slice(0, queryIndex) : routeAndQuery;
    const query = queryIndex >= 0 ? routeAndQuery.slice(queryIndex + 1) : '';
    return {
      hostname: parsed.hostname,
      route,
      params: new URLSearchParams(query),
    };
  } catch (error) {
    return null;
  }
}

function wxtTargetRouteReached(currentUrl, targetUrl) {
  const current = wxtReportRouteDescriptor(currentUrl);
  const target = wxtReportRouteDescriptor(targetUrl);
  if (!current || !target) return false;
  if (!['/report/account', '/report/short_video_migrate'].includes(target.route)) return false;
  if (current.route !== target.route) return false;
  for (const [key, value] of target.params.entries()) {
    if (current.params.get(key) !== value) return false;
  }
  return true;
}

function wxtReportRouteSignature(url) {
  const descriptor = wxtReportRouteDescriptor(url);
  if (!descriptor) return '';
  const entries = Array.from(descriptor.params.entries())
    .sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
  const params = new URLSearchParams();
  entries.forEach(([key, value]) => params.append(key, value));
  return descriptor.hostname + '|' + descriptor.route + '?' + params.toString();
}

function wxtLoginRoute(url) {
  try {
    const parsed = new URL(String(url || ''));
    return ['one.alimama.com', 'one.alimama.hk'].includes(parsed.hostname) &&
      /#!\/login\/index(?:\?|$)/.test(parsed.hash);
  } catch (error) {
    return false;
  }
}

function inspectWxtBackendFrame(clickEntry, allowCrossFrameGate) {
  const normalize = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, '');
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  };
  const candidates = Array.from(document.querySelectorAll(
    'button,a,[role="button"],input[type="button"],input[type="submit"]'
  )).filter((element) => {
    if (!visible(element) || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
    return normalize(element.innerText || element.textContent || element.value) === '\u8fdb\u5165\u540e\u53f0';
  });
  const unique = Array.from(new Set(candidates));
  const bodyText = String(document.body && (document.body.innerText || document.body.textContent) || '')
    .replace(/\s+/g, ' ')
    .trim();
  const loginRoute = /#!\/login\/index(?:\?|$)/.test(location.hash);
  const welcomeLogin = /\u6b22\u8fce\u767b\u5f55/.test(bodyText);
  const gateVisible = loginRoute || welcomeLogin;
  const entry = (gateVisible || allowCrossFrameGate === true) && unique.length === 1 ? unique[0] : null;
  let clicked = false;
  if (clickEntry && entry) {
    entry.click();
    clicked = true;
  }
  return {
    href: location.href,
    hostname: location.hostname,
    loginRoute,
    welcomeLogin,
    gateVisible,
    entryFound: unique.length === 1,
    candidateCount: unique.length,
    clicked,
  };
}

async function readWxtBackendFrames(tabId, frameId, clickEntry, allowCrossFrameGate) {
  const target = frameId === undefined || frameId === null
    ? { tabId, allFrames: true }
    : { tabId, frameIds: [Number(frameId) || 0] };
  const results = await chrome.scripting.executeScript({
    target,
    func: inspectWxtBackendFrame,
    args: [clickEntry === true, allowCrossFrameGate === true],
  });
  return (Array.isArray(results) ? results : []).map((item) => Object.assign(
    { frameId: Number(item && item.frameId) || 0 },
    item && item.result || {}
  ));
}

function wxtTrustedFrame(frame) {
  try {
    const hostname = String(frame && frame.hostname || new URL(String(frame && frame.href || '')).hostname);
    return hostname === 'one.alimama.com' || hostname === 'one.alimama.hk';
  } catch (error) {
    return false;
  }
}

function wxtTrustedPageUrl(url) {
  try {
    const hostname = new URL(String(url || '')).hostname;
    return hostname === 'one.alimama.com' || hostname === 'one.alimama.hk';
  } catch (error) {
    return false;
  }
}

function wxtLoginGateError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

async function ensureWxtBackendReady(tabId, targetUrl, timeoutMs) {
  const deadline = Date.now() + Math.max(10000, Number(timeoutMs) || 75000);
  let clicked = false;
  let clickAttempted = false;
  let clickAttemptedAt = 0;
  let targetHits = 0;
  let targetSignature = '';
  let unknownHits = 0;
  let navigatedAt = null;
  let lastError = null;
  while (Date.now() < deadline) {
    let tab = null;
    let frames = [];
    try {
      tab = await chrome.tabs.get(tabId);
      frames = await readWxtBackendFrames(tabId, null, false);
      lastError = null;
    } catch (error) {
      lastError = error;
    }
    const topFrame = frames.find((item) => item.frameId === 0);
    const observedUrl = String(topFrame && topFrame.href || tab && tab.url || '');
    const trustedFrames = frames.filter(wxtTrustedFrame);
    const topRouteReady = wxtTargetRouteReached(observedUrl, targetUrl);
    const topGateVisible = Boolean(topFrame && topFrame.gateVisible);

    // A stable top-level report route wins over stale login iframes left by the SPA.
    if (topRouteReady && !topGateVisible) {
      unknownHits = 0;
      const observedSignature = wxtReportRouteSignature(observedUrl);
      if (observedSignature && observedSignature === targetSignature) {
        targetHits += 1;
      } else {
        targetSignature = observedSignature;
        targetHits = 1;
      }
      if (targetHits >= 2) {
        const finalDelay = Math.min(800, Math.max(0, deadline - Date.now()));
        if (finalDelay <= 0) break;
        await waitMilliseconds(finalDelay);
        try {
          const finalTab = await chrome.tabs.get(tabId);
          const finalFrames = await readWxtBackendFrames(tabId, null, false);
          const finalTopFrame = finalFrames.find((item) => item.frameId === 0);
          const finalUrl = String(finalTopFrame && finalTopFrame.href || finalTab && finalTab.url || '');
          const finalGate = Boolean(finalTopFrame && finalTopFrame.gateVisible) || wxtLoginRoute(finalUrl);
          if (!finalGate && wxtTargetRouteReached(finalUrl, targetUrl) &&
              wxtReportRouteSignature(finalUrl) === targetSignature) {
            return { ok: true, clicked, url: finalUrl };
          }
        } catch (error) {
          lastError = error;
        }
        targetHits = 0;
        targetSignature = '';
        continue;
      }
      await waitMilliseconds(500);
      continue;
    }

    targetHits = 0;
    targetSignature = '';
    const loginGate = wxtLoginRoute(observedUrl) || trustedFrames.some((item) => item.gateVisible);
    if (loginGate) {
      unknownHits = 0;
      const entryFrames = trustedFrames.filter((item) => Number(item.candidateCount) > 0);
      if (entryFrames.some((item) => Number(item.candidateCount) > 1) || entryFrames.length > 1) {
        throw wxtLoginGateError(
          'WXT_LOGIN_GATE_AMBIGUOUS',
          '万相台登录确认页出现多个“进入后台”按钮，已停止自动点击，请手动确认。'
        );
      }
      if (entryFrames.length === 1) {
        if (!clickAttempted) {
          clickAttempted = true;
          clickAttemptedAt = Date.now();
          try {
            const clickedFrames = await readWxtBackendFrames(
              tabId,
              entryFrames[0].frameId,
              true,
              true
            );
            clicked = clickedFrames.some((item) => item.clicked);
            if (!clicked) lastError = new Error('按钮点击未返回成功状态');
          } catch (error) {
            // The iframe can be replaced by the SSO redirect between inspection and click.
            // Re-observe the page without issuing a second click.
            lastError = error;
          }
        } else if (Date.now() - clickAttemptedAt >= 10000) {
          throw wxtLoginGateError(
            'WXT_LOGIN_GATE_CLICK_FAILED',
            '万相台已识别“进入后台”，但页面未继续跳转，请手动确认登录。'
          );
        }
      }
      await waitMilliseconds(600);
      continue;
    }

    unknownHits += 1;
    const clickGraceComplete = !clickAttempted || Date.now() - clickAttemptedAt >= 10000;
    const navigationCooldownComplete = navigatedAt === null || Date.now() - navigatedAt >= 5000;
    if (unknownHits >= 2 && clickGraceComplete && navigationCooldownComplete &&
        wxtTrustedPageUrl(observedUrl)) {
      navigatedAt = Date.now();
      try {
        await chrome.tabs.update(tabId, { url: targetUrl, active: false });
        const remaining = Math.min(45000, Math.max(1, deadline - Date.now()));
        await waitTabComplete(tabId, remaining);
        const settleDelay = Math.min(1000, Math.max(0, deadline - Date.now()));
        if (settleDelay > 0) await waitMilliseconds(settleDelay);
        unknownHits = 0;
        continue;
      } catch (error) {
        lastError = error;
      }
    }
    await waitMilliseconds(600);
  }
  const detail = lastError && lastError.message ? '（' + lastError.message + '）' : '';
  throw wxtLoginGateError(
    'WXT_LOGIN_GATE_TIMEOUT',
    clickAttempted
      ? '已点击万相台“进入后台”，但未能进入目标报表页' + detail + '。'
      : '万相台登录确认未完成，未找到可用的“进入后台”按钮' + detail + '。'
  );
}

function guangheFrameRole(value) {
  try {
    const url = new URL(String(value && value.url || value || ''));
    if (url.hostname === 'creator.guanghe.taobao.com') return 'creator';
    if (url.hostname === GUANGHE_SETTINGS_HOST) return 'settings';
    if (url.hostname === 'web.taobao.com' && url.pathname.includes(GUANGHE_DATA_PATH)) {
      return 'asset';
    }
    if (url.hostname === 'sycm.taobao.com' && url.pathname.includes(SYCM_CONTENT_ANALYSIS_PATH)) {
      return 'sycm';
    }
  } catch (error) {}
  return '';
}

function sortGuangheFrames(frames, purpose) {
  const weights = purpose === 'menu'
    ? { settings: 400, asset: 300, creator: 200, sycm: 100 }
    : { asset: 400, settings: 300, sycm: 200, creator: 100 };
  return (frames || []).filter((frame) => guangheFrameRole(frame)).slice().sort((left, right) => {
    const weightDiff = (weights[guangheFrameRole(right)] || 0) -
      (weights[guangheFrameRole(left)] || 0);
    return weightDiff || Number(left.frameId || 0) - Number(right.frameId || 0);
  });
}

function isGuangheFramePermissionError(error) {
  return /Cannot access contents of url|Extension manifest must request permission/i.test(
    String(error && error.message || error || '')
  );
}

function guangheFramePermissionError(cause) {
  const detail = cause && cause.message ? '（' + cause.message + '）' : '';
  const error = new Error(
    '光合设置页的资产入口暂时无法读取，请在扩展程序页重新加载当前版本后重试。' + detail
  );
  error.code = 'GUANGHE_FRAME_PERMISSION_MISSING';
  error.retryable = false;
  return error;
}

async function inspectGuangheAccess(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const text = String(document.body && document.body.innerText || '').slice(0, 30000);
      return {
        url: location.href,
        title: document.title,
        permissionDenied: /当前子账号无运营权限|暂无运营权限|无权访问|没有权限/.test(text),
      };
    },
  });
  return results && results[0] && results[0].result || {};
}

async function tryGuangheSettingsRecovery(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const clickable = (element) => {
        if (!element) return null;
        if (element.matches('button,a,[role="button"],[role="menuitem"]')) return element;
        return element.closest('button,a,[role="button"],[role="menuitem"]');
      };
      const byExactText = (label) => Array.from(document.querySelectorAll('button,a,[role="button"],[role="menuitem"],li,div,span'))
        .find((element) => visible(element) && String(element.textContent || '').trim() === label);

      let settings = byExactText('设置');
      if (!settings) {
        const candidates = Array.from(document.querySelectorAll(
          'button,a,[role="button"],[aria-label],[title],img,svg,canvas,div,span'
        ))
          .filter((element) => {
            if (!visible(element)) return false;
            const rect = element.getBoundingClientRect();
            if (rect.top > 90 || rect.right < window.innerWidth * 0.62) return false;
            const hint = [
              element.getAttribute('aria-label'),
              element.getAttribute('title'),
              element.getAttribute('alt'),
              element.className,
              element.textContent,
            ].join(' ');
            const style = getComputedStyle(element);
            const looksLikeAvatar = rect.width >= 20 && rect.width <= 72 && rect.height >= 20 && rect.height <= 72 && (
              ['IMG', 'SVG', 'CANVAS'].includes(element.tagName) ||
              parseFloat(style.borderRadius || '0') >= Math.min(rect.width, rect.height) * 0.4
            );
            return looksLikeAvatar || /头像|用户|账号|账户|创作者服务|avatar|user|account/i.test(hint);
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const hint = [
              element.getAttribute('aria-label'),
              element.getAttribute('title'),
              element.getAttribute('alt'),
              element.className,
              element.textContent,
            ].join(' ');
            const style = getComputedStyle(element);
            const circular = rect.width >= 20 && rect.width <= 72 && rect.height >= 20 && rect.height <= 72 &&
              parseFloat(style.borderRadius || '0') >= Math.min(rect.width, rect.height) * 0.4;
            let score = rect.right / Math.max(1, window.innerWidth) * 30;
            if (/头像|avatar/i.test(hint)) score += 100;
            else if (/用户|账号|账户|user|account/i.test(hint)) score += 55;
            if (['IMG', 'SVG', 'CANVAS'].includes(element.tagName)) score += 55;
            if (circular) score += 45;
            if (clickable(element)) score += 25;
            if (rect.width > 100 || rect.height > 90) score -= 80;
            if (String(element.textContent || '').trim().length > 30) score -= 60;
            return { element, score };
          })
          .sort((left, right) => right.score - left.score)
          .map((item) => item.element);
        const candidate = candidates[0];
        const target = clickable(candidate) || candidate;
        if (target && typeof target.click === 'function') target.click();
        const menuStartedAt = Date.now();
        while (!settings && Date.now() - menuStartedAt < 4000) {
          await sleep(200);
          settings = byExactText('设置');
        }
      }
      const target = clickable(settings) || settings;
      if (!target || typeof target.click !== 'function') {
        return { ok: false, message: '未找到头像菜单中的“设置”。' };
      }
      const fromUrl = location.href;
      if (target.tagName === 'A') target.setAttribute('target', '_self');
      target.click();
      return { ok: true, fromUrl: fromUrl };
    },
  });
  return results && results[0] && results[0].result || { ok: false, message: '设置页恢复脚本未返回结果。' };
}

async function clickGuangheMenuItem(tabId, label, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    let frames = [{ frameId: 0, url: BUSINESS_DEFENSE_GH_URL }];
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId }) || frames;
    } catch (error) {
      lastError = error;
    }
    frames = sortGuangheFrames(frames, 'menu');
    if (!frames.length) frames = [{ frameId: 0, url: BUSINESS_DEFENSE_GH_URL }];
    let permissionFailure = null;
    for (const frame of frames) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frame.frameId] },
          args: [label],
          func: (targetLabel) => {
            const visible = (element) => {
              if (!element) return false;
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return rect.width > 0 && rect.height > 0 &&
                style.display !== 'none' && style.visibility !== 'hidden';
            };
            const candidates = Array.from(document.querySelectorAll(
              'a,button,[role="button"],[role="menuitem"],li,div,span'
            )).filter((element) => (
              visible(element) && String(element.textContent || '').trim() === targetLabel
            ));
            const item = candidates.map((element) => {
              const target = element.closest(
                'a,button,[role="button"],[role="menuitem"],li,[class*="menu-item"],[class*="menu-title"]'
              ) || element;
              const rect = target.getBoundingClientRect();
              return {
                target,
                score: (rect.width <= 360 && rect.height <= 100 ? 100 : 0) -
                  Math.max(0, String(target.textContent || '').trim().length - targetLabel.length),
              };
            }).sort((left, right) => right.score - left.score)[0];
            if (!item || !item.target || typeof item.target.click !== 'function') return null;
            item.target.scrollIntoView({ block: 'center', inline: 'nearest' });
            if (item.target.tagName === 'A') item.target.setAttribute('target', '_self');
            item.target.click();
            return {
              clicked: true,
              label: targetLabel,
              url: location.href,
            };
          },
        });
        const result = results && results[0] && results[0].result;
        if (result && result.clicked) return result;
      } catch (error) {
        lastError = error;
        if (isGuangheFramePermissionError(error)) permissionFailure = error;
      }
    }
    if (permissionFailure) throw guangheFramePermissionError(permissionFailure);
    await waitMilliseconds(350);
  }
  throw new Error(
    '光合设置页未找到“' + label + '”入口。' +
    (lastError && lastError.message ? '（' + lastError.message + '）' : '')
  );
}

async function waitForGuangheAssetOverview(tabId, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    let frames = [];
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId }) || [];
    } catch (error) {
      lastError = error;
    }
    frames = sortGuangheFrames(frames, 'data');
    if (!frames.length) frames = [{ frameId: 0, url: BUSINESS_DEFENSE_GH_URL }];
    let permissionFailure = null;
    for (const frame of frames) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [frame.frameId] },
          func: () => {
            const text = String(document.body && document.body.innerText || '').slice(0, 40000);
            const denied = /当前子账号无运营权限|暂无运营权限|无权访问|没有权限/.test(text);
            const metricCount = ['内容供给', '种草成交金额', '公域内容数']
              .filter((label) => text.includes(label)).length;
            const legacyAssetRoute = /asset-overview/i.test(location.href);
            const xstoreAssetRoute = location.hostname === 'xstore.insights.1688.com' &&
              /资产总览/.test(text) && metricCount >= 1 &&
              (metricCount >= 2 || /近\s*30\s*天|30日|内容来源|消费渠道|作品范围/.test(text));
            const ready = !denied && metricCount >= 1 && (legacyAssetRoute || xstoreAssetRoute);
            return ready ? { ready: true, url: location.href, metricCount } : null;
          },
        });
        const result = results && results[0] && results[0].result;
        if (result && result.ready) {
          return Object.assign({}, result, { frameId: Number(frame.frameId) });
        }
      } catch (error) {
        lastError = error;
        if (isGuangheFramePermissionError(error)) permissionFailure = error;
      }
    }
    if (permissionFailure) throw guangheFramePermissionError(permissionFailure);
    await waitMilliseconds(500);
  }
  throw new Error(
    '已点击“资产总览”，但光合内容数据未在30秒内加载完成。' +
    (lastError && lastError.message ? '（' + lastError.message + '）' : '')
  );
}

async function waitForGuangheCollectorReady(tabId, frameId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [Number(frameId)] },
        world: 'MAIN',
        func: () => typeof window.__ghFetchChannelDiagnosis === 'function',
      });
      if (results && results[0] && results[0].result === true) return true;
    } catch (error) {
      if (isGuangheFramePermissionError(error)) throw guangheFramePermissionError(error);
      if (/No frame with id|Frame .* was removed|frameId/i.test(String(error && error.message || error))) {
        return false;
      }
    }
    await waitMilliseconds(400);
  }
  return false;
}

async function runGuangheCollectorOnTab(tabId, source, options) {
  await waitTabComplete(tabId, 30000);
  const tab = await chrome.tabs.get(tabId);
  const isSycmMirror = String(tab && tab.url || '').includes(SYCM_CONTENT_ANALYSIS_PATH);
  let frames = [];
  try {
    frames = await chrome.webNavigation.getAllFrames({ tabId }) || [];
  } catch (error) {}
  const settingsRecovery = String(source || '').includes('设置→内容数据→资产总览');
  const preferredFrameId = Number.isInteger(options && options.preferredFrameId)
    ? Number(options.preferredFrameId)
    : null;
  const hasGuangheDataFrame = frames.some((frame) => guangheFrameRole(frame) === 'asset');
  const hasGuangheSettingsFrame = settingsRecovery &&
    frames.some((frame) => guangheFrameRole(frame) === 'settings');
  const useFrameCollector = isSycmMirror || hasGuangheDataFrame || hasGuangheSettingsFrame;
  const request = {
    type: 'GH_RUN_CHANNEL_DIAGNOSIS',
    timeoutMs: 130000,
    silent: true,
    metricsOnly: !(options && options.metricsOnly === false),
  };
  let response;
  if (useFrameCollector) {
    frames = frames.length ? frames : await chrome.webNavigation.getAllFrames({ tabId });
    const preferredFramePresent = preferredFrameId !== null &&
      frames.some((frame) => Number(frame.frameId) === preferredFrameId);
    const preferredFrames = sortGuangheFrames(frames, 'data').filter((frame) => {
      const role = guangheFrameRole(frame);
      return role === 'asset' || role === 'sycm' ||
        (settingsRecovery && role === 'settings' &&
          (!preferredFramePresent || Number(frame.frameId) === preferredFrameId)) ||
        (Number(frame.frameId) === 0 && role === 'creator');
    }).sort((left, right) => {
      if (preferredFrameId === null) return 0;
      return Number(Number(right.frameId) === preferredFrameId) -
        Number(Number(left.frameId) === preferredFrameId);
    });
    const candidates = preferredFrames.length ? preferredFrames : [{ frameId: 0 }];
    let failure = null;
    for (const frame of candidates) {
      try {
        await injectScripts(tabId, [
          { files: ['page-hook.js'], world: 'MAIN', frameIds: [frame.frameId] },
          { files: ['vendor/xlsx.full.min.js', 'rules.js', 'content-script.js'], frameIds: [frame.frameId] },
        ]);
      } catch (error) {
        if (isGuangheFramePermissionError(error)) throw guangheFramePermissionError(error);
        failure = { ok: false, message: error && error.message || '光合数据脚本注入失败。' };
        continue;
      }
      const collectorReady = await waitForGuangheCollectorReady(tabId, frame.frameId, 32000);
      if (!collectorReady) {
        failure = { ok: false, message: '光合资产总览接口尚未就绪。' };
        continue;
      }
      let candidate = null;
      try {
        candidate = await sendSycmFrameMessage(tabId, frame.frameId, request);
      } catch (error) {
        failure = { ok: false, message: error && error.message || '光合数据 frame 已发生变化。' };
        continue;
      }
      if (candidate && candidate.ok) {
        response = candidate;
        break;
      }
      if (candidate && candidate.message) failure = candidate;
    }
    response = response || failure;
  } else {
    await injectScripts(tabId, [
      { files: ['page-hook.js'], world: 'MAIN' },
      { files: ['vendor/xlsx.full.min.js', 'rules.js', 'content-script.js'] },
    ]);
    const collectorReady = await waitForGuangheCollectorReady(tabId, 0, 32000);
    if (!collectorReady) throw new Error('光合资产总览接口未在页面中完成初始化。');
    response = await sendTabMessageWithRetry(tabId, request, 150000);
  }
  if (!response || !response.ok) throw new Error(response && response.message || '光合取数失败。');
  const stored = await chrome.storage.local.get('gh_channel_snapshot');
  const snapshot = response.snapshot || stored.gh_channel_snapshot;
  const selfRow = snapshot && Array.isArray(snapshot.rows)
    ? snapshot.rows.find((row) => row.channel === '全部' && row.assetCode === 'self')
    : null;
  if (!snapshot || !Number.isFinite(Number(snapshot.seedingGmvShare))) {
    throw new Error('光合已读取内容供给，但未找到30日“种草成交金额占比”。');
  }
  if (!selfRow || !Number.isFinite(Number(selfRow.publishedContents)) ||
      !Number.isFinite(Number(selfRow.publicContents))) {
    throw new Error('光合未返回自制内容发布数或审核通过数。');
  }
  if (snapshot) {
    await chrome.storage.local.set({
      gh_channel_snapshot: Object.assign({}, snapshot, {
        collectionSource: source,
      }),
    });
  }
  return Object.assign({}, response, { source: source });
}

async function runBusinessDefenseGuanghe(options) {
  const tabId = await openOrReuseTab(BUSINESS_DEFENSE_GH_URL, ['*://creator.guanghe.taobao.com/*']);
  await waitTabComplete(tabId, 30000);
  await reloadPlatformTab(tabId, 45000);
  let access = await inspectGuangheAccess(tabId);
  if (access.permissionDenied) {
    const recovery = await tryGuangheSettingsRecovery(tabId);
    if (!recovery.ok) throw new Error(recovery.message || '光合账号无运营权限。');
    await waitMilliseconds(800);
    await clickGuangheMenuItem(tabId, '内容数据', 15000);
    await clickGuangheMenuItem(tabId, '资产总览', 15000);
    const readyFrame = await waitForGuangheAssetOverview(tabId, 30000);
    return runGuangheCollectorOnTab(
      tabId,
      '淘宝光合（设置→内容数据→资产总览）',
      Object.assign({}, options || {}, { preferredFrameId: readyFrame.frameId })
    );
  }
  return runGuangheCollectorOnTab(tabId, '淘宝光合', options);
}

async function runBusinessDefenseSycm() {
  const tabId = await openOrReuseTab(BUSINESS_DEFENSE_SYCM_TRAFFIC_URL, ['*://sycm.taobao.com/flow/monitor/overview*']);
  await waitTabComplete(tabId, 45000);
  await reloadPlatformTab(tabId, 45000);
  await injectScripts(tabId, [
    { files: ['sycm-content-script.js'], allFrames: true },
  ]);
  const startedAt = Date.now();
  let response = null;
  let responseError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await sendTabMessageWithRetry(tabId, {
        type: 'SYCM_RUN_TRAFFIC_DIAGNOSIS',
      }, 90000, { frameId: 0 });
      if (response && response.ok) break;
      const message = String(response && response.message || '');
      if (attempt === 0 && /30天|日期工具条|日期未完成切换|页面稳定/.test(message)) {
        await waitMilliseconds(2500);
        continue;
      }
      break;
    } catch (error) {
      responseError = error;
      if (attempt === 0) {
        await waitMilliseconds(2500);
        continue;
      }
    }
  }
  const stored = await chrome.storage.local.get('businessDefenseSycmTrafficSnapshotV1');
  const snapshot = response && response.snapshot || stored.businessDefenseSycmTrafficSnapshotV1;
  const requiredMetrics = [
    'storeVisitors',
    'shortVideoVisitors',
    'microDetailVisitors',
    'recommendedTrafficShare',
  ];
  const snapshotComplete = snapshot && Number(snapshot.savedAt) >= startedAt - 2000 &&
    requiredMetrics.every((key) => (
      snapshot[key] !== null && snapshot[key] !== undefined &&
      Number.isFinite(Number(snapshot[key]))
    ));
  if (snapshotComplete) {
    return {
      ok: true,
      source: '生意参谋流量页（必需指标）',
      snapshot,
    };
  }
  throw new Error(
    response && response.message ||
    responseError && responseError.message ||
    '生意参谋未返回本次所需的流量指标。'
  );
}

async function readWxtVisiblePotentialRatio(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const normalize = (value) => String(value == null ? '' : value)
        .normalize('NFKC')
        .replace(/\s+/g, '')
        .replace(/[^a-z0-9\u4e00-\u9fff]/gi, '')
        .toLowerCase();
      const labels = new Set([
        '引导访问潜客占比',
        '引导访问潜客比例',
        '潜客占比',
        '潜客比',
      ].map(normalize));
      const inlineRatio = (value) => {
        const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
        if (text.length > 180) return null;
        const match = text.match(
          /(?:引导访问潜客占比|引导访问潜客比例|潜客占比|潜客比)[^\d%-]{0,30}(-?\d[\d,]*(?:\.\d+)?)\s*[%％]/
        );
        if (!match) return null;
        const ratio = Number(match[1].replace(/,/g, '')) / 100;
        return Number.isFinite(ratio) ? ratio : null;
      };
      const visible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden';
      };
      const nodes = Array.from(document.querySelectorAll('span,div,th,td'));
      for (const node of nodes) {
        const label = String(node.innerText || node.textContent || '').trim();
        if (!visible(node)) continue;
        const directRatio = inlineRatio(label);
        if (directRatio !== null) return directRatio;
        if (!labels.has(normalize(label))) continue;
        let container = node;
        for (let depth = 0; container && depth < 5; depth += 1) {
          const text = String(container.innerText || container.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
          const labelledRatio = inlineRatio(text);
          if (labelledRatio !== null) return labelledRatio;
          if (text.length <= 180) {
            const match = text.match(/(-?\d[\d,]*(?:\.\d+)?)\s*[%％]/);
            if (match) {
              const value = Number(match[1].replace(/,/g, '')) / 100;
              if (Number.isFinite(value)) return value;
            }
          }
          container = container.parentElement;
        }
      }
      return null;
    },
  });
  const match = (results || []).find((item) => (
    item && item.result !== null && item.result !== undefined && item.result !== '' &&
    Number.isFinite(Number(item.result))
  ));
  return match ? Number(match.result) : null;
}

function businessDefenseWxtShortVideoUrl(startTime, endTime) {
  const params = new URLSearchParams({
    rptType: 'short_video_migrate',
    bizCode: 'onebpShortVideo',
    startTime: String(startTime || ''),
    endTime: String(endTime || ''),
  });
  return 'https://one.alimama.com/indexbp.html#!/report/short_video_migrate?' + params.toString();
}

async function recoverBusinessDefenseWxtPotentialRatio(tabId, response) {
  const captured = Array.isArray(response && response.capturedMetrics)
    ? response.capturedMetrics
    : [];
  if (captured.includes('潜客比')) return response;

  const startTime = String(response && response.startTime || '');
  const endTime = String(response && response.endTime || '');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(startTime) ||
      !/^20\d{2}-\d{2}-\d{2}$/.test(endTime)) {
    return response;
  }

  await chrome.tabs.update(tabId, {
    url: businessDefenseWxtShortVideoUrl(startTime, endTime),
    active: false,
  });
  await waitTabComplete(tabId, 45000);
  await ensureWxtBackendReady(tabId, businessDefenseWxtShortVideoUrl(startTime, endTime), 75000);

  const deadline = Date.now() + 60000;
  let potentialRatio = null;
  while (Date.now() < deadline) {
    potentialRatio = await readWxtVisiblePotentialRatio(tabId);
    if (potentialRatio !== null) break;
    await waitMilliseconds(1000);
  }
  if (potentialRatio === null) return response;

  const stored = await chrome.storage.local.get('wxtBusinessDefenseReportV1');
  const snapshot = stored.wxtBusinessDefenseReportV1;
  const data = snapshot && snapshot.data;
  if (!snapshot || !data || String(data.startTime || '') !== startTime ||
      String(data.endTime || '') !== endTime) {
    return response;
  }

  const display = Object.assign({}, data.shortVideoDisplay || data.shortVideo || {}, {
    inshopPotentialUvRate: potentialRatio,
  });
  const nextData = Object.assign({}, data, {
    shortVideoDisplay: display,
    shortVideo: Object.assign({}, data.shortVideo || {}, display),
    businessDefenseMetrics: Object.assign({}, data.businessDefenseMetrics || {}, {
      displayPotentialRatio: potentialRatio,
      displayPotentialRatioSource: 'shortVideoPageSummary',
    }),
    businessDefenseActivity: Object.assign({}, data.businessDefenseActivity || {}, {
      hasShortVideoScope: true,
      hasTrafficActivity: true,
      hasDirectPotentialSignal: true,
    }),
  });
  await chrome.storage.local.set({
    wxtBusinessDefenseReportV1: Object.assign({}, snapshot, {
      savedAt: Date.now(),
      reportKind: 'marketingScene',
      data: nextData,
    }),
  });

  const capturedMetrics = Array.from(new Set(captured.concat('潜客比')));
  const missingMetrics = (Array.isArray(response.missingMetrics) ? response.missingMetrics : [])
    .filter((name) => name !== '潜客比');
  return Object.assign({}, response, {
    partial: missingMetrics.length > 0,
    capturedMetrics,
    missingMetrics,
    potentialRatioSource: '万相台短视频页面顶部汇总',
  });
}

async function runBusinessDefenseWxt() {
  const tabId = await openOrReuseTab(BUSINESS_DEFENSE_WXT_URL, ['*://one.alimama.com/*', '*://one.alimama.hk/*']);
  await waitTabComplete(tabId, 45000);
  await reloadPlatformTab(tabId, 45000);
  await ensureWxtBackendReady(tabId, BUSINESS_DEFENSE_WXT_URL, 75000);
  const collect = async () => {
    await injectScripts(tabId, [
      { files: ['wxt-report-page-hook.js', 'wxt-report-response-hook.js'], world: 'MAIN' },
      { files: ['wxt-report-trace.js'] },
      { files: ['vendor/xlsx.full.min.js', 'wxt-report-content.js'] },
    ]);
    return sendTabMessageWithRetry(tabId, {
      type: 'WXT_RUN_BUSINESS_DEFENSE_METRICS',
    }, 210000);
  };
  let response = await collect();
  if (!response || (!response.ok && /HTTP\s*(?:401|403)/i.test(String(response.message || '')))) {
    await reloadPlatformTab(tabId, 45000);
    await ensureWxtBackendReady(tabId, BUSINESS_DEFENSE_WXT_URL, 75000);
    response = await collect();
  }
  if (!response || !response.ok) throw new Error(response && response.message || '万相台取数失败。');
  if (!Array.isArray(response.capturedMetrics) || !response.capturedMetrics.includes('潜客比')) {
    try {
      response = await recoverBusinessDefenseWxtPotentialRatio(tabId, response);
    } catch (error) {
      console.warn(TAG, '万相台页面潜客比补取失败:', error);
    }
  }
  return response;
}

async function prepareContentDiagnosisWxtTab(section) {
  const targetUrl = section === 'shortVideo'
    ? CONTENT_DIAGNOSIS_WXT_SHORT_URL
    : BUSINESS_DEFENSE_WXT_URL;
  const tabId = await openOrReuseTab(
    targetUrl,
    ['*://one.alimama.com/*', '*://one.alimama.hk/*']
  );
  await waitTabComplete(tabId, 45000);
  await reloadPlatformTab(tabId, 45000);
  await ensureWxtBackendReady(tabId, targetUrl, 75000);
  await injectScripts(tabId, [
    { files: ['wxt-report-page-hook.js', 'wxt-report-response-hook.js'], world: 'MAIN' },
    { files: ['wxt-report-trace.js'] },
    { files: ['vendor/xlsx.full.min.js', 'wxt-report-content.js'] },
  ]);
  return tabId;
}

async function runContentDiagnosisWxtSection(tabId, runId, section) {
  const type = section === 'shortVideo'
    ? 'WXT_GENERATE_SHORT_VIDEO_REPORT_SNAPSHOT'
    : 'WXT_GENERATE_MARKETING_REPORT_SNAPSHOT';
  const targetUrl = section === 'shortVideo'
    ? CONTENT_DIAGNOSIS_WXT_SHORT_URL
    : BUSINESS_DEFENSE_WXT_URL;
  const timeoutMs = section === 'shortVideo' ? 8 * 60 * 1000 : 4 * 60 * 1000;
  const collect = () => sendTabMessageWithRetry(tabId, { type, runId }, timeoutMs);
  let response = await collect();
  if (!response || (!response.ok && /HTTP\s*(?:401|403)/i.test(String(response.message || '')))) {
    await reloadPlatformTab(tabId, 45000);
    await ensureWxtBackendReady(tabId, targetUrl, 75000);
    await injectScripts(tabId, [
      { files: ['wxt-report-page-hook.js', 'wxt-report-response-hook.js'], world: 'MAIN' },
      { files: ['wxt-report-trace.js'] },
      { files: ['vendor/xlsx.full.min.js', 'wxt-report-content.js'] },
    ]);
    response = await collect();
  }
  if (!response || !response.ok) {
    throw new Error(response && response.message || '万相台报告生成失败。');
  }
  const stored = await chrome.storage.local.get(CONTENT_DIAGNOSIS_WXT_KEY);
  const snapshot = stored && stored[CONTENT_DIAGNOSIS_WXT_KEY];
  const sectionSnapshot = snapshot && snapshot[section];
  if (!snapshot || snapshot.runId !== runId || !sectionSnapshot || sectionSnapshot.ok !== true) {
    throw new Error('万相台报告已返回，但完整报告快照未保存。');
  }
  return Object.assign({}, response, {
    source: section === 'shortVideo' ? '万相台短视频诊断' : '万相台营销场景报告',
    savedAt: snapshot.savedAt,
  });
}

async function runBusinessDefenseDmp(options) {
  const includeXiaohongshu = !(options && options.includeXiaohongshu === false);
  const expectedRoles = includeXiaohongshu
    ? ['tt', 'store', 'xhs', 'xhsVisit']
    : ['tt', 'store'];
  const tabId = await openOrReuseTab(BUSINESS_DEFENSE_DMP_URL, ['*://dmp.taobao.com/*']);
  await waitTabComplete(tabId, 45000);
  await reloadPlatformTab(tabId, 45000);
  const targetNames = [
    '淘天内容人群资产',
    '全店人群资产',
  ].concat(includeXiaohongshu ? [
    '小红书内容人群资产',
    '小红书进店人群',
  ] : []);
  const inspection = await runDmpCrowdPresetAction(tabId, 'inspect', { names: targetNames });
  const inspectedCrowds = inspection && Array.isArray(inspection.results) ? inspection.results : [];
  const inspectedByName = new Map(inspectedCrowds.map((item) => [item.name, item]));
  const missingCrowds = targetNames.filter((name) => {
    const item = inspectedByName.get(name);
    return !item || !item.exists;
  });
  if (!inspection || inspection.ok === false) {
    throw new Error(
      'DMP 未能读取“我的人群”列表，请确认达摩盘页面已登录。'
    );
  }
  const availableCrowds = inspectedCrowds.filter((item) => item && item.exists && item.crowdId);
  if (!availableCrowds.length) {
    throw new Error('DMP 尚未找到本次任务需要的目标人群包，请先手动创建至少一个人群包。');
  }
  const ensureResult = {
    ok: true,
    account: inspection.account,
    results: availableCrowds.map((item) => ({
      name: item.name,
      ok: true,
      exists: true,
      skipped: true,
      verified: true,
      crowdId: item.crowdId,
      actualName: item.actualName,
      coverage: item.coverage,
      message: '已读取手动创建的人群',
    })),
  };
  await waitMilliseconds(350);
  await injectScripts(tabId, [
    { files: ['dmp-page-hook.js'], world: 'MAIN' },
  ]);
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (creationResults) => {
        const REQUEST_TYPE = 'DMP_PORTRAIT_REQUEST_V2';
        const RESPONSE_TYPE = 'DMP_PORTRAIT_RESPONSE_V2';
        const normalize = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
        const isUsableCoverageValue = (value) => {
          if (typeof value === 'number') return Number.isFinite(value);
          if (typeof value !== 'string') return false;
          const text = value.trim();
          if (!text || /计算中|生成中|处理中|暂无|^[-–—]+$/.test(text)) return false;
          return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:万|亿)?$/.test(
            text.replace(/[,，\s]/g, '').replace(/[人个]$/, '')
          );
        };
        const coverageFrom = (...values) => {
          const usable = values.find(isUsableCoverageValue);
          if (usable !== undefined) return usable;
          const pending = values.find((value) => (
            value !== undefined && value !== null && String(value).trim() !== ''
          ));
          return pending === undefined ? '' : pending;
        };
        const compactCrowd = (crowd, fallback) => {
          const source = crowd && typeof crowd === 'object' ? crowd : {};
          const base = fallback && typeof fallback === 'object' ? fallback : {};
          return {
            crowdId: source.crowdId ?? source.id ?? base.crowdId ?? base.id ?? '',
            crowdName: source.crowdName ?? source.name ?? base.crowdName ?? base.name ?? '',
            coverage: coverageFrom(
              source.crowdNum, source.coverNum, source.coverage, source.crowdSize,
              source.size, source.num, source.uv, source.count, source.population, source.optionNum,
              base.crowdNum, base.coverNum, base.coverage, base.crowdSize,
              base.size, base.num, base.uv, base.count, base.population, base.optionNum
            ),
          };
        };
        const hasCoverage = (crowd) => isUsableCoverageValue(crowd && crowd.coverage);
        const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
        let stage = '初始化页面桥接';
        function dmpAction(action, payload) {
          const id = 'bd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              window.removeEventListener('message', onMessage);
              reject(new Error('DMP ' + action + ' 超时'));
            }, 45000);
            function onMessage(event) {
              if (event.source !== window) return;
              const message = event.data;
              if (!message || message.type !== RESPONSE_TYPE || message.id !== id) return;
              clearTimeout(timer);
              window.removeEventListener('message', onMessage);
              if (message.ok) resolve(message.data);
              else reject(new Error(message.message || ('DMP ' + action + ' 失败')));
            }
            window.addEventListener('message', onMessage);
            window.postMessage({ type: REQUEST_TYPE, id, action, payload: payload || {} }, '*');
          });
        }

        try {
          const wanted = [
            { key: 'tt', name: '淘天内容人群资产' },
            { key: 'store', name: '全店人群资产' },
            { key: 'xhs', name: '小红书内容人群资产' },
            { key: 'xhsVisit', name: '小红书进店人群' },
          ];
          const selectedByRole = new Map();
          (Array.isArray(creationResults) ? creationResults : []).forEach((result) => {
            const item = wanted.find((candidate) => normalize(candidate.name) === normalize(result && result.name));
            if (!item || !result || !result.crowdId) return;
            selectedByRole.set(item.key, {
              role: item.key,
              crowd: compactCrowd({
                crowdId: result.crowdId,
                crowdName: result.actualName || item.name,
                coverage: result.coverage,
              }),
            });
          });
          const availableWanted = wanted.filter((item) => selectedByRole.has(item.key));
          if (!availableWanted.length) throw new Error('未找到可读取的已有人群包。');
          stage = '读取已有人群包人数';
          for (let attempt = 0; attempt < 12; attempt += 1) {
            let crowds = [];
            const needsRefresh = availableWanted.some((item) => (
              !hasCoverage(selectedByRole.get(item.key).crowd)
            ));
            if (needsRefresh) {
              const crowdResult = await dmpAction('listCrowds', {
                pageSize: 500,
                all: attempt === 0 || attempt % 4 === 0,
              });
              crowds = Array.isArray(crowdResult && crowdResult.list) ? crowdResult.list : [];
            }
            for (const item of availableWanted) {
              const previous = selectedByRole.get(item.key);
              const summary = crowds.find((crowd) => (
                String(crowd && crowd.crowdId || '') === String(previous.crowd.crowdId || '') ||
                normalize(crowd && crowd.crowdName) === normalize(previous.crowd.crowdName) ||
                normalize(crowd && crowd.crowdName) === normalize(item.name)
              ));
              if (!summary && !previous) continue;
              let crowd = summary ? compactCrowd(summary) : previous.crowd;
              if (!hasCoverage(crowd) && previous && hasCoverage(previous.crowd)) crowd = previous.crowd;
              if (!hasCoverage(crowd)) {
                try {
                  const detailed = await dmpAction('getCrowd', { crowdId: crowd.crowdId });
                  crowd = compactCrowd(detailed, crowd);
                } catch (error) {}
              }
              selectedByRole.set(item.key, { role: item.key, crowd });
            }
            const allSized = availableWanted.every((item) => (
              hasCoverage(selectedByRole.get(item.key).crowd)
            ));
            if (allSized) break;
            if (attempt < 11) await sleep(3000);
          }
          const pendingCrowds = availableWanted.filter((item) => (
            !hasCoverage(selectedByRole.get(item.key).crowd)
          ));

          let orderedGroups = [];
          let portraitSetupError = '';
          stage = '读取画像标签分组';
          try {
            const groups = await dmpAction('getTagGroups', {});
            orderedGroups = (Array.isArray(groups) ? groups : []).slice().sort((left, right) => {
              const priority = (group) => /年龄|消费|购买力|画像|属性/.test(normalize(group && group.name)) ? 1 : 0;
              return priority(right) - priority(left);
            });
            if (!orderedGroups.length) portraitSetupError = '画像页未返回任何标签分组。';
          } catch (error) {
            portraitSetupError = error && error.message ? error.message : String(error);
          }

          const isAgeTag = (tag) => {
            const name = normalize(tag && tag.tagName);
            return name === '年龄' || name.includes('年龄段') || name.includes('用户年龄') ||
              name.includes('消费者年龄') || name.includes('人群年龄') || name.includes('年龄分布');
          };
          const isConsumerTag = (tag) => {
            const name = normalize(tag && tag.tagName);
            return name.includes('消费能力等级') || name.includes('购买力等级') ||
              name === '消费能力' || name === '购买力';
          };

          async function findPortraitTags(crowd) {
            if (portraitSetupError) throw new Error(portraitSetupError);
            const found = { age: null, consumer: null };
            let checked = 0;
            for (const group of orderedGroups) {
              stage = '在画像标签分组中查找“年龄”和“消费能力等级”';
              let tags;
              try {
                tags = await dmpAction('getTags', { groupId: group.id, crowdId: crowd.crowdId });
              } catch (error) {
                continue;
              }
              checked += 1;
              if (!found.age) found.age = (Array.isArray(tags) ? tags : []).find(isAgeTag) || null;
              if (!found.consumer) {
                found.consumer = (Array.isArray(tags) ? tags : []).find(isConsumerTag) || null;
              }
              if (found.age && found.consumer) return found;
            }
            const missing = [!found.age && '年龄', !found.consumer && '消费能力等级'].filter(Boolean);
            throw new Error('遍历' + checked + '个画像标签分组后仍未找到“' + missing.join('”、“') + '”。');
          }

          const output = [];
          const warnings = [];
          let portraitTags = null;
          if (!portraitSetupError && availableWanted.length) {
            try {
              portraitTags = await findPortraitTags(selectedByRole.get(availableWanted[0].key).crowd);
            } catch (error) {
              portraitSetupError = error && error.message ? error.message : String(error);
            }
          }
          for (const item of availableWanted) {
            const crowd = selectedByRole.get(item.key).crowd;
            if (!portraitTags) {
              const message = portraitSetupError || '未读取到画像标签。';
              warnings.push(item.name + '：' + message);
              output.push({ role: item.key, crowd, charts: [], error: message });
              continue;
            }
            try {
              const maxPortraitAttempts = 3;
              let portrait = null;
              let charts = [];
              let ageChart = null;
              let consumerChart = null;
              let portraitAttempts = 0;
              let lastPortraitError = null;
              for (let attempt = 1; attempt <= maxPortraitAttempts; attempt += 1) {
                portraitAttempts = attempt;
                stage = '生成“' + crowd.crowdName + '”年龄与消费能力画像（第' + attempt + '次）';
                try {
                  const candidate = await dmpAction('buildPortrait', {
                    crowdId: crowd.crowdId,
                    crowdName: crowd.crowdName,
                    tags: [portraitTags.age, portraitTags.consumer].map((tag) => ({
                      id: tag.id,
                      tagId: tag.tagId,
                      tagName: tag.tagName,
                      _multiGroupOptions: tag._multiGroupOptions,
                    })),
                  });
                  portrait = candidate || portrait;
                  const candidateCharts = Array.isArray(candidate && candidate.charts) ? candidate.charts : [];
                  const candidateAge = candidateCharts.find((chart) => (
                    isAgeTag({ tagName: chart && chart.tagName })
                  )) || null;
                  const candidateConsumer = candidateCharts.find((chart) => (
                    isConsumerTag({ tagName: chart && chart.tagName })
                  )) || null;
                  const rowCount = (chart) => (
                    chart && Array.isArray(chart.rows) ? chart.rows.length : 0
                  );
                  if (candidateAge && (!ageChart || rowCount(candidateAge) > rowCount(ageChart))) {
                    ageChart = candidateAge;
                  }
                  if (candidateConsumer && (
                    !consumerChart || rowCount(candidateConsumer) > rowCount(consumerChart)
                  )) {
                    consumerChart = candidateConsumer;
                  }
                  charts = [ageChart, consumerChart].filter(Boolean);
                  const hasAgeRows = Boolean(ageChart && Array.isArray(ageChart.rows) && ageChart.rows.length);
                  const hasConsumerRows = Boolean(
                    consumerChart && Array.isArray(consumerChart.rows) && consumerChart.rows.length
                  );
                  if (hasAgeRows && hasConsumerRows) break;
                  lastPortraitError = null;
                } catch (error) {
                  lastPortraitError = error;
                  const errorText = error && error.message ? error.message : String(error);
                  if (/未登录|无权限|权限不足|验证码|滑块|身份校验|HTTP\s*(?:401|403)/i.test(errorText)) {
                    throw error;
                  }
                }
                if (attempt < maxPortraitAttempts) await sleep(1500 * attempt);
              }
              if (!portrait && lastPortraitError) throw lastPortraitError;
              const chartWarnings = [];
              const attemptSuffix = portraitAttempts > 1 ? '（已尝试' + portraitAttempts + '次）' : '';
              if (!ageChart || !Array.isArray(ageChart.rows) || !ageChart.rows.length) {
                chartWarnings.push('年龄画像未返回分层数据' + attemptSuffix);
              }
              if (!consumerChart || !Array.isArray(consumerChart.rows) || !consumerChart.rows.length) {
                chartWarnings.push('消费能力画像未返回分层数据' + attemptSuffix);
              }
              if (lastPortraitError) {
                const message = lastPortraitError && lastPortraitError.message
                  ? lastPortraitError.message
                  : String(lastPortraitError);
                chartWarnings.push('画像重试末次请求失败：' + message);
              }
              const levelText = (consumerChart && Array.isArray(consumerChart.rows) ? consumerChart.rows : [])
                .map((row) => normalize(row && (row.optionName || row.name || row.label || row.optionValue)))
                .join('|');
              const missingLevels = ['l1', 'l2', 'l4', 'l5'].filter((level) => !levelText.includes(level));
              if (consumerChart && missingLevels.length) {
                chartWarnings.push('消费能力画像缺少' + missingLevels.join('、').toUpperCase() + '分层');
              }
              if (chartWarnings.length) warnings.push(item.name + '：' + chartWarnings.join('、'));
              output.push({
                role: item.key,
                crowd: compactCrowd(portrait && portrait.crowd, crowd),
                charts,
                warnings: chartWarnings,
                portraitAttempts,
              });
            } catch (error) {
              const message = error && error.message ? error.message : String(error);
              warnings.push(item.name + '：' + message);
              output.push({ role: item.key, crowd, charts: [], error: message });
            }
          }
          return {
            ok: true,
            output,
            selectedRoles: availableWanted.map((item) => item.key),
            missingRoles: wanted.filter((item) => !selectedByRole.has(item.key)).map((item) => item.key),
            pendingRoles: pendingCrowds.map((item) => item.key),
            warnings,
          };
        } catch (error) {
          return {
            ok: false,
            stage,
            message: error && error.message ? error.message : String(error),
          };
        }
      },
      args: [ensureResult && ensureResult.results || []],
    });
  } catch (error) {
    const failures = (ensureResult && ensureResult.results || []).filter((item) => !item.ok).map((item) => (
      item.name + '：' + (item.message || '创建失败')
    ));
    const message = error && error.message ? error.message : String(error);
    throw new Error(failures.concat(message).join('；'));
  }
  const scriptResult = results && results[0] && results[0].result;
  if (scriptResult && scriptResult.ok === false) {
    throw new Error('DMP ' + (scriptResult.stage || '画像取数') + '失败：' + (scriptResult.message || '未知错误。'));
  }
  if (!scriptResult) {
    throw new Error('DMP 页面脚本未返回结果，请确认达摩盘页面已登录并完成加载。');
  }
  const snapshotResults = scriptResult && scriptResult.output;
  if (!Array.isArray(snapshotResults) || !snapshotResults.length) throw new Error('DMP 未返回画像数据。');
  const roleLabels = {
    tt: '淘天内容人群资产',
    xhs: '小红书内容人群资产',
    store: '全店人群资产',
    xhsVisit: '小红书进店人群',
  };
  const snapshot = {
    schema: 2,
    savedAt: Date.now(),
    resultSignature: 'business-defense-auto',
    requestedTags: ['年龄', '消费能力等级'],
    results: snapshotResults,
    ensureResults: ensureResult && ensureResult.results || [],
  };
  const missingRoles = expectedRoles.filter((role) => (
    !Array.isArray(scriptResult.selectedRoles) || !scriptResult.selectedRoles.includes(role)
  ));
  const createFailures = (ensureResult && ensureResult.results || []).filter((item) => !item.ok);
  const missingPortraitRoles = snapshotResults.filter((item) => {
    const charts = Array.isArray(item && item.charts) ? item.charts : [];
    const hasRows = (pattern) => charts.some((chart) => (
      pattern.test(String(chart && chart.tagName || '')) &&
      Array.isArray(chart && chart.rows) && chart.rows.length
    ));
    return !hasRows(/年龄/) || !hasRows(/消费能力|购买力/);
  }).map((item) => roleLabels[item.role] || item.role);
  const pendingSizeRoleSet = new Set(
    Array.isArray(scriptResult.pendingRoles) ? scriptResult.pendingRoles : []
  );
  const coverageKeys = [
    'crowdNum', 'coverNum', 'coverage', 'crowdSize', 'size',
    'num', 'uv', 'count', 'population', 'optionNum',
  ];
  const hasUsableCoverageValue = (value) => {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (!text || /计算中|生成中|处理中|暂无|^[-–—]+$/.test(text)) return false;
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:万|亿)?$/.test(
      text.replace(/[,，\s]/g, '').replace(/[人个]$/, '')
    );
  };
  const resultHasSize = (item) => {
    const crowd = item && item.crowd || {};
    return coverageKeys.some((key) => hasUsableCoverageValue(crowd[key]));
  };
  const missingSizeRoleSet = new Set(pendingSizeRoleSet);
  snapshotResults.forEach((item) => {
    if (resultHasSize(item)) missingSizeRoleSet.delete(item && item.role);
    else missingSizeRoleSet.add(item && item.role);
  });
  const missingSizeRoles = Array.from(missingSizeRoleSet)
    .filter(Boolean)
    .map((role) => roleLabels[role] || role);
  const hasUsableResult = snapshotResults.some((item) => {
    const hasSize = resultHasSize(item);
    const hasPortrait = Array.isArray(item && item.charts) && item.charts.some((chart) => (
      Array.isArray(chart && chart.rows) && chart.rows.length
    ));
    return hasSize || hasPortrait;
  });
  if (!hasUsableResult || createFailures.length) {
    const details = createFailures.map((item) => item.name + '：' + (item.message || '读取失败'));
    if (!hasUsableResult) details.push('已有人群包的人数仍在计算，暂未返回可用数据');
    throw new Error(details.join('；'));
  }
  const warnings = Array.from(new Set([
    ...(Array.isArray(scriptResult.warnings) ? scriptResult.warnings : []),
    ...(missingPortraitRoles.length ? ['未读取完整年龄与消费能力画像：' + missingPortraitRoles.join('、')] : []),
    ...(missingSizeRoles.length ? ['人群规模仍在计算：' + missingSizeRoles.join('、')] : []),
  ]));
  snapshot.warnings = warnings;
  snapshot.missingCrowds = missingRoles.map((role) => roleLabels[role] || role);
  snapshot.partial = Boolean(missingRoles.length || warnings.length);
  await chrome.storage.local.set({ dmpPortraitSnapshotV1: snapshot });
  return {
    ok: true,
    source: 'DMP已有人群包',
    count: snapshotResults.length,
    partial: snapshot.partial,
    missingCrowds: snapshot.missingCrowds,
    warnings,
    created: [],
    visualCreated: [],
    snapshot,
  };
}

async function runBusinessDefenseAutoCollect(options) {
  const selectedPlatforms = new Set(normalizePlatformTaskIds(options && options.platforms));
  const steps = [
    { platform: 'guanghe', name: '光合内容指标', run: runBusinessDefenseGuanghe, startDelayMs: 1200 },
    { platform: 'sycm', name: '生意参谋流量指标', run: runBusinessDefenseSycm, startDelayMs: 0 },
    { platform: 'wxt', name: '万相台内容投放', run: runBusinessDefenseWxt, startDelayMs: 2400 },
    {
      platform: 'dmp',
      name: 'DMP人群资产画像',
      run: () => runBusinessDefenseDmp({ includeXiaohongshu: false }),
      startDelayMs: 3600,
    },
  ];
  const resultsByName = new Map();
  steps.filter((step) => !selectedPlatforms.has(step.platform)).forEach((step) => {
    resultsByName.set(step.name, {
      name: step.name,
      ok: true,
      skipped: true,
      message: '本次任务未选择该平台。',
    });
  });
  const activeSteps = new Set(steps
    .filter((step) => selectedPlatforms.has(step.platform))
    .map((step) => step.name));
  const startedAt = Date.now();
  let statusWriteQueue = Promise.resolve();

  const orderedResults = () => steps
    .map((step) => resultsByName.get(step.name))
    .filter(Boolean);
  const persistStatus = (running, extra) => {
    const fields = Object.assign({}, extra || {});
    statusWriteQueue = statusWriteQueue.catch(() => {}).then(() => {
      const results = orderedResults();
      const activeNames = steps
        .map((step) => step.name)
        .filter((name) => activeSteps.has(name));
      return chrome.storage.local.set({
        [BUSINESS_DEFENSE_AUTO_STATUS_KEY]: Object.assign({
          running,
          startedAt,
          updatedAt: Date.now(),
          total: steps.length,
          stepIndex: results.length,
          currentStep: running ? activeNames.join('、') : '',
          activeSteps: activeNames,
          platforms: Array.from(selectedPlatforms),
          results,
        }, fields),
      });
    });
    return statusWriteQueue;
  };

  await chrome.storage.local.set({
    businessDefenseLastAutoCollectAt: startedAt,
    [BUSINESS_DEFENSE_AUTO_STATUS_KEY]: {
      running: true,
      startedAt,
      updatedAt: startedAt,
      total: steps.length,
      stepIndex: orderedResults().length,
      currentStep: activeSteps.size ? Array.from(activeSteps).join('、') : '',
      activeSteps: Array.from(activeSteps),
      platforms: Array.from(selectedPlatforms),
      results: orderedResults(),
    },
  });

  const executeStep = async (step) => {
    let result;
    try {
      if (step.startDelayMs) await waitMilliseconds(step.startDelayMs);
      const execution = await runPlatformStepWithRetry(step);
      const detail = execution.detail;
      const messages = [];
      if (execution.attempts > 1) messages.push('第 ' + execution.attempts + ' 次尝试成功');
      if (detail && detail.source) messages.push('来源：' + detail.source);
      if (detail && Number.isFinite(Number(detail.count))) {
        messages.push('已读取：' + Number(detail.count) + '个人群');
      }
      if (detail && Array.isArray(detail.capturedMetrics) && detail.capturedMetrics.length) {
        messages.push('已取：' + detail.capturedMetrics.join('、'));
      }
      if (detail && Array.isArray(detail.missingMetrics) && detail.missingMetrics.length) {
        messages.push('待补：' + detail.missingMetrics.join('、'));
      }
      if (detail && Array.isArray(detail.missingCrowds) && detail.missingCrowds.length) {
        messages.push('待创建：' + detail.missingCrowds.join('、'));
      }
      if (detail && Array.isArray(detail.warnings) && detail.warnings.length) {
        messages.push(detail.warnings.join('；'));
      }
      if (detail && Array.isArray(detail.created) && detail.created.length) {
        messages.push('已创建：' + detail.created.join('、'));
      }
      if (detail && Array.isArray(detail.visualCreated) && detail.visualCreated.length) {
        messages.push('页面圈人创建：' + detail.visualCreated.join('、'));
      }
      if (detail && detail.visualStoreWarning) {
        messages.push('页面圈人回退：' + detail.visualStoreWarning);
      }
      result = {
        name: step.name,
        ok: true,
        partial: Boolean(detail && detail.partial),
        message: messages.join('；'),
      };
    } catch (error) {
      result = {
        name: step.name,
        ok: false,
        message: error && error.message ? error.message : String(error),
      };
    }
    resultsByName.set(step.name, result);
    activeSteps.delete(step.name);
    await persistStatus(true);
    return result;
  };

  await Promise.all(steps
    .filter((step) => selectedPlatforms.has(step.platform))
    .map((step) => executeStep(step)));
  const finishedAt = Date.now();
  const results = orderedResults();
  const partial = results.some((item) => (
    item && !item.skipped && (item.ok === false || item.partial)
  ));
  await persistStatus(false, { updatedAt: finishedAt, finishedAt, partial });
  return { ok: true, partial, platforms: Array.from(selectedPlatforms), results };
}

function contentDiagnosisResultMessage(detail) {
  const messages = [];
  if (detail && detail.source) messages.push('来源：' + detail.source);
  if (detail && detail.startTime && detail.endTime) {
    messages.push('范围：' + detail.startTime + ' 至 ' + detail.endTime);
  }
  if (detail && Number.isFinite(Number(detail.rowCount))) {
    messages.push('明细：' + Number(detail.rowCount) + ' 行');
  }
  if (detail && Number.isFinite(Number(detail.targetCount))) {
    messages.push('光合匹配：' + Number(detail.matchedCount || 0) + '/' + Number(detail.targetCount));
  }
  if (detail && Number.isFinite(Number(detail.count))) {
    messages.push('人群：' + Number(detail.count) + '/4');
  }
  if (detail && Array.isArray(detail.warnings) && detail.warnings.length) {
    messages.push('部分画像未返回');
  }
  if (detail && detail.warning) messages.push(String(detail.warning));
  return messages.join('；');
}

async function runContentDiagnosisReport(options) {
  const selectedPlatforms = new Set(normalizePlatformTaskIds(options && options.platforms));
  const runId = 'taobao-report-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 10);
  const startedAt = Date.now();
  const report = {
    schema: 2,
    runId,
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
    sycm: null,
    guanghe: null,
    wxtMarketing: null,
    wxtShortVideo: null,
    dmp: null,
    results: [],
    platforms: Array.from(selectedPlatforms),
  };
  const resultsByKey = new Map();
  let wxtTabId = null;
  const steps = [
    {
      key: 'sycm',
      platform: 'sycm',
      name: '生意参谋流量诊断',
      startDelayMs: 0,
      run: async () => {
        const detail = await runBusinessDefenseSycm();
        report.sycm = detail.snapshot;
        return detail;
      },
    },
    {
      key: 'guanghe',
      platform: 'guanghe',
      name: '光合渠道与资产诊断',
      startDelayMs: 1200,
      run: async () => {
        const detail = await runBusinessDefenseGuanghe({ metricsOnly: false });
        const snapshot = detail && detail.snapshot;
        if (!snapshot || snapshot.schema !== 9 || !Array.isArray(snapshot.rows)) {
          throw new Error('光合未保存完整渠道与资产视角快照。');
        }
        report.guanghe = Object.assign({}, snapshot, {
          collectionSource: detail.source,
        });
        return detail;
      },
    },
    {
      key: 'wxtMarketing',
      platform: 'wxt',
      name: '万相台营销场景报告',
      startDelayMs: 2400,
      run: async () => {
        wxtTabId = await prepareContentDiagnosisWxtTab('marketing');
        const detail = await runContentDiagnosisWxtSection(wxtTabId, runId, 'marketing');
        report.wxtMarketing = detail;
        return detail;
      },
    },
    {
      key: 'wxtShortVideo',
      platform: 'wxt',
      name: '万相台短视频诊断',
      run: async () => {
        wxtTabId = await prepareContentDiagnosisWxtTab('shortVideo');
        const detail = await runContentDiagnosisWxtSection(wxtTabId, runId, 'shortVideo');
        report.wxtShortVideo = detail;
        return detail;
      },
    },
    {
      key: 'dmp',
      platform: 'dmp',
      name: '内容人群画像诊断',
      startDelayMs: 3600,
      run: async () => {
        const detail = await runBusinessDefenseDmp();
        if (!detail || !detail.snapshot || !Array.isArray(detail.snapshot.results)) {
          throw new Error('DMP 未保存本次人群画像快照。');
        }
        report.dmp = detail.snapshot;
        return detail;
      },
    },
  ];

  steps.filter((step) => !selectedPlatforms.has(step.platform)).forEach((step) => {
    resultsByKey.set(step.key, {
      key: step.key,
      name: step.name,
      ok: true,
      skipped: true,
      message: '本次任务未选择该平台。',
    });
  });
  const activeKeys = new Set();
  if (selectedPlatforms.has('sycm')) activeKeys.add('sycm');
  if (selectedPlatforms.has('guanghe')) activeKeys.add('guanghe');
  if (selectedPlatforms.has('wxt')) activeKeys.add('wxtMarketing');
  if (selectedPlatforms.has('dmp')) activeKeys.add('dmp');
  let reportWriteQueue = Promise.resolve();
  const orderedResults = () => steps
    .map((step) => resultsByKey.get(step.key))
    .filter(Boolean);
  const persistReportState = (running, extra) => {
    const fields = Object.assign({}, extra || {});
    reportWriteQueue = reportWriteQueue.catch(() => {}).then(() => {
      const results = orderedResults();
      const activeNames = steps
        .filter((step) => activeKeys.has(step.key))
        .map((step) => step.name);
      const updatedAt = Number(fields.updatedAt) || Date.now();
      report.results = results;
      report.updatedAt = updatedAt;
      if (fields.finishedAt) report.finishedAt = fields.finishedAt;
      const reportSnapshot = Object.assign({}, report, { results: results.slice() });
      return chrome.storage.local.set({
        [CONTENT_DIAGNOSIS_REPORT_KEY]: reportSnapshot,
        [CONTENT_DIAGNOSIS_STATUS_KEY]: Object.assign({
          running,
          runId,
          startedAt,
          updatedAt,
          total: steps.length,
          stepIndex: results.length,
          currentStep: running ? activeNames.join('、') : '',
          activeSteps: activeNames,
          platforms: Array.from(selectedPlatforms),
          results: results.slice(),
        }, fields),
      });
    });
    return reportWriteQueue;
  };

  await chrome.storage.local.remove(CONTENT_DIAGNOSIS_WXT_KEY);
  await chrome.storage.local.set({
    [CONTENT_DIAGNOSIS_REPORT_KEY]: report,
    [CONTENT_DIAGNOSIS_STATUS_KEY]: {
      running: true,
      runId,
      startedAt,
      updatedAt: startedAt,
      total: steps.length,
      stepIndex: orderedResults().length,
      currentStep: steps.filter((step) => activeKeys.has(step.key)).map((step) => step.name).join('、'),
      activeSteps: steps.filter((step) => activeKeys.has(step.key)).map((step) => step.name),
      platforms: Array.from(selectedPlatforms),
      results: orderedResults(),
    },
  });

  const executeStep = async (step) => {
    let result;
    try {
      if (step.startDelayMs) await waitMilliseconds(step.startDelayMs);
      const execution = await runPlatformStepWithRetry(step);
      const detail = execution.detail;
      result = {
        key: step.key,
        name: step.name,
        ok: true,
        partial: Boolean(detail && detail.partial),
        message: (execution.attempts > 1 ? '第 ' + execution.attempts + ' 次尝试成功；' : '') +
          contentDiagnosisResultMessage(detail),
      };
    } catch (error) {
      result = {
        key: step.key,
        name: step.name,
        ok: false,
        code: error && error.code || '',
        message: error && error.message ? error.message : String(error),
      };
    }
    resultsByKey.set(step.key, result);
    activeKeys.delete(step.key);
    await persistReportState(true);
    return result;
  };

  const wxtPipeline = async () => {
    const marketingResult = await executeStep(steps.find((step) => step.key === 'wxtMarketing'));
    if (marketingResult && /^WXT_LOGIN_GATE_/.test(String(marketingResult.code || ''))) {
      const shortVideoStep = steps.find((step) => step.key === 'wxtShortVideo');
      resultsByKey.set(shortVideoStep.key, {
        key: shortVideoStep.key,
        name: shortVideoStep.name,
        ok: false,
        code: marketingResult.code,
        message: '万相台共同登录入口未完成，已跳过重复等待：' + marketingResult.message,
      });
      await persistReportState(true);
      return;
    }
    activeKeys.add('wxtShortVideo');
    await persistReportState(true);
    const shortVideoStep = steps.find((step) => step.key === 'wxtShortVideo');
    await executeStep(Object.assign({}, shortVideoStep, { startDelayMs: 0 }));
  };

  const tasks = [];
  if (selectedPlatforms.has('sycm')) tasks.push(executeStep(steps.find((step) => step.key === 'sycm')));
  if (selectedPlatforms.has('guanghe')) tasks.push(executeStep(steps.find((step) => step.key === 'guanghe')));
  if (selectedPlatforms.has('dmp')) tasks.push(executeStep(steps.find((step) => step.key === 'dmp')));
  if (selectedPlatforms.has('wxt')) tasks.push(wxtPipeline());
  await Promise.all(tasks);

  const finishedAt = Date.now();
  const results = orderedResults();
  const selectedResults = results.filter((item) => !item.skipped);
  const successful = selectedResults.filter((item) => item.ok).length;
  const partial = selectedResults.some((item) => item.ok === false || item.partial);
  report.partial = partial;
  await persistReportState(false, { updatedAt: finishedAt, finishedAt, partial });
  return {
    ok: successful > 0,
    partial,
    runId,
    platforms: Array.from(selectedPlatforms),
    results,
  };
}

function batchText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, Number(maxLength) || 160);
}

function normalizeBatchAccountPlatform(value) {
  return value === 'xiaohongshu' ? 'xiaohongshu' : 'taobao';
}

function sanitizeBatchAccount(value, index) {
  const source = value && typeof value === 'object' ? value : {};
  const username = batchText(source.username, 240);
  const password = String(source.password == null ? '' : source.password).slice(0, 360);
  if (!username || !password) throw new Error('\u7b2c ' + (index + 1) + ' \u4e2a\u8d26\u53f7\u7f3a\u5c11\u767b\u5f55\u8d26\u53f7\u6216\u5bc6\u7801。');
  return {
    id: batchText(source.id, 80) || 'account-' + (index + 1),
    name: batchText(source.name, 100) || username,
    platform: normalizeBatchAccountPlatform(source.platform),
    storeId: batchText(source.storeId, 80),
    storeName: batchText(source.storeName, 120) || batchText(source.name, 100) || username,
    username,
    password,
    roleKeyword: batchText(source.roleKeyword, 80) || '\u54c1\u724c',
    accountGroupId: batchText(source.accountGroupId, 80),
    accountGroupName: batchText(source.accountGroupName, 100),
    storeGroupId: batchText(source.storeGroupId, 80),
    storeGroupName: batchText(source.storeGroupName, 100),
  };
}

function maskedAccountName(username) {
  const text = String(username || '');
  if (text.length <= 2) return text ? text[0] + '*' : '';
  return text.slice(0, 2) + '*'.repeat(Math.min(5, text.length - 2)) + text.slice(-1);
}

function safeBatchAccount(account) {
  return {
    id: account.id,
    name: account.name,
    platform: normalizeBatchAccountPlatform(account.platform),
    storeId: account.storeId,
    storeName: account.storeName,
    usernameMasked: maskedAccountName(account.username),
    roleKeyword: account.roleKeyword,
    accountGroupId: account.accountGroupId,
    accountGroupName: account.accountGroupName,
    storeGroupId: account.storeGroupId,
    storeGroupName: account.storeGroupName,
  };
}

function batchError(code, message, extra) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra || {});
  return error;
}

function sanitizeNotificationConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const webhook = batchText(source.webhook, 900);
  const secret = batchText(source.secret, 300);
  if (!webhook) return { webhook: '', secret: '' };
  let url;
  try {
    url = new URL(webhook);
  } catch (error) {
    throw new Error('\u9489\u9489\u673a\u5668\u4eba Webhook \u5730\u5740\u65e0\u6548。');
  }
  if (url.protocol !== 'https:' || url.hostname !== 'oapi.dingtalk.com' ||
      !url.pathname.startsWith('/robot/send')) {
    throw new Error('\u4ec5\u652f\u6301 oapi.dingtalk.com \u7684\u81ea\u5b9a\u4e49\u673a\u5668\u4eba Webhook。');
  }
  return { webhook: url.toString(), secret };
}

function sanitizeAccountSessionVault(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const cleanGroups = (items, limit) => {
    const ids = new Set();
    return (Array.isArray(items) ? items : []).slice(0, limit).map((value) => {
      const item = value && typeof value === 'object' ? value : {};
      const id = batchText(item.id, 100);
      const name = batchText(item.name, 100);
      if (!id || !name || ids.has(id)) return null;
      ids.add(id);
      return { id, name };
    }).filter(Boolean);
  };
  const accountGroups = cleanGroups(source.accountGroups, 300);
  const storeGroups = cleanGroups(source.storeGroups, 300);
  const accountGroupIds = new Set(accountGroups.map((item) => item.id));
  const storeGroupIds = new Set(storeGroups.map((item) => item.id));
  const storeIds = new Set();
  const stores = (Array.isArray(source.stores) ? source.stores : []).slice(0, 1000).map((value) => {
    const item = value && typeof value === 'object' ? value : {};
    const id = batchText(item.id, 100);
    const name = batchText(item.name, 120);
    if (!id || !name || storeIds.has(id)) return null;
    storeIds.add(id);
    return {
      id,
      name,
      groupId: storeGroupIds.has(item.groupId) ? item.groupId : '',
    };
  }).filter(Boolean);
  const accountIds = new Set();
  const accounts = (Array.isArray(source.accounts) ? source.accounts : []).slice(0, 500).map((value) => {
    const item = value && typeof value === 'object' ? value : {};
    const id = batchText(item.id, 100);
    const storeId = batchText(item.storeId, 100);
    const username = batchText(item.username, 240);
    const password = String(item.password == null ? '' : item.password).slice(0, 360);
    const platform = normalizeBatchAccountPlatform(item.platform);
    if (!id || accountIds.has(id) || !storeIds.has(storeId) || !username || !password) return null;
    accountIds.add(id);
    return {
      id,
      name: batchText(item.name, 100) || username,
      platform,
      storeId,
      username,
      password,
      accountGroupId: accountGroupIds.has(item.accountGroupId) ? item.accountGroupId : '',
      roleKeyword: platform === 'taobao' ? (batchText(item.roleKeyword, 80) || '\u54c1\u724c') : '',
      enabled: item.enabled !== false,
    };
  }).filter(Boolean);
  return {
    schema: 3,
    accountGroups,
    storeGroups,
    stores,
    accounts,
    notification: {
      webhook: batchText(source.notification && source.notification.webhook, 900),
      secret: batchText(source.notification && source.notification.secret, 300),
    },
    unlockedAt: Date.now(),
  };
}

function sanitizeAccountManagementSession(value) {
  const source = value && typeof value === 'object' ? value : {};
  const masterPassword = String(source.masterPassword == null ? '' : source.masterPassword).slice(0, 512);
  if (masterPassword.length < 8) throw new Error('账号库管理会话缺少有效主密码。');
  return {
    schema: 2,
    vault: sanitizeAccountSessionVault(source.vault),
    masterPassword,
    unlockedAt: Date.now(),
  };
}

function accountVaultFromSession(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.vault && typeof value.vault === 'object') return value.vault;
  return Array.isArray(value.accounts) ? value : null;
}

function summarizeAccountSession(session) {
  const vault = accountVaultFromSession(session);
  if (!vault || typeof vault !== 'object') {
    return { unlocked: false, totalEnabledAccounts: 0, storeGroups: [], stores: [] };
  }
  const accountCounts = new Map();
  (Array.isArray(vault.accounts) ? vault.accounts : []).forEach((account) => {
    if (!account || account.enabled === false || normalizeBatchAccountPlatform(account.platform) !== 'taobao') return;
    accountCounts.set(account.storeId, (accountCounts.get(account.storeId) || 0) + 1);
  });
  const stores = (Array.isArray(vault.stores) ? vault.stores : []).map((store) => ({
    id: store.id,
    name: store.name,
    groupId: store.groupId || '',
    enabledAccountCount: accountCounts.get(store.id) || 0,
  }));
  const groupCounts = new Map();
  stores.forEach((store) => {
    groupCounts.set(store.groupId || '', (groupCounts.get(store.groupId || '') || 0) + store.enabledAccountCount);
  });
  const storesById = new Map(stores.map((store) => [store.id, store]));
  const accounts = (Array.isArray(vault.accounts) ? vault.accounts : []).filter((account) => (
    account && account.enabled !== false && normalizeBatchAccountPlatform(account.platform) === 'taobao' &&
      storesById.has(account.storeId)
  )).map((account) => {
    const store = storesById.get(account.storeId);
    return {
      id: account.id,
      storeId: store.id,
      storeName: store.name,
      groupId: store.groupId || '',
      usernameMasked: maskedAccountName(account.username),
      roleKeyword: batchText(account.roleKeyword, 80) || '\u54c1\u724c',
    };
  });
  return {
    schema: 2,
    unlocked: true,
    unlockedAt: Number(session && session.unlockedAt) || Number(vault.unlockedAt) || Date.now(),
    totalEnabledAccounts: stores.reduce((total, store) => total + store.enabledAccountCount, 0),
    storeGroups: (Array.isArray(vault.storeGroups) ? vault.storeGroups : []).map((group) => ({
      id: group.id,
      name: group.name,
      enabledAccountCount: groupCounts.get(group.id) || 0,
    })),
    ungroupedAccountCount: groupCounts.get('') || 0,
    stores,
    accounts,
  };
}

function accountManagementSession(session) {
  const vault = accountVaultFromSession(session);
  const masterPassword = String(session && session.masterPassword || '');
  if (!vault || masterPassword.length < 8) return null;
  return {
    vault,
    masterPassword,
    unlockedAt: Number(session.unlockedAt) || Date.now(),
  };
}

function accountSessionBatchAccount(vault, account) {
  const store = vault.stores.find((item) => item.id === account.storeId);
  const storeGroup = vault.storeGroups.find((item) => item.id === (store && store.groupId));
  const accountGroup = vault.accountGroups.find((item) => item.id === account.accountGroupId);
  return {
    id: account.id,
    name: account.name,
    platform: normalizeBatchAccountPlatform(account.platform),
    storeId: store && store.id || account.storeId,
    storeName: store && store.name || account.name,
    username: account.username,
    password: account.password,
    roleKeyword: account.roleKeyword,
    accountGroupId: account.accountGroupId,
    accountGroupName: accountGroup && accountGroup.name || '\u672a\u5206\u7ec4',
    storeGroupId: store && store.groupId || '',
    storeGroupName: storeGroup && storeGroup.name || '\u672a\u5206\u7ec4',
  };
}

function prepareAccountBatchFromSession(vault, request, previousStatus) {
  if (!vault || typeof vault !== 'object') throw new Error('\u8d26\u53f7\u5e93\u5c1a\u672a\u5728\u672c\u6b21 Chrome \u4f1a\u8bdd\u89e3\u9501。');
  const source = request && typeof request === 'object' ? request : {};
  const taskType = 'report';
  const resume = source.resume === true;
  let accounts = [];
  let selection = {};
  let startIndex = 0;
  let batchId = '';
  let startedAt = 0;
  let platforms = [];

  if (resume) {
    const status = previousStatus && typeof previousStatus === 'object' ? previousStatus : {};
    if (!status.paused || status.taskType !== taskType) throw new Error('\u5f53\u524d\u6ca1\u6709\u53ef\u7ee7\u7eed\u7684\u672c\u7c7b\u4efb\u52a1。');
    const statusAccountIds = Array.isArray(status.accountIds) ? status.accountIds : [];
    if (statusAccountIds.length > 100) throw new Error('暂停任务的账号数量超过 100 个，无法继续。');
    const byId = new Map(vault.accounts.map((account) => [account.id, account]));
    const storesById = new Map(vault.stores.map((store) => [store.id, store]));
    const frozenSelection = status.selection && typeof status.selection === 'object' ? status.selection : {};
    const frozenSelectionType = frozenSelection.type === 'store' ? 'store' : 'storeGroup';
    const frozenSelectionId = batchText(frozenSelection.id, 100);
    const matchesFrozenSelection = (account) => {
      const store = account && storesById.get(account.storeId);
      if (!store) return false;
      if (!frozenSelectionId || frozenSelectionId === '__all__') return true;
      if (frozenSelectionType === 'store') return store.id === frozenSelectionId;
      return frozenSelectionId === '__ungrouped__'
        ? !store.groupId
        : store.groupId === frozenSelectionId;
    };
    accounts = statusAccountIds.map((id) => byId.get(id));
    if (!accounts.length || accounts.some((account) => (
      !account || account.enabled === false || normalizeBatchAccountPlatform(account.platform) !== 'taobao' ||
        !matchesFrozenSelection(account)
    ))) {
      throw new Error('暂停后账号库发生变化，原任务账号已缺失、被停用或移出所选分组。');
    }
    selection = status.selection || {};
    platforms = normalizePlatformTaskIds(status.platforms);
    startIndex = Number(status.resumeIndex) || 0;
    batchId = batchText(status.batchId, 100);
    startedAt = Number(status.startedAt) || 0;
  } else {
    const rawSelection = source.selection && typeof source.selection === 'object' ? source.selection : {};
    const id = batchText(rawSelection.id, 100);
    const selectedGroup = vault.storeGroups.find((group) => group.id === id);
    if (id !== '__ungrouped__' && !selectedGroup) {
      throw new Error('\u672a\u627e\u5230\u9009\u4e2d\u7684\u5e97\u94fa\u5206\u7ec4。');
    }
    const name = id === '__ungrouped__' ? '\u672a\u5206\u7ec4\u5e97\u94fa' : selectedGroup.name;
    const storeIds = new Set(vault.stores.filter((store) => (
      id === '__ungrouped__' ? !store.groupId : store.groupId === id
    )).map((store) => store.id));
    const eligibleAccounts = vault.accounts.filter((account) => (
      account.enabled !== false && normalizeBatchAccountPlatform(account.platform) === 'taobao' &&
        storeIds.has(account.storeId)
    ));
    const requestedIds = Array.from(new Set((Array.isArray(rawSelection.accountIds)
      ? rawSelection.accountIds
      : []).map((value) => batchText(value, 100)).filter(Boolean)));
    if (!requestedIds.length) throw new Error('\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u4e2a\u7ec4\u5185\u8d26\u53f7。');
    if (requestedIds.length > 100) throw new Error('\u6bcf\u6b21\u6700\u591a\u9009\u62e9 100 \u4e2a\u8d26\u53f7。');
    const eligibleById = new Map(eligibleAccounts.map((account) => [account.id, account]));
    accounts = requestedIds.map((accountId) => eligibleById.get(accountId));
    if (accounts.some((account) => !account)) {
      throw new Error('\u6240\u9009\u8d26\u53f7\u5df2\u5931\u6548、\u88ab\u505c\u7528\u6216\u4e0d\u5c5e\u4e8e\u5f53\u524d\u5e97\u94fa\u5206\u7ec4。');
    }
    selection = {
      type: 'storeGroup',
      id,
      name,
      groupId: id,
      groupName: name,
      accountIds: requestedIds,
    };
    platforms = normalizePlatformTaskIds(source.platforms);
  }

  if (!accounts.length) throw new Error('当前选择没有可执行的淘宝账号。');
  return {
    accounts: accounts.map((account) => accountSessionBatchAccount(vault, account)),
    notification: vault.notification || {},
    selection,
    resume,
    startIndex,
    batchId,
    startedAt,
    taskType,
    platforms,
  };
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function signedDingTalkWebhook(config) {
  const url = new URL(config.webhook);
  if (!config.secret) return url.toString();
  const timestamp = Date.now();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(config.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + '\n' + config.secret));
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', bytesToBase64(new Uint8Array(signature)));
  return url.toString();
}

async function sendDingTalkNotification(config, text) {
  const normalized = sanitizeNotificationConfig(config);
  if (!normalized.webhook) return { ok: false, skipped: true, message: '\u672a\u914d\u7f6e\u9489\u9489\u673a\u5668\u4eba。' };
  const response = await fetch(await signedDingTalkWebhook(normalized), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: String(text || '').slice(0, 1800) } }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || Number(body.errcode || 0) !== 0) {
    throw new Error('\u9489\u9489\u63d0\u9192\u53d1\u9001\u5931\u8d25：' + (body.errmsg || 'HTTP ' + response.status));
  }
  return { ok: true };
}

async function ensureXingheContentScript(tabId) {
  try {
    await injectScripts(tabId, [{ files: ['xinghe-content-script.js'], allFrames: true }]);
  } catch (error) {
    if (!/Cannot access|No tab|closed/i.test(String(error && error.message || error))) throw error;
  }
}

async function readXingheState(tabId) {
  await ensureXingheContentScript(tabId);
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  const targets = Array.isArray(frames) && frames.length ? frames : [{ frameId: 0 }];
  const observations = (await Promise.all(targets.map(async (frame) => {
    try {
      const response = await chrome.tabs.sendMessage(
        tabId,
        { type: 'XINGHE_GET_STATE' },
        { frameId: Number(frame.frameId) || 0 }
      );
      if (!response || response.ok === false || !response.state) return null;
      return Object.assign({}, response.state, {
        frameId: Number(frame.frameId) || 0,
      });
    } catch (error) {
      return null;
    }
  }))).filter(Boolean);
  if (!observations.length) throw new Error('\u661f\u6cb3\u9875\u9762\u672a\u8fd4\u56de\u767b\u5f55\u72b6\u6001。');
  const priority = (state) => {
    const topFrame = state.frameId === 0;
    if (state.kind === 'verification') return topFrame ? 220 : 210;
    if (state.kind === 'loginError') return topFrame ? 200 : 168;
    // The top page is authoritative once Taobao SSO reaches an authenticated terminal state.
    // A stale login iframe must not turn Xinghe-only access limits into a failed Taobao login.
    if (state.kind === 'noPermission') return topFrame ? 190 : 160;
    if (state.kind === 'rolePicker') {
      return topFrame && Number(state.roleCount) > 0 ? 180 : (topFrame ? 155 : 150);
    }
    if (state.kind === 'loggedIn') return topFrame ? 170 : 140;
    if (state.kind === 'login') return 165;
    if (state.kind === 'sessionPending') return state.frameId === 0 ? 30 : 20;
    return 0;
  };
  observations.sort((left, right) => priority(right) - priority(left));
  return observations[0];
}

async function waitForXingheState(tabId, predicate, timeoutMs) {
  const deadline = Date.now() + (Number(timeoutMs) || 90000);
  let lastState = null;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        lastState = await readXingheState(tabId);
        if (!predicate || predicate(lastState)) return lastState;
      }
    } catch (error) {
      lastError = error;
    }
    await waitMilliseconds(800);
  }
  if (lastError && !lastState) throw lastError;
  return lastState || { kind: 'loading', message: '\u661f\u6cb3\u9875\u9762\u52a0\u8f7d\u8d85\u65f6。' };
}

async function prepareXingheTab() {
  const tabId = await openOrReuseTab(
    BUSINESS_DEFENSE_XINGHE_URL,
    ['*://adstar.alimama.com/*'],
    { navigate: false }
  );
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !String(tab.url).startsWith('https://adstar.alimama.com/')) {
    await chrome.tabs.update(tabId, { url: BUSINESS_DEFENSE_XINGHE_URL, active: false });
  }
  await waitTabComplete(tabId, 45000);
  await ensureXingheContentScript(tabId);
  return tabId;
}

async function resolveXinghePendingState(tabId, state, timeoutMs) {
  if (!state || state.kind !== 'sessionPending') return state;
  return waitForXingheState(
    tabId,
    (item) => item && !['loading', 'sessionPending'].includes(item.kind),
    Number(timeoutMs) || 15000
  );
}

async function logoutXinghe(tabId) {
  let lastState = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await ensureXingheContentScript(tabId);
      const response = await chrome.tabs.sendMessage(
        tabId,
        { type: 'XINGHE_LOGOUT' },
        { frameId: 0 }
      );
      if (!response || response.ok === false) {
        throw new Error(response && response.message || '\u661f\u6cb3\u9000\u51fa\u6309\u94ae\u672a\u54cd\u5e94。');
      }
    } catch (error) {
      await chrome.tabs.update(tabId, { url: BUSINESS_DEFENSE_XINGHE_LOGOUT_URL, active: false });
    }
    await waitMilliseconds(1000);
    try { await waitTabComplete(tabId, 30000); } catch (error) {}
    lastState = await waitForXingheState(
      tabId,
      (item) => item && item.kind !== 'loading',
      20000
    );
    lastState = await resolveXinghePendingState(tabId, lastState, 15000);
    if (lastState && lastState.kind === 'login') return;
    if (lastState && lastState.kind === 'verification') {
      throw batchError('VERIFICATION_REQUIRED', lastState.message || '\u661f\u6cb3\u9000\u51fa\u65f6\u9700\u8981\u4eba\u5de5\u9a8c\u8bc1。', { tabId });
    }
    if (lastState && lastState.kind === 'sessionPending') break;
    // 退出接口可能先落到“确认登录/使用其他账号登录”页；下一轮只点击该入口。
  }
  throw new Error('\u661f\u6cb3\u9000\u51fa\u540e\u672a\u56de\u5230\u5bc6\u7801\u767b\u5f55\u9875' +
    (lastState && lastState.kind ? '\uff08\u5f53\u524d\u72b6\u6001：' + lastState.kind + '\uff09' : '') + '。');
}

function checkXingheBlockingState(state, tabId) {
  if (!state) return;
  if (state.kind === 'verification') {
    throw batchError('VERIFICATION_REQUIRED', state.message || '\u661f\u6cb3\u9700\u8981\u4eba\u5de5\u9a8c\u8bc1。', { tabId });
  }
  if (state.kind === 'loginError') {
    throw batchError('LOGIN_FAILED', state.message || '\u661f\u6cb3\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef。', { tabId });
  }
}

async function loginXingheAccount(account, options) {
  const tabId = await prepareXingheTab();
  const resume = Boolean(options && options.resume);
  let state = await waitForXingheState(tabId, (item) => item && item.kind !== 'loading', 45000);
  state = await resolveXinghePendingState(tabId, state, 20000);
  if (!resume && (!state || state.kind !== 'login')) {
    await logoutXinghe(tabId);
    // Account switches made back-to-back are more likely to trigger platform risk controls.
    await waitMilliseconds(1800);
    state = await waitForXingheState(tabId, (item) => item && item.kind !== 'loading', 45000);
  }
  checkXingheBlockingState(state, tabId);

  if (resume && (state.kind === 'loggedIn' || state.kind === 'noPermission')) {
    return { tabId, state: state.kind, noPermission: state.kind === 'noPermission' };
  }

  if (state.kind === 'rolePicker') {
    const selection = await sendTabMessageWithRetry(tabId, {
      type: 'XINGHE_SELECT_ROLE',
      roleKeyword: account.roleKeyword,
    }, 15000, { frameId: Number(state.frameId) || 0 });
    if (!selection || selection.ok === false) {
      throw batchError('ROLE_NOT_FOUND', selection && selection.message || '\u661f\u6cb3\u767b\u5f55\u8eab\u4efd\u9009\u62e9\u5931\u8d25。');
    }
  } else if (state.kind === 'login') {
    const submission = await sendTabMessageWithRetry(tabId, {
      type: 'XINGHE_FILL_LOGIN',
      username: account.username,
      password: account.password,
    }, 15000, { frameId: Number(state.frameId) || 0 });
    if (!submission || submission.ok === false) {
      throw batchError('LOGIN_FORM_FAILED', submission && submission.message || '\u661f\u6cb3\u5bc6\u7801\u767b\u5f55\u8868\u5355\u63d0\u4ea4\u5931\u8d25。');
    }
  }

  const deadline = Date.now() + 120000;
  let sessionPendingSince = null;
  let loginPageSince = null;
  while (Date.now() < deadline) {
    state = await waitForXingheState(tabId, (item) => item && item.kind !== 'loading', 15000);
    checkXingheBlockingState(state, tabId);
    if (state.kind === 'rolePicker') {
      loginPageSince = null;
      const selection = await sendTabMessageWithRetry(tabId, {
        type: 'XINGHE_SELECT_ROLE',
        roleKeyword: account.roleKeyword,
      }, 15000, { frameId: Number(state.frameId) || 0 });
      if (!selection || selection.ok === false) {
        throw batchError('ROLE_NOT_FOUND', selection && selection.message || '\u661f\u6cb3\u767b\u5f55\u8eab\u4efd\u9009\u62e9\u5931\u8d25。');
      }
      await waitMilliseconds(700);
      continue;
    }
    if (state.kind === 'loggedIn' || state.kind === 'noPermission') {
      return { tabId, state: state.kind, noPermission: state.kind === 'noPermission' };
    }
    if (state.kind === 'sessionPending') {
      loginPageSince = null;
      if (!sessionPendingSince) sessionPendingSince = Date.now();
      if (Date.now() - sessionPendingSince >= 7000) {
        return { tabId, state: 'loggedIn', noPermission: false };
      }
      await waitMilliseconds(800);
      continue;
    }
    sessionPendingSince = null;
    if (state.kind === 'login') {
      if (!loginPageSince) loginPageSince = Date.now();
      if (Date.now() - loginPageSince >= 15000) {
        throw batchError('LOGIN_FAILED', '\u661f\u6cb3\u767b\u5f55\u540e\u6301\u7eed\u505c\u7559\u5728\u5bc6\u7801\u9875，\u8bf7\u68c0\u67e5\u8d26\u53f7\u5bc6\u7801。');
      }
      await waitMilliseconds(800);
      continue;
    }
    loginPageSince = null;
    await waitMilliseconds(800);
  }
  throw batchError('LOGIN_TIMEOUT', '\u661f\u6cb3\u767b\u5f55\u8d85\u65f6。');
}

const ACCOUNT_RUN_SNAPSHOT_KEYS = [
  'businessDefenseSycmTrafficSnapshotV1',
  'gh_channel_snapshot',
  'wxtBusinessDefenseReportV1',
  'dmpPortraitSnapshotV1',
  'businessDefenseManualInputsV1',
  'businessDefenseAutoCollectStatusV1',
  'taobaoContentDiagnosisReportStatusV1',
  'taobaoContentDiagnosisReportV1',
  'taobaoContentDiagnosisWxtReportV1',
];

async function clearAccountRunSnapshots() {
  await chrome.storage.local.remove(ACCOUNT_RUN_SNAPSHOT_KEYS.concat([
    'businessDefenseLastAutoCollectAt',
    'sycmContentDiagnosisSnapshotV1',
    'wxtReportApiTraceV1',
  ]));
}

function resultFailures(result) {
  return Array.isArray(result && result.results)
    ? result.results
      .filter((item) => item && !item.skipped && (item.ok === false || item.partial))
      .map((item) => item.name + '\uff1a' + (
        item.message || (item.partial ? '\u90e8\u5206\u6570\u636e\u672a\u8fd4\u56de\u3002' : '\u6267\u884c\u5931\u8d25\u3002')
      ))
    : [];
}

async function archiveAccountRun(account, batchId, startedAt, loginResult, autoResult, reportResult, failureMessage, options) {
  const archiveOptions = options && typeof options === 'object' ? options : {};
  const taskType = ['collect', 'report', 'both'].includes(archiveOptions.taskType) ? archiveOptions.taskType : 'both';
  const runMode = archiveOptions.runMode === 'current' ? 'current' : 'batch';
  const stored = await chrome.storage.local.get(ACCOUNT_RUN_SNAPSHOT_KEYS.concat(STORE_RUN_INDEX_KEY));
  const finishedAt = Date.now();
  const runId = 'store-run-' + finishedAt.toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  const failures = resultFailures(autoResult).concat(resultFailures(reportResult));
  if (failureMessage) failures.push(String(failureMessage));
  const snapshots = {};
  ACCOUNT_RUN_SNAPSHOT_KEYS.forEach((key) => {
    if (stored[key] !== undefined) snapshots[key] = stored[key];
  });
  const safeAccount = safeBatchAccount(account);
  const record = {
    schema: 2,
    runId,
    batchId,
    taskType,
    runMode,
    account: safeAccount,
    startedAt,
    finishedAt,
    xinghe: {
      state: loginResult && loginResult.state || '',
      noPermission: Boolean(loginResult && loginResult.noPermission),
    },
    status: failureMessage ? 'failed' : (failures.length ? 'partial' : 'success'),
    failures,
    snapshots,
  };
  const entry = {
    runId,
    batchId,
    taskType,
    runMode,
    accountId: safeAccount.id,
    accountName: safeAccount.name,
    storeId: safeAccount.storeId,
    storeName: safeAccount.storeName,
    usernameMasked: safeAccount.usernameMasked,
    accountGroupId: safeAccount.accountGroupId,
    accountGroupName: safeAccount.accountGroupName,
    storeGroupId: safeAccount.storeGroupId,
    storeGroupName: safeAccount.storeGroupName,
    startedAt,
    finishedAt,
    status: record.status,
    failureCount: failures.length,
  };
  const index = Array.isArray(stored[STORE_RUN_INDEX_KEY]) ? stored[STORE_RUN_INDEX_KEY] : [];
  await chrome.storage.local.set({
    [STORE_RUN_KEY_PREFIX + runId]: record,
    [STORE_RUN_INDEX_KEY]: [entry].concat(index.filter((item) => item && item.runId !== runId)).slice(0, 1000),
  });
  return entry;
}

async function saveAccountBatchStatus(value) {
  const status = Object.assign({}, value, { updatedAt: Date.now() });
  await chrome.storage.local.set({ [ACCOUNT_BATCH_STATUS_KEY]: status });
  return status;
}

async function runAccountBatch(payload) {
  const accounts = (Array.isArray(payload && payload.accounts) ? payload.accounts : [])
    .slice(0, 100)
    .map(sanitizeBatchAccount)
    .filter((account) => account.platform === 'taobao');
  if (!accounts.length) throw new Error('当前分组没有可执行的淘宝账号。');
  const taskType = 'report';
  const platforms = normalizePlatformTaskIds(payload && payload.platforms);
  const notification = sanitizeNotificationConfig(payload && payload.notification);
  const resume = payload && payload.resume === true;
  const startIndex = Math.max(0, Math.min(accounts.length - 1, Number(payload && payload.startIndex) || 0));
  const batchId = resume && batchText(payload && payload.batchId, 100)
    ? batchText(payload.batchId, 100)
    : 'account-batch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  const startedAt = Number(payload && payload.startedAt) || Date.now();
  const previousStatus = resume
    ? (await chrome.storage.local.get(ACCOUNT_BATCH_STATUS_KEY))[ACCOUNT_BATCH_STATUS_KEY] || {}
    : {};
  const completedResults = resume && Array.isArray(previousStatus.results) ? previousStatus.results.slice() : [];
  const baseStatus = {
    schema: 1,
    batchId,
    running: true,
    paused: false,
    cancelled: false,
    startedAt,
    finishedAt: null,
    total: accounts.length,
    currentIndex: startIndex,
    resumeIndex: startIndex,
    selection: payload && payload.selection || {},
    taskType,
    platforms,
    accountIds: accounts.map((account) => account.id),
    accounts: accounts.map(safeBatchAccount),
    results: completedResults,
    phase: '\u51c6\u5907\u6279\u91cf\u4efb\u52a1',
    pauseReason: '',
  };
  accountBatchCancelRequested = false;
  await saveAccountBatchStatus(baseStatus);

  for (let index = startIndex; index < accounts.length; index += 1) {
    const account = accounts[index];
    const accountStartedAt = Date.now();
    let loginResult = null;
    let xingheTabId = null;
    if (accountBatchCancelRequested) break;
    await saveAccountBatchStatus(Object.assign({}, baseStatus, {
      currentIndex: index,
      resumeIndex: index,
      currentAccountId: account.id,
      currentStoreName: account.storeName,
      phase: '\u6e05\u7406\u4e0a\u4e00\u8d26\u53f7\u6570\u636e',
      results: completedResults,
    }));
    await clearAccountRunSnapshots();

    try {
      await saveAccountBatchStatus(Object.assign({}, baseStatus, {
        currentIndex: index,
        resumeIndex: index,
        currentAccountId: account.id,
        currentStoreName: account.storeName,
        phase: '\u767b\u5f55\u6dd8\u5b9d\u661f\u6cb3',
        results: completedResults,
      }));
      loginResult = await loginXingheAccount(account, { resume: resume && index === startIndex });
      xingheTabId = loginResult.tabId;
    } catch (error) {
      if (error && error.code === 'VERIFICATION_REQUIRED') {
        const tabId = error.tabId || xingheTabId || await prepareXingheTab();
        try { await chrome.tabs.update(tabId, { active: true }); } catch (activateError) {}
        const pauseReason = account.storeName + '\uff08' + maskedAccountName(account.username) + '\uff09\u767b\u5f55\u68c0\u6d4b\u5230\u6ed1\u5757\u6216\u9a8c\u8bc1\u7801。';
        let notificationMessage = '';
        try {
          const notice = await sendDingTalkNotification(notification,
            '\u3010\u6dd8\u5b9d\u5168\u94fe\u8def\u53d6\u6570\u3011' + pauseReason + '\u8bf7\u5728 Chrome \u661f\u6cb3\u9875\u5b8c\u6210\u9a8c\u8bc1\uff0c\u7136\u540e\u56de\u5de5\u5177\u70b9\u51fb\u201c\u7ee7\u7eed\u6279\u91cf\u4efb\u52a1\u201d。');
          notificationMessage = notice.ok ? '\u5df2\u53d1\u9001\u9489\u9489\u63d0\u9192。' : notice.message;
        } catch (noticeError) {
          notificationMessage = noticeError && noticeError.message ? noticeError.message : String(noticeError);
        }
        await saveAccountBatchStatus(Object.assign({}, baseStatus, {
          running: false,
          paused: true,
          currentIndex: index,
          resumeIndex: index,
          currentAccountId: account.id,
          currentStoreName: account.storeName,
          phase: '\u7b49\u5f85\u4eba\u5de5\u9a8c\u8bc1',
          pauseReason,
          notificationMessage,
          results: completedResults,
        }));
        return { ok: true, paused: true, batchId, resumeIndex: index };
      }
      const message = error && error.message ? error.message : String(error);
      const archive = await archiveAccountRun(
        account,
        batchId,
        accountStartedAt,
        null,
        null,
        null,
        message,
        { taskType, runMode: 'batch' }
      );
      completedResults.push({
        accountId: account.id,
        storeName: account.storeName,
        ok: false,
        phase: 'login',
        runId: archive.runId,
        message,
        finishedAt: Date.now(),
      });
      try {
        if (xingheTabId) await logoutXinghe(xingheTabId);
      } catch (logoutError) {}
      continue;
    }

    let reportResult = null;
    let failureMessage = '';
    try {
      if (accountBatchCancelRequested) throw batchError('BATCH_CANCELLED', '\u6279\u91cf\u4efb\u52a1\u5df2\u53d6\u6d88。');
      await saveAccountBatchStatus(Object.assign({}, baseStatus, {
        currentIndex: index,
        resumeIndex: index,
        currentAccountId: account.id,
        currentStoreName: account.storeName,
        phase: '\u4e00\u952e\u53d6\u6570\u5e76\u751f\u6210\u62a5\u544a',
        results: completedResults,
      }));
      reportResult = await ensureContentDiagnosisReportTask({ platforms }).promise;
    } catch (error) {
      failureMessage = error && error.message ? error.message : String(error);
    }

    await saveAccountBatchStatus(Object.assign({}, baseStatus, {
      currentIndex: index,
      resumeIndex: index,
      currentAccountId: account.id,
      currentStoreName: account.storeName,
      phase: '\u4fdd\u5b58\u5e97\u94fa\u5386\u53f2\u6570\u636e',
      results: completedResults,
    }));
    const archive = await archiveAccountRun(
      account,
      batchId,
      accountStartedAt,
      loginResult,
      null,
      reportResult,
      failureMessage,
      { taskType, runMode: 'batch' }
    );
    completedResults.push({
      accountId: account.id,
      storeName: account.storeName,
      ok: archive.status !== 'failed',
      partial: archive.status === 'partial',
      runId: archive.runId,
      message: failureMessage || (archive.status === 'partial'
        ? '\u90e8\u5206\u5e73\u53f0\u672a\u8fd4\u56de。'
        : '\u4e00\u952e\u53d6\u6570\u7684\u6570\u636e\u8868\u683c\u4e0e\u8bca\u65ad\u62a5\u544a\u5df2\u5f52\u6863。'),
      finishedAt: Date.now(),
    });

    const hasNextAccount = index + 1 < accounts.length && !accountBatchCancelRequested;
    if (xingheTabId && hasNextAccount) {
      await saveAccountBatchStatus(Object.assign({}, baseStatus, {
        currentIndex: index,
        resumeIndex: index,
        currentAccountId: account.id,
        currentStoreName: account.storeName,
        phase: '\u9000\u51fa\u5f53\u524d\u661f\u6cb3\u8d26\u53f7',
        results: completedResults,
      }));
      try { await logoutXinghe(xingheTabId); } catch (error) {
        completedResults[completedResults.length - 1].logoutWarning = error && error.message ? error.message : String(error);
      }
      await waitMilliseconds(1800);
    }
  }

  const cancelled = accountBatchCancelRequested;
  const finishedAt = Date.now();
  await saveAccountBatchStatus(Object.assign({}, baseStatus, {
    running: false,
    paused: false,
    cancelled,
    finishedAt,
    currentAccountId: '',
    currentStoreName: '',
    currentIndex: accounts.length,
    resumeIndex: accounts.length,
    phase: cancelled ? '\u6279\u91cf\u4efb\u52a1\u5df2\u53d6\u6d88' : '\u6279\u91cf\u4efb\u52a1\u5df2\u5b8c\u6210',
    results: completedResults,
  }));
  return { ok: true, cancelled, batchId, results: completedResults };
}

async function saveProjectTaskStatus(value) {
  const status = Object.assign({}, value, { updatedAt: Date.now() });
  await chrome.storage.local.set({ [PROJECT_TASK_STATUS_KEY]: status });
  return status;
}

async function runProjectTask(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const storeSource = source.store && typeof source.store === 'object' ? source.store : {};
  const storeId = batchText(storeSource.id, 100);
  const storeName = batchText(storeSource.name, 120);
  const taskType = 'report';
  const platforms = normalizePlatformTaskIds(source.platforms);
  if (!storeId || !storeName) throw new Error('请先选择本次任务归属的店铺。');
  const startedAt = Date.now();
  const taskId = 'project-task-' + startedAt.toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  const baseStatus = {
    schema: 1,
    taskId,
    taskType,
    platforms,
    runMode: 'current',
    storeId,
    storeName,
    storeGroupId: batchText(storeSource.groupId, 100),
    storeGroupName: batchText(storeSource.groupName, 100),
    running: true,
    startedAt,
    finishedAt: null,
    phase: '准备一键取数',
    error: '',
  };
  await saveProjectTaskStatus(baseStatus);
  await clearAccountRunSnapshots();

  let reportResult = null;
  let failureMessage = '';
  try {
    await saveProjectTaskStatus(Object.assign({}, baseStatus, { phase: '一键读取并生成项目结果' }));
    reportResult = await ensureContentDiagnosisReportTask({ platforms }).promise;
  } catch (error) {
    failureMessage = error && error.message ? error.message : String(error);
  }

  await saveProjectTaskStatus(Object.assign({}, baseStatus, { phase: '保存店铺运行记录' }));
  const account = {
    id: 'current-session',
    name: '当前登录账号',
    storeId,
    storeName,
    username: '',
    roleKeyword: '',
    accountGroupId: '',
    accountGroupName: '',
    storeGroupId: baseStatus.storeGroupId,
    storeGroupName: baseStatus.storeGroupName,
  };
  const archive = await archiveAccountRun(
    account,
    taskId,
    startedAt,
    { state: 'currentSession', noPermission: false },
    null,
    reportResult,
    failureMessage,
    { taskType, runMode: 'current' }
  );
  const finishedAt = Date.now();
  await saveProjectTaskStatus(Object.assign({}, baseStatus, {
    running: false,
    finishedAt,
    phase: failureMessage ? '任务失败' : '任务已完成',
    status: archive.status,
    archiveRunId: archive.runId,
    failureCount: archive.failureCount,
    error: failureMessage,
  }));
  return {
    ok: archive.status !== 'failed',
    partial: archive.status === 'partial',
    taskId,
    runId: archive.runId,
    status: archive.status,
    message: failureMessage || '一键取数结果已归档。',
  };
}

function ensureBusinessDefenseAutoCollectTask(options) {
  if (businessDefenseAutoCollectPromise) {
    return { promise: businessDefenseAutoCollectPromise, started: false };
  }
  const task = runBusinessDefenseAutoCollect(options);
  businessDefenseAutoCollectPromise = task;
  const lifecycle = task.catch(async (error) => {
    const stored = await chrome.storage.local.get(BUSINESS_DEFENSE_AUTO_STATUS_KEY);
    const previous = stored && stored[BUSINESS_DEFENSE_AUTO_STATUS_KEY] || {};
    await chrome.storage.local.set({
      [BUSINESS_DEFENSE_AUTO_STATUS_KEY]: Object.assign({}, previous, {
        running: false,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        currentStep: '',
        activeSteps: [],
        error: error && error.message ? error.message : String(error),
      }),
    });
  }).finally(() => {
    if (businessDefenseAutoCollectPromise === task) businessDefenseAutoCollectPromise = null;
  });
  lifecycle.catch(() => {});
  return { promise: task, started: true };
}

function ensureContentDiagnosisReportTask(options) {
  if (contentDiagnosisReportPromise) {
    return { promise: contentDiagnosisReportPromise, started: false };
  }
  const task = runContentDiagnosisReport(options);
  contentDiagnosisReportPromise = task;
  const lifecycle = task.catch(async (error) => {
    const stored = await chrome.storage.local.get(CONTENT_DIAGNOSIS_STATUS_KEY);
    const previous = stored && stored[CONTENT_DIAGNOSIS_STATUS_KEY] || {};
    await chrome.storage.local.set({
      [CONTENT_DIAGNOSIS_STATUS_KEY]: Object.assign({}, previous, {
        running: false,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
        currentStep: '',
        activeSteps: [],
        error: error && error.message ? error.message : String(error),
      }),
    });
  }).finally(() => {
    if (contentDiagnosisReportPromise === task) contentDiagnosisReportPromise = null;
  });
  lifecycle.catch(() => {});
  return { promise: task, started: true };
}

function ensureAccountBatchTask(payload) {
  if (accountBatchPromise) {
    return { promise: accountBatchPromise, started: false };
  }
  const task = runAccountBatch(payload || {});
  accountBatchPromise = task;
  const lifecycle = task.catch(async (error) => {
    const stored = await chrome.storage.local.get(ACCOUNT_BATCH_STATUS_KEY);
    const previous = stored && stored[ACCOUNT_BATCH_STATUS_KEY] || {};
    await saveAccountBatchStatus(Object.assign({}, previous, {
      running: false,
      paused: false,
      finishedAt: Date.now(),
      phase: '批量任务失败',
      error: error && error.message ? error.message : String(error),
    }));
  }).finally(() => {
    if (accountBatchPromise === task) accountBatchPromise = null;
  });
  lifecycle.catch(() => {});
  return { promise: task, started: true };
}

function ensureProjectTask(payload) {
  if (projectTaskPromise) return { promise: projectTaskPromise, started: false };
  const task = runProjectTask(payload || {});
  projectTaskPromise = task;
  const lifecycle = task.catch(async (error) => {
    const stored = await chrome.storage.local.get(PROJECT_TASK_STATUS_KEY);
    const previous = stored && stored[PROJECT_TASK_STATUS_KEY] || {};
    await saveProjectTaskStatus(Object.assign({}, previous, {
      running: false,
      finishedAt: Date.now(),
      phase: '任务失败',
      error: error && error.message ? error.message : String(error),
    }));
  }).finally(() => {
    if (projectTaskPromise === task) projectTaskPromise = null;
  });
  lifecycle.catch(() => {});
  return { promise: task, started: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'PROJECT_TASK_START') return;
  if (!isOneClickWebToolSender(message, sender)) {
    sendResponse({ ok: false, message: '请从淘宝全链路网页工具的“一键取数”页面发起任务。' });
    return;
  }
  (async () => {
    if (accountBatchPromise) {
      sendResponse({ ok: false, message: '分组批量任务正在执行，请完成后再执行当前账号任务。' });
      return;
    }
    if (projectTaskPromise) {
      sendResponse({ ok: true, started: false, running: true });
      return;
    }
    if (businessDefenseAutoCollectPromise || contentDiagnosisReportPromise) {
      sendResponse({ ok: false, message: '当前有其他取数或报告任务在执行。' });
      return;
    }
    const launch = ensureProjectTask(message.payload || {});
    sendResponse({ ok: true, started: launch.started, running: true });
  })().catch((error) => {
    sendResponse({ ok: false, message: error && error.message ? error.message : String(error) });
  });
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || ![
    'BUSINESS_DEFENSE_AUTO_COLLECT',
    'BUSINESS_DEFENSE_GENERATE_CONTENT_REPORT',
  ].includes(message.type)) return;
  sendResponse({
    ok: false,
    message: '独立取数入口已停用，请从团队网页的“一键取数”发起任务并自动归档。',
  });
  return false;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const allowedTypes = [
    'ACCOUNT_SESSION_SET',
    'ACCOUNT_SESSION_GET_SUMMARY',
    'ACCOUNT_SESSION_GET_MANAGEMENT',
    'ACCOUNT_SESSION_CLEAR',
    'ACCOUNT_BATCH_START_FROM_SESSION',
    'ACCOUNT_BATCH_CANCEL',
    'ACCOUNT_BATCH_TEST_DINGTALK',
  ];
  if (!message || !allowedTypes.includes(message.type)) return;
  if (!isBusinessDefenseWebToolSender(message, sender)) {
    sendResponse({ ok: false, message: '请从淘宝全链路网页工具管理批量任务。' });
    return;
  }
  if (message.type === 'ACCOUNT_BATCH_START_FROM_SESSION' && !isOneClickWebToolSender(message, sender)) {
    sendResponse({ ok: false, message: '请从淘宝全链路网页工具的“一键取数”页面发起批量任务。' });
    return;
  }
  (async () => {
    if (message.type === 'ACCOUNT_SESSION_SET') {
      const session = sanitizeAccountManagementSession(message);
      await chrome.storage.session.set({ [ACCOUNT_VAULT_SESSION_KEY]: session });
      sendResponse({ ok: true, summary: summarizeAccountSession(session) });
      return;
    }
    if (message.type === 'ACCOUNT_SESSION_GET_SUMMARY') {
      const stored = await chrome.storage.session.get(ACCOUNT_VAULT_SESSION_KEY);
      sendResponse({ ok: true, summary: summarizeAccountSession(stored[ACCOUNT_VAULT_SESSION_KEY]) });
      return;
    }
    if (message.type === 'ACCOUNT_SESSION_GET_MANAGEMENT') {
      if (!isAccountManagementWebToolSender(sender)) {
        sendResponse({ ok: false, message: '仅账号库管理页可恢复管理会话。' });
        return;
      }
      const stored = await chrome.storage.session.get(ACCOUNT_VAULT_SESSION_KEY);
      sendResponse({
        ok: true,
        session: accountManagementSession(stored[ACCOUNT_VAULT_SESSION_KEY]),
      });
      return;
    }
    if (message.type === 'ACCOUNT_SESSION_CLEAR') {
      await chrome.storage.session.remove(ACCOUNT_VAULT_SESSION_KEY);
      sendResponse({ ok: true, cleared: true });
      return;
    }
    if (message.type === 'ACCOUNT_BATCH_TEST_DINGTALK') {
      const result = await sendDingTalkNotification(
        message.notification,
        '【淘宝全链路取数】钉钉机器人连接测试成功。'
      );
      sendResponse(result);
      return;
    }
    if (message.type === 'ACCOUNT_BATCH_CANCEL') {
      if (!accountBatchPromise) {
        const stored = await chrome.storage.local.get(ACCOUNT_BATCH_STATUS_KEY);
        const previous = stored && stored[ACCOUNT_BATCH_STATUS_KEY] || {};
        if (previous.paused) {
          await saveAccountBatchStatus(Object.assign({}, previous, {
            running: false,
            paused: false,
            cancelled: true,
            finishedAt: Date.now(),
            phase: '批量任务已取消',
            pauseReason: '',
          }));
          sendResponse({ ok: true, running: false, cancelled: true });
          return;
        }
        sendResponse({ ok: true, running: false, message: '当前没有正在执行的批量任务。' });
        return;
      }
      accountBatchCancelRequested = true;
      const stored = await chrome.storage.local.get(ACCOUNT_BATCH_STATUS_KEY);
      const previous = stored && stored[ACCOUNT_BATCH_STATUS_KEY] || {};
      await saveAccountBatchStatus(Object.assign({}, previous, {
        cancelled: true,
        phase: '正在取消，当前步骤结束后停止',
      }));
      sendResponse({ ok: true, running: true, cancelling: true });
      return;
    }
    if (businessDefenseAutoCollectPromise || contentDiagnosisReportPromise || projectTaskPromise) {
      sendResponse({ ok: false, message: '当前有单店取数或报告任务正在执行，请完成后再启动批量任务。' });
      return;
    }
    let payload = message.payload || {};
    if (message.type === 'ACCOUNT_BATCH_START_FROM_SESSION') {
      const sessionStored = await chrome.storage.session.get(ACCOUNT_VAULT_SESSION_KEY);
      const vault = accountVaultFromSession(sessionStored[ACCOUNT_VAULT_SESSION_KEY]);
      const statusStored = payload.resume
        ? await chrome.storage.local.get(ACCOUNT_BATCH_STATUS_KEY)
        : {};
      payload = prepareAccountBatchFromSession(vault, payload, statusStored[ACCOUNT_BATCH_STATUS_KEY]);
    }
    const launch = ensureAccountBatchTask(payload);
    sendResponse({ ok: true, started: launch.started, running: true });
  })().catch((error) => {
    sendResponse({ ok: false, message: error && error.message ? error.message : String(error) });
  });
  return true;
});

function isMissingContentReceiver(error) {
  const message = String(error && error.message || error || '');
  return message.includes('Receiving end does not exist') ||
    message.includes('Could not establish connection') ||
    message.includes('message port closed');
}

function normalizeGuangheTargetGroups(values) {
  const groups = new Map();
  (Array.isArray(values) ? values : []).forEach((value) => {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : { ids: Array.isArray(value) ? value : [value] };
    const ids = Array.from(new Set((Array.isArray(source.ids) ? source.ids : [])
      .map((item) => String(item == null ? '' : item).trim().replace(/\.0+$/, ''))
      .filter((item) => /^[a-z0-9_-]{3,100}$/i.test(item))));
    const identityEntries = (Array.isArray(source.identityEntries) ? source.identityEntries : [])
      .map((entry) => ({
        field: String(entry && entry.field || 'unknown').slice(0, 200),
        value: String(entry && entry.value || '').trim().replace(/\.0+$/, ''),
      }))
      .filter((entry) => entry.value && ids.includes(entry.value))
      .slice(0, 100);
    const titles = (Array.isArray(source.titles) ? source.titles : [])
      .map((entry) => ({
        field: String(entry && entry.field || 'unknown').slice(0, 200),
        value: String(entry && entry.value || '').trim().slice(0, 500),
        normalized: String(entry && entry.normalized || '').trim().slice(0, 500),
      }))
      .filter((entry) => entry.value)
      .slice(0, 50);
    const titleKeys = Array.from(new Set(titles
      .map((entry) => String(entry.normalized || '').trim())
      .filter(Boolean)))
      .sort();
    if (!ids.length && !titleKeys.length) return;
    const key = ids.length ? ids.slice().sort().join('|') : 'title:' + titleKeys.join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        groupKey: key,
        ids,
        identityEntries,
        titles,
        rawSample: source.rawSample && typeof source.rawSample === 'object'
          ? source.rawSample
          : null,
      });
    }
  });
  return Array.from(groups.values()).slice(0, 5000);
}

async function requestGuangheAutomaticSync(tabId, requestId, targetVideoGroups) {
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'GH_SYNC_ALL_CONTENT',
        requestId,
        targetVideoGroups,
      });
      if (response) return response;
    } catch (error) {
      lastError = error;
      if (!isMissingContentReceiver(error)) throw error;
    }
    await waitMilliseconds(500);
  }
  throw lastError || new Error('光合页面脚本未完成加载。');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'WXT_SYNC_GUANGHE_CONTENT') return;
  const sourceTabId = sender.tab && sender.tab.id;
  if (!sourceTabId || !isWxtReportSender(sender)) {
    sendResponse({ ok: false, message: '只能从万相台短视频报表发起光合自动同步。' });
    return;
  }

  (async () => {
    let guangheTab = null;
    try {
      const targetVideoGroups = normalizeGuangheTargetGroups(message.targetVideoGroups);
      if (!targetVideoGroups.length) {
        sendResponse({
          ok: true,
          skipped: true,
          contentCount: 0,
          productCount: 0,
          targetCount: 0,
          matchedCount: 0,
          complete: true,
          fetchedAt: Date.now(),
        });
        return;
      }
      const createOptions = {
        url: GH_AUTOMATIC_SYNC_URL,
        active: false,
      };
      if (sender.tab && Number.isFinite(sender.tab.windowId)) {
        createOptions.windowId = sender.tab.windowId;
      }
      guangheTab = await chrome.tabs.create(createOptions);
      const requestId = 'gh-sync-' + Date.now().toString(36) + '-' +
        Math.random().toString(36).slice(2, 12);
      const result = await requestGuangheAutomaticSync(
        guangheTab.id,
        requestId,
        targetVideoGroups
      );
      if (!result || !result.ok) {
        throw new Error(result && result.message
          ? result.message
          : '光合页面没有返回定向匹配数据。');
      }
      const matchedCount = Number(result.matchedCount) || 0;
      const identityCheckRequired = targetVideoGroups.length > 0 && matchedCount === 0;
      if (!identityCheckRequired) {
        await chrome.tabs.remove(guangheTab.id);
      }
      sendResponse({
        ok: true,
        requestId,
        contentCount: result.contentCount || 0,
        productCount: result.productCount || 0,
        targetCount: result.targetCount || targetVideoGroups.length,
        matchedCount,
        scannedCount: result.scannedCount || 0,
        pagesFetched: result.pagesFetched || 0,
        complete: result.complete !== false,
        timedOut: result.timedOut === true,
        capped: result.capped === true,
        failed: result.failed === true,
        fallbackUsed: result.fallbackUsed === true,
        directLookupUsed: result.directLookupUsed === true,
        directLookupMatched: result.directLookupMatched || 0,
        mappingPairs: Array.isArray(result.mappingPairs) ? result.mappingPairs : [],
        identityCheckRequired,
        accountCheckRequired: identityCheckRequired,
        fetchedAt: result.fetchedAt || Date.now(),
      });
    } catch (error) {
      console.warn(TAG, '万相台触发光合定向同步失败:', error);
      sendResponse({
        ok: false,
        message: (error && error.message ? error.message : '光合定向同步失败。') +
          ' 已保留光合页面，请确认登录状态后重试。',
      });
    }
  })();
  return true;
});

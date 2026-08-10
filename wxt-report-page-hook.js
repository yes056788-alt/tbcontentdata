// wxt-report-page-hook.js - Reuses Wanxiangtai's signed same-origin report requests.
(function () {
  'use strict';

  if (location.hostname !== 'one.alimama.com' && location.hostname !== 'one.alimama.hk') return;
  if (window.__wxtReportPageHookV1) return;
  window.__wxtReportPageHookV1 = true;

  const REQUEST_TYPE = 'WXT_REPORT_EXPORT_REQUEST';
  const RESPONSE_TYPE = 'WXT_REPORT_EXPORT_RESPONSE';
  const PROGRESS_TYPE = 'WXT_REPORT_EXPORT_PROGRESS';
  const MARKETING_FIELDS = [
    'charge',
    'adPv',
    'click',
    'ctr',
    'cartDirNum',
    'cartInshopNum',
    'cartRate',
    'alipayDirNum',
    'alipayDirAmt',
    'alipayInshopNum',
    'alipayInshopAmt',
    'cvr',
    'roi',
    'inshopPotentialUv',
    'inshopPotentialUvRate',
    'inshopUv',
    'alipayInshopUv',
    'newAlipayInshopUv',
    'newAlipayInshopUvRate',
  ];
  const SHORT_VIDEO_DETAIL_FIELDS = [
    'charge',
    'adPv',
    'click',
    'ctr',
    'feedViewNum',
    'ecpc',
    'ecpm',
    'makeCharge',
    'roi',
    'cvr',
    'alipayInshopCost',
    'cartInshopNum',
    'itemColCartRate',
    'cartRate',
    'cartCost',
    'inshopPv',
    'inshopUv',
    'inshopPotentialUv',
    'inshopPotentialUvRate',
    'alipayInshopNum',
    'alipayInshopAmt',
    'alipayDirAmt',
    'alipayInshopUv',
    'newAlipayInshopUv',
    'newAlipayInshopUvRate',
    'liveVideoNewUv',
    'liveVideoNewCost',
    'newInshopUv',
    'displayNewRoi',
    'displayNewCharge',
    'displayNewChargeRate',
    'displayNewInshopAmt',
    'firstPurchaseUv',
    'firstNewCustomerCost',
  ];
  const SHORT_VIDEO_ACCOUNT_FIELDS = MARKETING_FIELDS.slice();
  const SHORT_VIDEO_CONFIG_FIELDS = [
    'shortVideoPromotionScene',
    'shortVideoOptimizeTarget',
    'shortVideoBidType',
    'solutionName',
    'solution',
    'solutionTypeName',
    'solutionType',
    'marketingSolutionName',
    'marketingSolution',
    'sceneSolutionName',
    'sceneSolution',
    'launchSolution',
    'launchSolutionName',
    'campaignSolution',
    'campaignSolutionName',
    '解决方案',
    'optimizationTargetName',
    'optimizationTarget',
    'optimizeTargetName',
    'optimizeTarget',
    'optimizeTargetTypeName',
    'optimizeTargetType',
    'optimizeGoal',
    'optimizeGoalName',
    'optimizationGoal',
    'optimizationGoalName',
    'marketingTarget',
    'marketingTargetName',
    'promotionGoalName',
    'promotionGoal',
    'campaignGoalName',
    'campaignGoal',
    'targetName',
    'target',
    '优化目标',
    'bidModeName',
    'bidMode',
    'bidTypeName',
    'bidType',
    'biddingStrategyName',
    'biddingStrategy',
    'bidStrategyName',
    'bidStrategy',
    'ocpcTypeName',
    'ocpcType',
    'chargeTypeName',
    'chargeType',
    'priceTypeName',
    'priceType',
    'bidWay',
    'bidWayName',
    'deliveryMode',
    'deliveryModeName',
    'deliveryType',
    'deliveryTypeName',
    'putType',
    'putTypeName',
    'putWay',
    'putWayName',
    '出价方式',
  ];
  const SHORT_VIDEO_CONFIG_QUERY_FIELDS = [
    'shortVideoPromotionScene',
    'shortVideoOptimizeTarget',
    'shortVideoBidType',
  ];
  const SHORT_VIDEO_SCENES = [
    'ad_strategy_short_video_rtb',
    'ad_strategy_short_video_guarantee',
    'ad_strategy_short_video_create_marketing_integrate',
    'ad_strategy_short_video_new',
  ];
  const SAFE_METRIC_FIELDS = [
    'charge',
    'adPv',
    'click',
    'ctr',
    'cartDirNum',
    'cartInshopNum',
    'cartRate',
    'alipayDirNum',
    'alipayDirAmt',
    'alipayInshopNum',
    'alipayInshopAmt',
    'cvr',
    'roi',
    'inshopPotentialUv',
    'inshopPotentialUvRate',
    'inshopUv',
    'alipayInshopUv',
    'newAlipayInshopUv',
    'newAlipayInshopUvRate',
  ];
  const METRIC_ALIASES = {
    charge: ['charge', 'cost', 'spend', 'consume', 'totalCharge', '花费', '消耗'],
    adPv: ['adPv', 'adpv', 'impression', 'impressions', 'displayPv', '展现量'],
    click: ['click', 'clicks', 'clickUv', '点击量'],
    ctr: ['ctr', 'clickRate', '点击率'],
    cartDirNum: ['cartDirNum', 'directCartNum', '直接购物车数'],
    cartInshopNum: ['cartInshopNum', 'cartNum', 'totalCartNum', '宝贝加购数', '总购物车数'],
    cartRate: ['cartRate', 'itemColCartRate', 'addCartRate', '加购率'],
    alipayDirNum: ['alipayDirNum', 'directAlipayNum', '直接成交笔数'],
    alipayDirAmt: ['alipayDirAmt', 'directAlipayAmt', '直接成交金额'],
    alipayInshopNum: ['alipayInshopNum', 'alipayNum', 'transactionNum', '成交笔数', '总成交笔数'],
    alipayInshopAmt: [
      'alipayInshopAmt',
      'alipayAmt',
      'transactionAmt',
      'totalAlipayAmt',
      'totalTransactionAmt',
      'gmv',
      '成交金额',
      '总成交金额',
    ],
    cvr: ['cvr', 'conversionRate', 'clickConversionRate', '成交转化率'],
    roi: [
      'roi',
      'totalRoi',
      'alipayInshopRoi',
      'alipayRoi',
      'transactionRoi',
      'totalTransactionRoi',
      'displayRoi',
      'clickRoi',
      'inputOutputRatio',
      '投入产出比',
      '总成交ROI',
      '投产比',
    ],
    inshopPotentialUv: [
      'inshopPotentialUv',
      'potentialUv',
      'potentialCustomerUv',
      'guidePotentialUv',
      'guideVisitPotentialUv',
      'guideInshopPotentialUv',
      'leadPotentialUv',
      'inshopLeadUv',
      'inshopProspectUv',
      '引导访问潜客数',
      '潜客数',
    ],
    inshopPotentialUvRate: [
      'inshopPotentialUvRate',
      'potentialUvRate',
      'potentialCustomerRate',
      'potentialCustomerRatio',
      'potentialRate',
      'potentialRatio',
      'guidePotentialUvRate',
      'guideVisitPotentialUvRate',
      'guideVisitPotentialRate',
      'guideInshopPotentialUvRate',
      'leadPotentialUvRate',
      'leadPotentialRate',
      'inshopPotentialRate',
      'inshopPotentialRatio',
      '引导访问潜客占比',
      '引导访问潜客比例',
      '引导访问潜客率',
      '潜客占比',
      '潜客比',
      '潜客率',
    ],
    inshopUv: [
      'inshopUv',
      'guideInshopUv',
      'guideVisitUv',
      'guideVisitorUv',
      'inshopVisitUv',
      'inshopVisitorUv',
      'shopVisitUv',
      'visitUv',
      '引导访问人数',
      '引导进店人数',
    ],
    alipayInshopUv: ['alipayInshopUv', 'alipayUv', 'transactionUv', '成交人数'],
    newAlipayInshopUv: ['newAlipayInshopUv', 'newAlipayUv', 'newCustomerUv', '成交新客数'],
    newAlipayInshopUvRate: [
      'newAlipayInshopUvRate',
      'newAlipayUvRate',
      'newCustomerRate',
      '成交新客占比',
    ],
    totalCharge: ['totalCharge', 'onebpTotalCharge', 'charge', '总花费'],
    searchCharge: ['searchCharge'],
    displayCharge: ['displayCharge'],
    contentSceneCharge: ['contentSceneCharge'],
    shortVideoCharge: [
      'shortVideoCharge',
      'shortVideoRtbCharge',
      'shortVideoTotalCharge',
      'superShortVideoCharge',
    ],
    onebpSiteCharge: ['onebpSiteCharge'],
    siteSceneCharge: ['siteSceneCharge'],
  };
  const METRIC_VALUE_KEYS = [
    'absolute',
    'value',
    'currentValue',
    'indicatorValue',
    'metricValue',
    'number',
    'num',
    'rawValue',
    'ratio',
    'rate',
    'percent',
    'percentage',
  ];
  const METRIC_VALUE_KEY_SET = new Set(METRIC_VALUE_KEYS.map(normalizedFieldKey));
  const METRIC_DESCRIPTOR_KEYS = [
    'metric',
    'metricKey',
    'field',
    'fieldName',
    'indicator',
    'indicatorCode',
    'code',
    'key',
    'name',
  ];
  const METRIC_CONTAINER_KEYS = new Set([
    'current',
    'currentdata',
    'metrics',
    'metricdata',
    'indicators',
    'indicatorvalues',
    'values',
    'summary',
    'total',
    'data',
  ]);
  const SAFE_SHORT_VIDEO_IDENTITY_FIELDS = [
    'campaignId',
    'campaignName',
    'originalSceneId',
    'originalSceneName',
    'sceneId',
    'scene1Name',
    'sceneName',
    'solution',
    'solutionName',
    'marketingSolution',
    'marketingSolutionName',
    'solutionType',
    'solutionTypeName',
    'launchSolution',
    'launchSolutionName',
    'campaignSolution',
    'campaignSolutionName',
    'optimizeTarget',
    'optimizeTargetName',
    'optimizationTarget',
    'optimizationTargetName',
    'optimizeTargetType',
    'optimizeTargetTypeName',
    'optimizeGoal',
    'optimizeGoalName',
    'optimizationGoal',
    'optimizationGoalName',
    'marketingTarget',
    'marketingTargetName',
    'promotionGoal',
    'promotionGoalName',
    'campaignGoal',
    'campaignGoalName',
    'bidMode',
    'bidModeName',
    'bidType',
    'bidTypeName',
    'bidStrategy',
    'bidStrategyName',
    'biddingStrategy',
    'biddingStrategyName',
    'ocpcType',
    'ocpcTypeName',
    'chargeType',
    'chargeTypeName',
    'priceType',
    'priceTypeName',
    'bidWay',
    'bidWayName',
    'deliveryMode',
    'deliveryModeName',
    'deliveryType',
    'deliveryTypeName',
    'putType',
    'putTypeName',
    'putWay',
    'putWayName',
    'promotionId',
    'promotionName',
    'adgroupId',
    'adgroupName',
    'unitId',
    'unitName',
    'subjectId',
    'subjectName',
    'entityId',
    'entityName',
    'videoId',
    'videoName',
    'videoTitle',
    'videoInfo',
    'creativeId',
    'creativeName',
    'materialId',
    'materialName',
    'contentId',
    'contentName',
    'feedId',
    'feedName',
    'resourceId',
    'resourceName',
  ];
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalFetch = typeof window.fetch === 'function' ? window.fetch : null;
  const templates = {
    accountQuery: null,
    sceneQuery: null,
    charge: null,
    shortVideoAccountQuery: null,
    shortVideoDetailQuery: null,
  };

  function parseStructuredValue(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {}
    }
    return value;
  }

  function parseRequestBody(body) {
    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith('{')) {
        try {
          return { kind: 'json', data: JSON.parse(trimmed) };
        } catch (error) {}
      }
      try {
        const params = new URLSearchParams(trimmed);
        const data = {};
        for (const [key, value] of params.entries()) {
          const parsed = parseStructuredValue(value);
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            data[key] = Array.isArray(data[key])
              ? data[key].concat([parsed])
              : [data[key], parsed];
          } else {
            data[key] = parsed;
          }
        }
        return Object.keys(data).length ? { kind: 'form', data } : null;
      } catch (error) {
        return null;
      }
    }
    if (body instanceof URLSearchParams) {
      return parseRequestBody(body.toString());
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const data = {};
      for (const [key, value] of body.entries()) {
        if (typeof value !== 'string') continue;
        data[key] = parseStructuredValue(value);
      }
      return { kind: 'form', data };
    }
    return null;
  }

  function serializeRequestBody(data, kind) {
    if (kind === 'json') return JSON.stringify(data);
    const params = new URLSearchParams();
    Object.entries(data).forEach(([key, value]) => {
      if (value === undefined) return;
      if (value === null) {
        params.set(key, '');
      } else if (Array.isArray(value) || typeof value === 'object') {
        params.set(key, JSON.stringify(value));
      } else {
        params.set(key, String(value));
      }
    });
    return params.toString();
  }

  function requestPath(rawUrl) {
    try {
      return new URL(rawUrl, location.href).pathname;
    } catch (error) {
      return '';
    }
  }

  function reportEndpointKind(path) {
    if (/\/report\/chargeSum(?:\.json)?$/i.test(path)) return 'charge';
    if (
      /\/report\/[^/]*query[^/]*(?:\.json)?$/i.test(path) &&
      !/(?:template|config)/i.test(path)
    ) return 'query';
    return '';
  }

  function readReportField(data, aliases) {
    if (!data || typeof data !== 'object') return undefined;
    const normalizedAliases = new Set(aliases.map((alias) => (
      String(alias || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    )));
    for (const [key, value] of Object.entries(data)) {
      const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedAliases.has(normalized)) return value;
    }
    return undefined;
  }

  function findReportPayload(value, depth, path, seen) {
    if (!value || typeof value !== 'object' || (depth || 0) > 5) return null;
    const visited = seen || new Set();
    if (visited.has(value)) return null;
    visited.add(value);
    if (isMarketingAccount(value) || isShortVideoReport(value)) {
      return { data: value, path: path || [] };
    }
    const priorityKeys = ['data', 'params', 'query', 'payload', 'request', 'body', 'model'];
    const entries = Object.entries(value).sort((left, right) => (
      Number(priorityKeys.includes(right[0])) - Number(priorityKeys.includes(left[0]))
    ));
    for (const [key, child] of entries) {
      if (!child || typeof child !== 'object') continue;
      const found = findReportPayload(child, (depth || 0) + 1, (path || []).concat(key), visited);
      if (found) return found;
    }
    return null;
  }

  function queryDataFromUrl(rawUrl) {
    try {
      const data = {};
      const url = new URL(rawUrl, location.href);
      for (const [key, value] of url.searchParams.entries()) {
        data[key] = parseStructuredValue(value);
      }
      return data;
    } catch (error) {
      return {};
    }
  }

  function parseTemplateRequest(rawUrl, body) {
    const parsed = parseRequestBody(body);
    if (parsed) {
      const direct = findReportPayload(parsed.data);
      if (direct) {
        return {
          kind: parsed.kind,
          data: direct.data,
          requestData: parsed.data,
          dataPath: direct.path,
        };
      }
      const merged = { ...queryDataFromUrl(rawUrl), ...parsed.data };
      const mergedPayload = findReportPayload(merged);
      if (mergedPayload) {
        return {
          kind: parsed.kind,
          data: mergedPayload.data,
          requestData: merged,
          dataPath: mergedPayload.path,
        };
      }
    }
    const queryData = queryDataFromUrl(rawUrl);
    const queryPayload = findReportPayload(queryData);
    if (!queryPayload) return null;
    return {
      kind: 'form',
      data: queryPayload.data,
      requestData: queryData,
      dataPath: queryPayload.path,
    };
  }

  function reportDomains(data) {
    const rawDomains = readReportField(data, ['queryDomains', 'queryDomain', 'domains', 'domain']);
    const result = [];
    const visit = (value, depth) => {
      if (value === null || value === undefined || (depth || 0) > 4) return;
      const parsed = parseStructuredValue(value);
      if (parsed !== value) {
        visit(parsed, (depth || 0) + 1);
        return;
      }
      if (typeof value === 'string') {
        value.split(/[,|]/).forEach((item) => {
          const normalized = item.trim().toLowerCase();
          if (normalized) result.push(normalized);
        });
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item) => visit(item, (depth || 0) + 1));
        return;
      }
      if (typeof value === 'object') {
        Object.entries(value).forEach(([key, child]) => {
          if (child === true || child === 1 || child === '1') result.push(String(key).toLowerCase());
          visit(child, (depth || 0) + 1);
        });
      }
    };
    visit(rawDomains, 0);
    return Array.from(new Set(result));
  }

  function isMarketingAccount(data) {
    return String(readReportField(data, ['bizCode']) || '').toLowerCase() === 'universalbp' &&
      String(readReportField(data, ['rptType', 'reportType']) || '').toLowerCase() === 'account';
  }

  function isShortVideoReport(data) {
    return String(readReportField(data, ['bizCode']) || '').toLowerCase() === 'onebpshortvideo' &&
      String(readReportField(data, ['rptType', 'reportType']) || '').toLowerCase() === 'short_video_migrate';
  }

  function captureTemplateRequest(meta, body) {
    if (meta.internal) return;
    const path = requestPath(meta.url);
    const endpoint = reportEndpointKind(path);
    if (!endpoint) return;
    const parsed = parseTemplateRequest(meta.url, body);
    if (!parsed || (!isMarketingAccount(parsed.data) && !isShortVideoReport(parsed.data))) return;

    const template = {
      url: new URL(meta.url, location.href).toString(),
      method: meta.method || 'POST',
      headers: { ...(meta.headers || {}) },
      kind: parsed.kind,
      data: parsed.data,
      requestData: parsed.requestData,
      dataPath: parsed.dataPath,
    };
    if (endpoint === 'query') {
      const domains = reportDomains(parsed.data);
      const hasDomain = (name) => domains.some((domain) => (
        domain === name || domain.endsWith('.' + name) || domain.includes(name + '_')
      ));
      if (isMarketingAccount(parsed.data)) {
        if (hasDomain('account')) templates.accountQuery = template;
        if (hasDomain('scene')) templates.sceneQuery = template;
      } else if (isShortVideoReport(parsed.data)) {
        if (hasDomain('account')) templates.shortVideoAccountQuery = template;
        if (hasDomain('campaign') || hasDomain('promotion')) {
          templates.shortVideoDetailQuery = template;
        }
      }
    } else {
      templates.charge = template;
    }
  }

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__wxtRequestMethod = String(method || 'GET').toUpperCase();
    this.__wxtRequestUrl = String(url || '');
    this.__wxtRequestHeaders = {};
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__wxtRequestHeaders) {
      this.__wxtRequestHeaders[String(name || '')] = String(value || '');
    }
    return originalSetRequestHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      captureTemplateRequest({
        url: this.__wxtRequestUrl,
        method: this.__wxtRequestMethod,
        headers: this.__wxtRequestHeaders,
        internal: this.__wxtInternalRequest,
        transport: 'xhr',
      }, body);
    } catch (error) {}
    return originalSend.call(this, body);
  };

  function headersObject(headers) {
    const result = {};
    if (!headers) return result;
    try {
      if (typeof headers.forEach === 'function') {
        headers.forEach((value, name) => { result[String(name)] = String(value); });
      } else if (Array.isArray(headers)) {
        headers.forEach((entry) => {
          if (Array.isArray(entry) && entry.length >= 2) result[String(entry[0])] = String(entry[1]);
        });
      } else {
        Object.entries(headers).forEach(([name, value]) => { result[String(name)] = String(value); });
      }
    } catch (error) {}
    return result;
  }

  if (originalFetch) {
    window.fetch = function (input, init) {
      try {
        const config = init || {};
        const requestLike = input && typeof input === 'object' ? input : null;
        const url = requestLike && requestLike.url ? requestLike.url : String(input || '');
        const method = String(config.method || requestLike && requestLike.method || 'GET').toUpperCase();
        const headers = {
          ...headersObject(requestLike && requestLike.headers),
          ...headersObject(config.headers),
        };
        const meta = { url, method, headers, transport: 'fetch', internal: false };
        const hasInitBody = Object.prototype.hasOwnProperty.call(config, 'body');
        const body = hasInitBody ? config.body : null;
        if (
          typeof body === 'string' ||
          body instanceof URLSearchParams ||
          (typeof FormData !== 'undefined' && body instanceof FormData)
        ) {
          captureTemplateRequest(meta, body);
        } else if (body && typeof body.text === 'function') {
          body.text().then((text) => captureTemplateRequest(meta, text)).catch(() => {});
        } else if (!hasInitBody && requestLike && typeof requestLike.clone === 'function') {
          requestLike.clone().text().then((text) => captureTemplateRequest(meta, text)).catch(() => {});
        } else {
          captureTemplateRequest(meta, body);
        }
      } catch (error) {}
      return originalFetch.apply(this, arguments);
    };
  }

  function post(type, requestId, detail) {
    window.postMessage({
      source: 'wxt-report-page-hook',
      type,
      requestId,
      ...detail,
    }, location.origin);
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitForTemplates(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (templates.accountQuery && templates.charge) return;
      await delay(250);
    }
    throw new Error('报表接口尚未就绪，请等待营销场景报表加载完成后重试。');
  }

  async function waitForShortVideoTemplates(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (templates.shortVideoDetailQuery) return;
      await delay(250);
    }
    throw new Error('短视频报表接口尚未就绪，请等待数据明细加载完成后重试。');
  }

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function wrapTemplateData(template, data) {
    const path = Array.isArray(template && template.dataPath) ? template.dataPath : [];
    if (!path.length) return data;
    const root = cloneData(template.requestData);
    let cursor = root;
    for (let index = 0; index < path.length - 1; index += 1) {
      const key = path[index];
      if (!cursor[key] || typeof cursor[key] !== 'object') {
        cursor[key] = typeof path[index + 1] === 'number' ? [] : {};
      }
      cursor = cursor[key];
    }
    cursor[path[path.length - 1]] = data;
    return root;
  }

  function stripPaging(data) {
    [
      'byPage',
      'pageNum',
      'pageNo',
      'pageSize',
      'page',
      'pageIndex',
      'current',
      'currentPage',
      'offset',
      'pageOffset',
      'start',
      'startIndex',
      'limit',
      'totalTag',
      'needCountAccelerate',
      'orderBy',
      'orderType',
    ].forEach((key) => delete data[key]);
    return data;
  }

  function buildMarketingSceneBody(startTime, endTime, unifyType) {
    const sourceTemplate = templates.sceneQuery || templates.accountQuery;
    const data = stripPaging(cloneData(sourceTemplate.data));
    Object.assign(data, {
      bizCode: 'universalBP',
      rptType: 'account',
      source: 'baseReport',
      effectEqual: 15,
      splitType: 'day',
      unifyType: unifyType || 'zhai',
      startTime,
      endTime,
      queryDomains: ['scene'],
      queryFieldIn: MARKETING_FIELDS,
      byPage: true,
      pageNum: 1,
      pageSize: 100,
      totalTag: true,
      needCountAccelerate: true,
    });
    return data;
  }

  function buildChargeBody(startTime, endTime) {
    const data = cloneData(templates.charge.data);
    Object.assign(data, {
      bizCode: 'universalBP',
      rptType: 'account',
      source: 'baseReport',
      effectEqual: 15,
      splitType: 'day',
      unifyType: 'zhai',
      startTime,
      endTime,
    });
    return data;
  }

  function buildShortVideoBody(startTime, endTime, attribution, queryDomains) {
    const sourceTemplate = templates.shortVideoAccountQuery || templates.accountQuery;
    const data = stripPaging(cloneData(sourceTemplate.data));
    const domains = Array.isArray(queryDomains) && queryDomains.length
      ? queryDomains
      : ['account'];
    Object.assign(data, {
      bizCode: 'onebpShortVideo',
      rptType: 'short_video_migrate',
      source: 'baseReport',
      effectEqual: 15,
      splitType: 'day',
      unifyType: attribution === 'display' ? 'video_kuan' : 'zhai',
      shortVideoCampaignType: 'all',
      strategyPromotionSceneIn: SHORT_VIDEO_SCENES,
      startTime,
      endTime,
      queryDomains: domains,
      queryFieldIn: SHORT_VIDEO_ACCOUNT_FIELDS,
    });
    if (domains.includes('campaign')) {
      Object.assign(data, {
        byPage: true,
        pageNum: 1,
        pageSize: 100,
        totalTag: true,
        needCountAccelerate: true,
      });
    }
    return data;
  }

  function buildShortVideoDetailBody(
    startTime,
    endTime,
    attribution,
    level,
    includeConfigFields,
    queryDomainsOverride
  ) {
    const sourceTemplate = templates.shortVideoDetailQuery || templates.shortVideoAccountQuery || templates.accountQuery;
    const data = stripPaging(cloneData(sourceTemplate.data));
    const parsedNativeDomains = parseStructuredValue(sourceTemplate.data.queryDomains);
    const nativeDomains = Array.isArray(parsedNativeDomains)
      ? parsedNativeDomains
      : [parsedNativeDomains];
    const subjectDomains = Array.from(new Set(nativeDomains
      .map((domain) => String(domain || '').trim())
      .filter((domain) => (
        domain &&
        !['account', 'date', 'campaign'].includes(domain)
      ))));
    const parsedNativeFields = parseStructuredValue(sourceTemplate.data.queryFieldIn);
    const nativeFields = Array.isArray(parsedNativeFields)
      ? parsedNativeFields
      : [parsedNativeFields];
    const configFieldKeys = new Set(
      SHORT_VIDEO_CONFIG_FIELDS.map((field) => normalizedFieldKey(field))
    );
    const nativeConfigFields = Array.from(new Set(nativeFields
      .map((field) => String(field || '').trim())
      .filter((field) => field && configFieldKeys.has(normalizedFieldKey(field)))));
    const configQueryFields = nativeConfigFields.length
      ? nativeConfigFields
      : SHORT_VIDEO_CONFIG_QUERY_FIELDS;
    Object.assign(data, {
      bizCode: 'onebpShortVideo',
      rptType: 'short_video_migrate',
      source: 'baseReport',
      effectEqual: 15,
      splitType: 'day',
      unifyType: attribution === 'display' ? 'video_kuan' : 'zhai',
      shortVideoCampaignType: 'all',
      strategyPromotionSceneIn: SHORT_VIDEO_SCENES,
      startTime,
      endTime,
      // “主体”在不同账号/版本中并不一定叫 promotion。必须沿用页面原生
      // 勾选“计划、主体”时的维度，否则 promotion 会退化成推广单元。
      queryDomains: Array.isArray(queryDomainsOverride) && queryDomainsOverride.length
        ? queryDomainsOverride
        : (
            level === 'plan'
              ? ['campaign']
              : ['campaign', ...(subjectDomains.length ? subjectDomains : ['promotion'])]
          ),
      queryFieldIn: Array.from(new Set([
        ...(includeConfigFields === false ? [] : configQueryFields),
        ...SHORT_VIDEO_DETAIL_FIELDS,
      ])),
      byPage: true,
      pageNum: 1,
      pageSize: 100,
      totalTag: true,
      needCountAccelerate: true,
    });
    return data;
  }

  function executeRequest(template, data) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.__wxtInternalRequest = true;
      const method = String(template.method || 'POST').toUpperCase();
      const requestData = wrapTemplateData(template, data);
      let requestUrl = template.url;
      try {
        const url = new URL(requestUrl, location.href);
        const bizCode = readReportField(data, ['bizCode']);
        const reportType = readReportField(data, ['rptType', 'reportType']);
        if (bizCode !== undefined && bizCode !== null && bizCode !== '') {
          url.searchParams.set('bizCode', String(bizCode));
        }
        if (url.searchParams.has('rptType') && reportType !== undefined &&
            reportType !== null && reportType !== '') {
          url.searchParams.set('rptType', String(reportType));
        }
        requestUrl = url.toString();
      } catch (error) {}
      if (method === 'GET') {
        const url = new URL(requestUrl, location.href);
        Object.entries(requestData || {}).forEach(([key, value]) => {
          if (value === undefined) return;
          url.searchParams.set(
            key,
            value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
          );
        });
        requestUrl = url.toString();
      }
      originalOpen.call(xhr, method, requestUrl, true);
      xhr.withCredentials = true;
      xhr.timeout = 30000;

      const headers = template.headers || {};
      let hasContentType = false;
      let hasRequestedWith = false;
      Object.entries(headers).forEach(([name, value]) => {
        const normalized = name.toLowerCase();
        if (normalized === 'content-length' || normalized === 'host' || normalized === 'cookie') return;
        if (normalized === 'content-type') hasContentType = true;
        if (normalized === 'x-requested-with') hasRequestedWith = true;
        try {
          originalSetRequestHeader.call(xhr, name, value);
        } catch (error) {}
      });
      if (!hasContentType) {
        originalSetRequestHeader.call(
          xhr,
          'Content-Type',
          template.kind === 'json'
            ? 'application/json;charset=UTF-8'
            : 'application/x-www-form-urlencoded;charset=UTF-8'
        );
      }
      if (!hasRequestedWith) {
        originalSetRequestHeader.call(xhr, 'X-Requested-With', 'XMLHttpRequest');
      }

      xhr.onload = () => {
        let response;
        try {
          response = JSON.parse(xhr.responseText || '{}');
        } catch (error) {
          reject(new Error('万相台接口返回了无法解析的数据。'));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error('万相台接口请求失败（HTTP ' + xhr.status + '）。'));
          return;
        }
        if (response.info && response.info.ok === false) {
          reject(new Error(response.info.message || response.info.errorMsg || '万相台接口返回失败。'));
          return;
        }
        resolve(response.data || {});
      };
      xhr.onerror = () => reject(new Error('万相台接口网络请求失败。'));
      xhr.ontimeout = () => reject(new Error('万相台接口请求超时。'));
      originalSend.call(
        xhr,
        method === 'GET' ? undefined : serializeRequestBody(requestData, template.kind)
      );
    });
  }

  function safeNumber(value, depth) {
    const level = Number(depth || 0);
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean') return null;
    if (Array.isArray(value)) {
      if (level >= 4 || value.length !== 1) return null;
      return safeNumber(value[0], level + 1);
    }
    if (typeof value === 'object') {
      if (level >= 4) return null;
      for (const key of METRIC_VALUE_KEYS) {
        if (value[key] === undefined || value[key] === null || value[key] === '') continue;
        const number = safeNumber(value[key], level + 1);
        if (number !== null) return number;
      }
      for (const [key, child] of Object.entries(value)) {
        if (!METRIC_VALUE_KEY_SET.has(normalizedFieldKey(key))) continue;
        const number = safeNumber(child, level + 1);
        if (number !== null) return number;
      }
      return null;
    }

    let text = String(value).trim();
    if (!text || /^(?:--?|—|暂无|无数据|null|undefined)$/i.test(text)) return null;
    if (
      (text.startsWith('{') && text.endsWith('}')) ||
      (text.startsWith('[') && text.endsWith(']'))
    ) {
      try {
        return safeNumber(JSON.parse(text), level + 1);
      } catch (error) {}
    }
    const isPercent = /[%％]$/.test(text);
    let multiplier = 1;
    if (/亿$/.test(text)) multiplier = 100000000;
    else if (/万$/.test(text)) multiplier = 10000;
    else if (/千$/.test(text)) multiplier = 1000;
    text = text
      .replace(/[,，\s¥￥]/g, '')
      .replace(/[%％]$/, '')
      .replace(/[亿万千]$/, '')
      .replace(/[倍xX]$/, '');
    const number = Number(text);
    if (!Number.isFinite(number)) return null;
    return number * multiplier / (isPercent ? 100 : 1);
  }

  function metricAliasSet(key) {
    return new Set((METRIC_ALIASES[key] || [key]).map(normalizedFieldKey));
  }

  function readMetricValue(record, key) {
    const aliases = metricAliasSet(key);
    const seen = new Set();
    const visit = (value, depth) => {
      if (value === null || value === undefined || depth > 5) return null;
      if (typeof value !== 'object') return null;
      if (seen.has(value)) return null;
      seen.add(value);

      if (Array.isArray(value)) {
        for (const item of value.slice(0, 10)) {
          const number = visit(item, depth + 1);
          if (number !== null) return number;
        }
        return null;
      }

      for (const [field, child] of Object.entries(value)) {
        if (!aliases.has(normalizedFieldKey(field))) continue;
        const number = safeNumber(child);
        if (number !== null) return number;
      }

      const descriptor = METRIC_DESCRIPTOR_KEYS
        .map((field) => value[field])
        .find((field) => field !== undefined && field !== null && field !== '');
      if (descriptor !== undefined && aliases.has(normalizedFieldKey(descriptor))) {
        const number = safeNumber(value);
        if (number !== null) return number;
      }

      const children = Object.entries(value)
        .filter((entry) => entry[1] && typeof entry[1] === 'object')
        .sort((left, right) => (
          Number(METRIC_CONTAINER_KEYS.has(normalizedFieldKey(right[0]))) -
          Number(METRIC_CONTAINER_KEYS.has(normalizedFieldKey(left[0])))
        ));
      for (const [, child] of children) {
        const number = visit(child, depth + 1);
        if (number !== null) return number;
      }
      return null;
    };
    return visit(record, 0);
  }

  function safeTextValue(value, depth) {
    const level = Number(depth) || 0;
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return String(value).trim();
    if (level > 3) return '';
    for (const key of ['text', 'label', 'title', 'name', 'absolute', 'value', 'currentValue']) {
      if (value[key] === undefined || value[key] === null) continue;
      const text = typeof value[key] === 'object'
        ? safeTextValue(value[key], level + 1)
        : String(value[key]).trim();
      if (text) return text;
    }
    return '';
  }

  function readTextValue(record, aliases) {
    const source = record && typeof record === 'object' ? record : {};
    for (const alias of aliases) {
      const normalizedAlias = normalizedFieldKey(alias);
      const seen = new Set();
      const visit = (value, depth) => {
        if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return '';
        seen.add(value);
        for (const [key, child] of Object.entries(value)) {
          if (normalizedFieldKey(key) !== normalizedAlias) continue;
          const text = safeTextValue(child);
          if (text) return text;
        }
        for (const child of Object.values(value)) {
          if (!child || typeof child !== 'object') continue;
          const text = visit(child, depth + 1);
          if (text) return text;
        }
        return '';
      };
      const text = visit(source, 0);
      if (text) return text;
    }
    return '';
  }

  function visibleShortVideoRoi() {
    const readNodeText = (node) => String(
      node && (node.innerText || node.textContent) || ''
    ).trim();
    const roiHeaderKeys = new Set([
      'roi',
      '投入产出比',
      '投产比',
      '总成交roi',
      '总成交投产比',
    ]);
    const roiFieldKeys = new Set([
      'roi',
      'totalroi',
      'alipayinshoproi',
      'alipayroi',
      'transactionroi',
      'totaltransactionroi',
      'inputoutputratio',
    ]);
    const tables = Array.from(document.querySelectorAll('table'));
    for (const table of tables) {
      const headerCells = Array.from(table.querySelectorAll('thead th'));
      const roiIndex = headerCells.findIndex((cell) => (
        roiHeaderKeys.has(normalizedFieldKey(readNodeText(cell)))
      ));
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      for (const row of rows) {
        if (!readNodeText(row).replace(/\s+/g, '').includes('超级短视频')) continue;
        const directCell = Array.from(row.querySelectorAll(
          '[data-field], [data-col-key], [data-column-key]'
        )).find((cell) => {
          const field = cell.getAttribute('data-field') ||
            cell.getAttribute('data-col-key') ||
            cell.getAttribute('data-column-key');
          return roiFieldKeys.has(normalizedFieldKey(field));
        });
        const directValue = safeNumber(readNodeText(directCell));
        if (directValue !== null) return directValue;
        if (roiIndex < 0) continue;
        const cells = Array.from(row.querySelectorAll('td'));
        const value = safeNumber(readNodeText(cells[roiIndex]));
        if (value !== null) return value;
      }
    }
    return null;
  }

  function visibleShortVideoPotentialRatio() {
    const labels = new Set([
      '引导访问潜客占比',
      '引导访问潜客比例',
      '潜客占比',
      '潜客比',
    ].map(normalizedFieldKey));
    const inlineRatio = value => {
      const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
      if (text.length > 180) return null;
      const match = text.match(
        /(?:引导访问潜客占比|引导访问潜客比例|潜客占比|潜客比)[^\d%-]{0,30}(-?\d[\d,]*(?:\.\d+)?)\s*[%％]/
      );
      return safeNumber(match && match[1] ? match[1] + '%' : null);
    };
    const nodes = Array.from(document.querySelectorAll('span, div, th, td'));
    for (const node of nodes) {
      const label = String(node && (node.innerText || node.textContent) || '').trim();
      const directRatio = inlineRatio(label);
      if (directRatio !== null) return directRatio;
      if (!labels.has(normalizedFieldKey(label))) continue;
      let container = node;
      for (let depth = 0; container && depth < 5; depth += 1) {
        const text = String(container.innerText || container.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();
        const labelledRatio = inlineRatio(text);
        if (labelledRatio !== null) return labelledRatio;
        if (text.length <= 180) {
          const match = text.match(/-?\d[\d,]*(?:\.\d+)?\s*[%％]/);
          const value = safeNumber(match && match[0]);
          if (value !== null) return value;
        }
        container = container.parentElement;
      }
    }
    return null;
  }

  function safeMetricRecord(record, includeName) {
    const source = record && typeof record === 'object' ? record : {};
    const result = {};
    if (includeName) {
      result.scene1Name = readTextValue(source, [
        'scene1Name',
        'sceneName',
        'marketingSceneName',
        'sceneLabel',
        'sceneTitle',
        'bizName',
        'name',
      ]);
    }
    SAFE_METRIC_FIELDS.forEach((key) => {
      result[key] = readMetricValue(source, key);
    });
    if (result.ctr === null) result.ctr = safeDivide(result.click, result.adPv);
    if (result.cartRate === null) result.cartRate = safeDivide(result.cartInshopNum, result.click);
    if (result.cvr === null) result.cvr = safeDivide(result.alipayInshopNum, result.click);
    if (result.roi === null) result.roi = safeDivide(result.alipayInshopAmt, result.charge);
    if (result.inshopPotentialUvRate === null) {
      result.inshopPotentialUvRate = safeDivide(result.inshopPotentialUv, result.inshopUv);
    }
    return result;
  }

  function summaryMetricRecord(data) {
    const source = data && typeof data === 'object' ? data : {};
    const candidates = [];
    const append = (value, priority) => {
      const records = Array.isArray(value) ? value.slice(0, 5) : [value];
      records.forEach((record) => {
        if (!record || typeof record !== 'object') return;
        candidates.push({ record: safeMetricRecord(record, false), priority });
      });
    };
    append(source.totalData, 50);
    append(source.total, 45);
    append(source.summary, 40);
    append(source.list, 30);
    append(source.rows, 25);
    append(source.records, 20);
    append(source.items, 15);
    append(source.result, 10);
    append(source, 0);
    const score = (candidate) => {
      const record = candidate.record;
      const populated = SAFE_METRIC_FIELDS.reduce((count, key) => (
        count + (record[key] === null ? 0 : 1)
      ), 0);
      return populated * 100 +
        (record.roi === null ? 0 : 20) +
        (record.inshopPotentialUvRate === null ? 0 : 10) +
        candidate.priority;
    };
    return candidates.sort((left, right) => score(right) - score(left))[0]?.record ||
      safeMetricRecord({}, false);
  }

  function reportRecordCollection(data, aliases) {
    const aliasSet = new Set(aliases.map(normalizedFieldKey));
    const seen = new Set();
    const visit = (value, depth) => {
      if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return [];
      seen.add(value);
      if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
      for (const [key, child] of Object.entries(value)) {
        if (!aliasSet.has(normalizedFieldKey(key))) continue;
        if (Array.isArray(child)) return child.filter((item) => item && typeof item === 'object');
        if (child && typeof child === 'object') return [child];
      }
      const containers = ['data', 'result', 'pageData', 'reportData', 'payload'];
      for (const key of containers) {
        if (!value[key] || typeof value[key] !== 'object') continue;
        const records = visit(value[key], depth + 1);
        if (records.length) return records;
      }
      return [];
    };
    return visit(data, 0);
  }

  function firstSafeNumber() {
    for (let index = 0; index < arguments.length; index += 1) {
      const number = safeNumber(arguments[index]);
      if (number !== null) return number;
    }
    return null;
  }

  function readByAliases(source, aliases) {
    for (const key of aliases) {
      if (source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
    }
    return '';
  }

  const VIDEO_IDENTITY_KEYS = new Set([
    'videoid',
    'promotionid',
    'subjectid',
    'entityid',
    'contentid',
    'feedid',
    'resourceid',
    'materialid',
    'creativeid',
    'workid',
  ]);

  function normalizedFieldKey(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  }

  function rawIdentityScalar(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of ['absolute', 'value', 'currentValue', 'indicatorValue', 'metricValue', 'id']) {
        if (value[key] !== undefined && value[key] !== null && value[key] !== '') {
          return rawIdentityScalar(value[key]);
        }
      }
      return '';
    }
    const text = String(value == null ? '' : value).trim().replace(/\.0+$/, '');
    return /^[a-z0-9_-]{3,100}$/i.test(text) ? text : '';
  }

  function parseEmbeddedStructuredValue(value) {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (
      !text ||
      !(
        (text.startsWith('{') && text.endsWith('}')) ||
        (text.startsWith('[') && text.endsWith(']'))
      )
    ) {
      return null;
    }
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function isVideoIdentityPath(path) {
    const parts = String(path || '').split('.');
    const leaf = normalizedFieldKey(parts[parts.length - 1]);
    if (VIDEO_IDENTITY_KEYS.has(leaf) || /^(?:视频|作品|内容)(?:主体)?id$/i.test(leaf)) {
      return true;
    }
    if (leaf !== 'id') return false;
    return parts.slice(0, -1).some((part) => {
      const key = normalizedFieldKey(part);
      return /video|promotion|subject|entity|content|feed|resource|material|creative|work/.test(key) ||
        /视频|作品|内容|主体|素材/.test(key);
    });
  }

  function collectVideoIdentityEntries(source) {
    const entries = [];
    const seen = new Set();
    const visit = (value, path, depth) => {
      if (depth > 5 || entries.length >= 80 || value == null) return;
      const embedded = parseEmbeddedStructuredValue(value);
      if (embedded) {
        visit(embedded, path ? path + '.$json' : '$json', depth + 1);
        return;
      }
      if (Array.isArray(value)) {
        value.slice(0, 10).forEach((item, index) => visit(item, path + '[' + index + ']', depth + 1));
        return;
      }
      if (typeof value === 'object') {
        Object.entries(value).forEach(([key, child]) => {
          const childPath = path ? path + '.' + key : key;
          if (isVideoIdentityPath(childPath)) {
            const scalar = rawIdentityScalar(child);
            const signature = childPath + '\u0000' + scalar;
            if (scalar && !seen.has(signature)) {
              seen.add(signature);
              entries.push({ field: childPath, value: scalar });
            }
          }
          visit(child, childPath, depth + 1);
        });
      }
    };
    visit(source, '', 0);
    return entries;
  }

  function collectVideoTitleEntries(source) {
    const entries = [];
    const seen = new Set();
    const exactKeys = new Set([
      'videoinfo',
      'videoname',
      'videotitle',
      'subjectname',
      'entityname',
      'contentname',
      'contenttitle',
      'feedname',
      'resourcename',
      'materialname',
      'creativename',
      'promotionname',
      'promotiontitle',
      'title',
      'name',
    ]);
    const visit = (value, path, depth) => {
      if (depth > 5 || entries.length >= 40 || value == null) return;
      const embedded = parseEmbeddedStructuredValue(value);
      if (embedded) {
        visit(embedded, path ? path + '.$json' : '$json', depth + 1);
        return;
      }
      if (Array.isArray(value)) {
        value.slice(0, 10).forEach((item, index) => visit(item, path + '[' + index + ']', depth + 1));
        return;
      }
      if (typeof value === 'object') {
        Object.entries(value).forEach(([key, child]) => {
          const childPath = path ? path + '.' + key : key;
          const normalized = normalizedFieldKey(key);
          const genericTitle = normalized === 'title' || normalized === 'name';
          const embeddedChild = parseEmbeddedStructuredValue(child);
          const semanticPath = /video|promotion|subject|entity|content|feed|resource|material|creative|work|作品|内容|视频|素材/i.test(childPath) &&
            !/items?(?:\.|\[)|itemlist|商品/i.test(childPath);
          if (
            exactKeys.has(normalized) &&
            (!genericTitle || semanticPath) &&
            typeof child !== 'object' &&
            !embeddedChild
          ) {
            const text = String(child == null ? '' : child).trim();
            const signature = childPath + '\u0000' + text;
            if (text && !/^\d+$/.test(text) && text.length <= 500 && !seen.has(signature)) {
              seen.add(signature);
              entries.push({ field: childPath, value: text });
            }
          }
          visit(child, childPath, depth + 1);
        });
      }
    };
    visit(source, '', 0);
    return entries;
  }

  function preferredVideoIdentity(entries) {
    const score = (field) => {
      const key = normalizedFieldKey(field);
      if (/videoid|视频id/.test(key)) return 100;
      if (/subjectid|主体id/.test(key)) return 95;
      if (/contentid|作品id|内容id/.test(key)) return 90;
      if (/entityid|workid|feedid|resourceid/.test(key)) return 80;
      if (/materialid|creativeid/.test(key)) return 70;
      if (/promotionid/.test(key)) return 20;
      return 0;
    };
    return (entries || []).slice().sort((left, right) => (
      score(right.field) - score(left.field)
    ))[0] || null;
  }

  function preferredVideoTitle(entries) {
    const score = (field) => {
      const key = normalizedFieldKey(field);
      if (/videoinfo|videoname|videotitle|视频/.test(key)) return 100;
      if (/subjectname|主体/.test(key)) return 95;
      if (/contentname|contenttitle|作品|内容/.test(key)) return 90;
      if (/entityname|feedname|resourcename|work/.test(key)) return 80;
      if (/materialname|creativename|素材/.test(key)) return 70;
      if (/promotionname|promotiontitle/.test(key)) return 20;
      return 0;
    };
    return (entries || []).slice().sort((left, right) => (
      score(right.field) - score(left.field)
    ))[0] || null;
  }

  function shortVideoConfigValue(source, aliases) {
    const recursiveText = readTextValue(source, aliases);
    if (recursiveText) return recursiveText;
    return safeTextValue(readByAliases(source, aliases));
  }

  function safeShortVideoDetailRecord(record) {
    const source = record && typeof record === 'object' ? record : {};
    const result = {};
    const identityEntries = collectVideoIdentityEntries(source);
    const titleEntries = collectVideoTitleEntries(source);
    SAFE_SHORT_VIDEO_IDENTITY_FIELDS.forEach((key) => {
      if (source[key] !== undefined && source[key] !== null) result[key] = source[key];
    });
    SHORT_VIDEO_CONFIG_FIELDS.forEach((key) => {
      if (source[key] !== undefined && source[key] !== null) result[key] = source[key];
    });
    result.campaignId = shortVideoConfigValue(source, [
      'campaignId',
      'campaign_id',
      'planId',
      'planID',
    ]);
    result.campaignName = shortVideoConfigValue(source, [
      'campaignName',
      'campaign_name',
      'planName',
      'planTitle',
    ]);
    result.solutionName = shortVideoConfigValue(source, [
      'shortVideoPromotionSceneName',
      'shortVideoPromotionSceneLabel',
      'shortVideoPromotionScene',
      'promotionSceneName',
      'promotionScene',
      'campaignSceneName',
      'strategyPromotionSceneName',
      'strategyPromotionScene',
      'solutionName',
      'solution',
      'solutionTypeName',
      'solutionType',
      'launchSolutionName',
      'launchSolution',
      'campaignSolutionName',
      'campaignSolution',
      'marketingSolutionName',
      'marketingSolution',
      'sceneSolutionName',
      'sceneSolution',
      '解决方案',
    ]);
    result.optimizationTarget = shortVideoConfigValue(source, [
      'shortVideoOptimizeTargetName',
      'shortVideoOptimizeTargetLabel',
      'shortVideoOptimizeTarget',
      'optimizationTargetName',
      'optimizationTarget',
      'optimizeTargetName',
      'optimizeTarget',
      'optimizeTargetTypeName',
      'optimizeTargetType',
      'optimizeGoalName',
      'optimizeGoal',
      'optimizationGoalName',
      'optimizationGoal',
      'marketingTargetName',
      'marketingTarget',
      'promotionGoalName',
      'promotionGoal',
      'campaignGoalName',
      'campaignGoal',
      'targetName',
      'target',
      '优化目标',
    ]);
    result.bidMode = shortVideoConfigValue(source, [
      'shortVideoBidTypeName',
      'shortVideoBidTypeLabel',
      'shortVideoBidType',
      'bidModeName',
      'bidMode',
      'bidTypeName',
      'bidType',
      'biddingStrategyName',
      'biddingStrategy',
      'bidStrategyName',
      'bidStrategy',
      'ocpcTypeName',
      'ocpcType',
      'chargeTypeName',
      'chargeType',
      'priceTypeName',
      'priceType',
      'bidWayName',
      'bidWay',
      'deliveryModeName',
      'deliveryMode',
      'deliveryTypeName',
      'deliveryType',
      'putTypeName',
      'putType',
      'putWayName',
      'putWay',
      '出价方式',
    ]);
    result.promotionName = shortVideoConfigValue(source, [
      'promotionName',
      'adgroupName',
      'unitName',
      'promotion_name',
    ]);
    const directVideoId = readByAliases(source, [
      'videoId',
      'videoID',
      'subjectId',
      'entityId',
      'contentId',
      'feedId',
      'resourceId',
      'materialId',
      'creativeId',
    ]);
    const preferredIdentity = preferredVideoIdentity(identityEntries);
    result.videoId = rawIdentityScalar(directVideoId) ||
      (preferredIdentity ? preferredIdentity.value : '');
    const directVideoInfo = readByAliases(source, [
      'videoInfo',
      'videoName',
      'videoTitle',
      'subjectName',
      'entityName',
      'contentName',
      'feedName',
      'resourceName',
      'materialName',
      'creativeName',
    ]);
    const embeddedVideoInfo = parseEmbeddedStructuredValue(directVideoInfo);
    const directVideoTitle = !embeddedVideoInfo && typeof directVideoInfo !== 'object'
      ? String(directVideoInfo == null ? '' : directVideoInfo).trim()
      : '';
    const preferredTitle = preferredVideoTitle(titleEntries);
    result.videoInfo = directVideoTitle || (preferredTitle ? preferredTitle.value : '');
    result.__identityEntries = identityEntries;
    result.__titleEntries = titleEntries;
    SHORT_VIDEO_DETAIL_FIELDS.forEach((key) => {
      result[key] = safeNumber(source[key]);
    });
    return result;
  }

  const SHORT_VIDEO_PLAN_ADDITIVE_FIELDS = [
    'charge',
    'adPv',
    'click',
    'feedViewNum',
    'makeCharge',
    'cartInshopNum',
    'inshopPv',
    'inshopUv',
    'inshopPotentialUv',
    'alipayInshopNum',
    'alipayInshopAmt',
    'alipayDirAmt',
    'alipayInshopUv',
    'newAlipayInshopUv',
    'liveVideoNewUv',
    'newInshopUv',
    'displayNewCharge',
    'displayNewInshopAmt',
    'firstPurchaseUv',
  ];

  function safeDivide(numerator, denominator, multiplier) {
    const top = safeNumber(numerator);
    const bottom = safeNumber(denominator);
    if (top === null || bottom === null || bottom === 0) return null;
    return top / bottom * (multiplier || 1);
  }

  function aggregatePlanRowsFromVideos(videoRows) {
    const groups = new Map();
    (Array.isArray(videoRows) ? videoRows : []).forEach((row, index) => {
      const campaignId = String(row && row.campaignId || '').trim();
      const campaignName = String(row && row.campaignName || '').trim();
      const key = campaignId || campaignName || ('unknown-' + index);
      if (!groups.has(key)) {
        const aggregate = { ...row };
        [
          'videoId',
          'videoInfo',
          'promotionId',
          'promotionName',
          'adgroupId',
          'adgroupName',
          'unitId',
          'unitName',
          'subjectId',
          'subjectName',
          'entityId',
          'entityName',
          'materialId',
          'materialName',
          'creativeId',
          'creativeName',
          'contentId',
          'contentName',
        ].forEach(field => { delete aggregate[field]; });
        SHORT_VIDEO_DETAIL_FIELDS.forEach(field => { aggregate[field] = null; });
        aggregate.__metricCounts = {};
        groups.set(key, aggregate);
      }
      const aggregate = groups.get(key);
      SHORT_VIDEO_PLAN_ADDITIVE_FIELDS.forEach((field) => {
        const value = safeNumber(row && row[field]);
        if (value === null) return;
        aggregate[field] = (safeNumber(aggregate[field]) || 0) + value;
        aggregate.__metricCounts[field] = (aggregate.__metricCounts[field] || 0) + 1;
      });
    });

    return Array.from(groups.values()).map((row) => {
      const result = { ...row };
      delete result.__metricCounts;
      result.ctr = safeDivide(result.click, result.adPv);
      result.ecpc = safeDivide(result.charge, result.click);
      result.ecpm = safeDivide(result.charge, result.adPv, 1000);
      result.roi = safeDivide(result.alipayInshopAmt, result.charge);
      result.cvr = safeDivide(result.alipayInshopNum, result.click);
      result.alipayInshopCost = safeDivide(result.charge, result.alipayInshopNum);
      result.itemColCartRate = safeDivide(result.cartInshopNum, result.click);
      result.cartRate = result.itemColCartRate;
      result.cartCost = safeDivide(result.charge, result.cartInshopNum);
      result.inshopPotentialUvRate = safeDivide(result.inshopPotentialUv, result.inshopUv);
      result.newAlipayInshopUvRate = safeDivide(result.newAlipayInshopUv, result.alipayInshopUv);
      result.liveVideoNewCost = safeDivide(result.charge, result.liveVideoNewUv);
      result.displayNewRoi = safeDivide(result.displayNewInshopAmt, result.displayNewCharge);
      result.displayNewChargeRate = safeDivide(result.displayNewCharge, result.charge);
      result.firstNewCustomerCost = safeDivide(result.charge, result.firstPurchaseUv);
      return result;
    });
  }

  function backfillShortVideoConfig(result) {
    const fields = ['solutionName', 'optimizationTarget', 'bidMode'];
    const configByCampaign = new Map();
    const blocks = ['plan', 'video'].flatMap((level) => (
      ['click', 'display'].map((attribution) => result[level] && result[level][attribution])
    )).filter(Boolean);
    const rowKey = (row) => String(
      row && (row.campaignId || row.campaignName) || ''
    ).trim();
    const hasValue = (value) => {
      const text = String(value == null ? '' : value).trim();
      return Boolean(text && text !== '-');
    };

    blocks.forEach((block) => {
      (Array.isArray(block.rows) ? block.rows : []).forEach((row) => {
        const key = rowKey(row);
        if (!key) return;
        if (!configByCampaign.has(key)) configByCampaign.set(key, {});
        const config = configByCampaign.get(key);
        fields.forEach((field) => {
          if (!hasValue(config[field]) && hasValue(row[field])) config[field] = row[field];
        });
      });
    });

    blocks.forEach((block) => {
      const apply = (row) => {
        const config = configByCampaign.get(rowKey(row));
        if (!config) return;
        fields.forEach((field) => {
          if (!hasValue(row[field]) && hasValue(config[field])) row[field] = config[field];
        });
      };
      (Array.isArray(block.rows) ? block.rows : []).forEach(apply);
      if (block.total) apply(block.total);
    });
    return result;
  }

  function safeSpendSummary(data) {
    const root = data && typeof data === 'object' ? data : {};
    const source = Array.isArray(root.list) && root.list[0]
      ? { ...root, ...root.list[0] }
      : root;
    return {
      totalCharge: readMetricValue(source, 'totalCharge'),
      searchCharge: readMetricValue(source, 'searchCharge'),
      displayCharge: readMetricValue(source, 'displayCharge'),
      contentSceneCharge: readMetricValue(source, 'contentSceneCharge'),
      shortVideoCharge: readMetricValue(source, 'shortVideoCharge'),
      onebpSiteCharge: readMetricValue(source, 'onebpSiteCharge'),
      siteSceneCharge: readMetricValue(source, 'siteSceneCharge'),
    };
  }

  async function collectReport(requestId, startTime, endTime) {
    await waitForTemplates(15000);
    post(PROGRESS_TYPE, requestId, { message: '正在读取营销场景明细…' });
    const marketingTemplate = templates.sceneQuery || templates.accountQuery;
    const marketing = await executeRequest(
      marketingTemplate,
      buildMarketingSceneBody(startTime, endTime)
    );

    await delay(500);
    post(PROGRESS_TYPE, requestId, { message: '正在读取场景花费汇总…' });
    const spend = await executeRequest(
      templates.charge,
      buildChargeBody(startTime, endTime)
    );

    const marketingRows = reportRecordCollection(marketing, ['list', 'rows', 'records', 'items'])
      .slice(0, 100)
      .map((row) => safeMetricRecord(row, true));
    const marketingTotalRecord = reportRecordCollection(marketing, [
      'totalData',
      'totals',
      'summary',
      'total',
    ])[0] || null;
    const shortVideoScene = marketingRows.find((row) => (
      String(row.scene1Name || '').replace(/\s+/g, '').includes('超级短视频')
    )) || marketingRows.find((row) => (
      String(row.scene1Name || '').replace(/\s+/g, '').includes('短视频')
    )) || {};
    const visibleLastClickRoi = visibleShortVideoRoi();

    let shortVideoClick = {};
    let shortVideoDisplay = {};
    await delay(500);
    post(PROGRESS_TYPE, requestId, { message: '正在读取超级短视频点击归因数据…' });
    const shortVideoTemplate = templates.shortVideoAccountQuery || templates.accountQuery;
    shortVideoClick = await executeRequest(
      shortVideoTemplate,
      buildShortVideoBody(startTime, endTime, 'click')
    );

    await delay(500);
    post(PROGRESS_TYPE, requestId, { message: '正在读取超级短视频展现归因数据…' });
    shortVideoDisplay = await executeRequest(
      shortVideoTemplate,
      buildShortVideoBody(startTime, endTime, 'display')
    );

    const clickSummary = summaryMetricRecord(shortVideoClick);
    let displaySummary = summaryMetricRecord(shortVideoDisplay);
    const lastClickRoi = firstSafeNumber(
      shortVideoScene.roi,
      visibleLastClickRoi,
      clickSummary.roi,
      safeDivide(clickSummary.alipayInshopAmt, clickSummary.charge)
    );
    const displayRoi = firstSafeNumber(
      displaySummary.roi,
      safeDivide(displaySummary.alipayInshopAmt, displaySummary.charge)
    );
    let displayPotentialRatio = firstSafeNumber(
      displaySummary.inshopPotentialUvRate,
      safeDivide(displaySummary.inshopPotentialUv, displaySummary.inshopUv)
    );
    let displayPotentialRatioSource = displayPotentialRatio === null
      ? ''
      : 'shortVideoAccountApi';

    if (displayPotentialRatio === null) {
      displayPotentialRatio = visibleShortVideoPotentialRatio();
      if (displayPotentialRatio !== null) {
        displayPotentialRatioSource = 'shortVideoPageSummary';
        displaySummary.inshopPotentialUvRate = displayPotentialRatio;
      }
    }

    return {
      startTime,
      endTime,
      spendSummary: safeSpendSummary(spend),
      marketingRows,
      marketingTotal: marketingTotalRecord
        ? safeMetricRecord(marketingTotalRecord, false)
        : null,
      shortVideoClick: clickSummary,
      shortVideoDisplay: displaySummary,
      shortVideo: displaySummary,
      businessDefenseMetrics: {
        lastClickRoi,
        displayRoi,
        displayPotentialRatio,
        displayPotentialRatioSource,
      },
    };
  }

  async function fetchShortVideoDetailBlock(
    sourceTemplate,
    startTime,
    endTime,
    attribution,
    level
  ) {
    const nativeBody = buildShortVideoDetailBody(
      startTime,
      endTime,
      attribution,
      level,
      true
    );
    const domainVariants = [nativeBody.queryDomains];
    if (level === 'video') {
      domainVariants.push(['campaign', 'promotion'], ['campaign', 'subject']);
    }
    const seenDomains = new Set();
    const attempts = [];
    domainVariants.forEach((domains) => {
      const normalizedDomains = Array.from(new Set((domains || [])
        .map((domain) => String(domain || '').trim())
        .filter(Boolean)));
      const signature = normalizedDomains.join('\u0000');
      if (!normalizedDomains.length || seenDomains.has(signature)) return;
      seenDomains.add(signature);
      attempts.push(
        { domains: normalizedDomains, includeConfigFields: true },
        { domains: normalizedDomains, includeConfigFields: false }
      );
    });

    let firstEmptyResult = null;
    let lastError = null;
    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      const rows = [];
      let total = null;
      let pageNum = 1;
      let count = 0;
      try {
        do {
          const body = buildShortVideoDetailBody(
            startTime,
            endTime,
            attribution,
            level,
            attempt.includeConfigFields,
            attempt.domains
          );
          body.pageNum = pageNum;
          body.pageNo = pageNum;
          const data = await executeRequest(sourceTemplate, body);
          const list = Array.isArray(data.list) ? data.list : [];
          const safeRows = list.map(safeShortVideoDetailRecord);
          if (!rows.length && safeRows.length) {
            safeRows[0].__rawSample = cloneData(list[0]);
          }
          rows.push(...safeRows);
          count = safeNumber(data.count) || rows.length;
          if (!total && Array.isArray(data.totalData) && data.totalData.length) {
            total = safeShortVideoDetailRecord(data.totalData[0]);
          }
          pageNum += 1;
          if (rows.length < count && pageNum <= 200) await delay(250);
        } while (rows.length < count && pageNum <= 200);
        const block = {
          rows,
          total,
          queryDomains: attempt.domains,
          compatibilityMode: attemptIndex > 0,
          configFieldsLoaded: attempt.includeConfigFields,
        };
        if (rows.length) return block;
        if (!firstEmptyResult) firstEmptyResult = block;
      } catch (error) {
        lastError = error;
      }
    }
    if (firstEmptyResult) return firstEmptyResult;
    throw lastError || new Error('万相台数据块读取失败。');
  }

  async function collectShortVideoDetail(requestId, startTime, endTime) {
    await waitForShortVideoTemplates(30000);
    const result = {
      startTime,
      endTime,
      plan: {
        click: { rows: [], total: null },
        display: { rows: [], total: null },
      },
      video: {
        click: { rows: [], total: null },
        display: { rows: [], total: null },
      },
      requestWarnings: [],
    };
    const sourceTemplate = templates.shortVideoDetailQuery || templates.shortVideoAccountQuery || templates.accountQuery;
    for (const level of ['plan', 'video']) {
      for (const attribution of ['click', 'display']) {
        const blockName = (level === 'plan' ? '计划维度' : '视频维度') +
          (attribution === 'display' ? '展现效果归因' : '点击效果归因');
        post(PROGRESS_TYPE, requestId, {
          message: '正在读取' + blockName + '数据…',
        });
        try {
          result[level][attribution] = await fetchShortVideoDetailBlock(
            sourceTemplate,
            startTime,
            endTime,
            attribution,
            level
          );
          if (result[level][attribution].compatibilityMode) {
            post(PROGRESS_TYPE, requestId, {
              message: blockName + '已使用兼容口径读取。',
            });
          }
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          result[level][attribution] = { rows: [], total: null, error: message };
          result.requestWarnings.push(blockName + '：' + message);
          post(PROGRESS_TYPE, requestId, {
            message: blockName + '读取失败，继续处理其他数据块。',
          });
        }
      }
    }
    const readableBlocks = ['plan', 'video'].reduce((count, level) => (
      count + ['click', 'display'].filter((attribution) => (
        !result[level][attribution].error
      )).length
    ), 0);
    if (!readableBlocks) {
      throw new Error(result.requestWarnings[0] || '万相台四个数据块均读取失败。');
    }
    for (const attribution of ['click', 'display']) {
      if (
        !result.plan[attribution].rows.length &&
        result.video[attribution].rows.length
      ) {
        const fallbackRows = aggregatePlanRowsFromVideos(result.video[attribution].rows);
        const totalRows = fallbackRows.map(row => ({
          ...row,
          campaignId: '__all_plans__',
          campaignName: '全部计划',
        }));
        result.plan[attribution] = {
          rows: fallbackRows,
          total: aggregatePlanRowsFromVideos(totalRows)[0] || null,
          derivedFromVideo: true,
        };
        post(PROGRESS_TYPE, requestId, {
          message: (attribution === 'display' ? '展现效果归因' : '点击效果归因') +
            '计划接口为空，已按计划ID汇总视频明细并重算指标。',
        });
      }
    }
    backfillShortVideoConfig(result);
    result.click = result.video.click;
    result.display = result.video.display;
    return result;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (
      !message ||
      message.source !== 'wxt-report-content' ||
      message.type !== REQUEST_TYPE ||
      !/^wxt-[a-z0-9-]{10,80}$/i.test(String(message.requestId || ''))
    ) {
      return;
    }
    const startTime = String(message.startTime || '');
    const endTime = String(message.endTime || '');
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(startTime) || !/^20\d{2}-\d{2}-\d{2}$/.test(endTime)) {
      post(RESPONSE_TYPE, message.requestId, {
        ok: false,
        message: '导出日期范围无效。',
      });
      return;
    }

    const task = message.reportKind === 'shortVideoDetail'
      ? collectShortVideoDetail(message.requestId, startTime, endTime)
      : collectReport(message.requestId, startTime, endTime);
    task.then((data) => {
      post(RESPONSE_TYPE, message.requestId, { ok: true, data });
    }).catch((error) => {
      post(RESPONSE_TYPE, message.requestId, {
        ok: false,
        message: error && error.message ? error.message : '万相台报表读取失败。',
      });
    });
  });
})();

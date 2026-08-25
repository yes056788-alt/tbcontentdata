// dmp-page-hook.js - MAIN world bridge for DMP same-origin portrait APIs.
(function () {
  'use strict';

  if (location.hostname !== 'dmp.taobao.com') return;
  if (window.__dmpPortraitHookV2252) return;
  window.__dmpPortraitHookV2252 = true;

  const TAG = '[DMP画像]';
  const REQUEST_TYPE = 'DMP_PORTRAIT_REQUEST';
  const RESPONSE_TYPE = 'DMP_PORTRAIT_RESPONSE';
  const REQUEST_TYPE_V2 = 'DMP_PORTRAIT_REQUEST_V2';
  const RESPONSE_TYPE_V2 = 'DMP_PORTRAIT_RESPONSE_V2';
  let userInfoPromise = null;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function getMagixConfig(key) {
    try {
      const magix = window.Magix || window.mx || null;
      if (magix && typeof magix.config === 'function') return magix.config(key);
    } catch (error) {
      console.warn(TAG, '读取 Magix 配置失败:', error);
    }
    return null;
  }

  function appendQuery(url, params) {
    const query = new URLSearchParams();
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value === undefined || value === null || value === '') return;
      query.set(key, String(value));
    });
    const qs = query.toString();
    if (!qs) return url;
    return url + (url.includes('?') ? '&' : '?') + qs;
  }

  function requestRaw(path, options) {
    const config = options || {};
    const method = (config.method || 'GET').toUpperCase();
    let url = /^https?:\/\//.test(path) ? path : location.origin + path;
    url = appendQuery(url, config.params);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      if (method !== 'GET') xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        let body = xhr.responseText;
        try { body = body ? JSON.parse(body) : {}; } catch (error) {}
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body);
        } else {
          reject(new Error('HTTP ' + xhr.status + ': ' + (body && (body.msg || body.message) || xhr.responseText || url)));
        }
      };
      xhr.onerror = function () {
        reject(new Error('网络请求失败: ' + url));
      };
      xhr.send(method === 'GET' ? null : JSON.stringify(config.body || {}));
    });
  }

  function normalizeMaybeModel(model) {
    if (!model) return model;
    if (typeof model.get === 'function') {
      const data = model.get('data');
      return data !== undefined ? data : model.get();
    }
    return model;
  }

  function serviceRequest(name, options) {
    const config = options || {};
    return new Promise((resolve, reject) => {
      if (!window.seajs || typeof window.seajs.use !== 'function') {
        reject(new Error('DMP service 未就绪'));
        return;
      }
      window.seajs.use(['dmp-new/services/service'], (serviceModule) => {
        try {
          const ServiceCtor = serviceModule && (serviceModule.default || serviceModule).getService();
          const service = new ServiceCtor();
          const item = {
            name: name,
            params: config.body || config.params || {},
            pathParams: config.pathParams || [],
            isJson: config.isJson !== false,
          };
          service.all([item], (error, model) => {
            if (error) {
              reject(new Error(error.msg || error.message || String(error)));
              return;
            }
            resolve(normalizeMaybeModel(model));
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async function dmpRequestWithServiceFallback(path, options, serviceName, serviceOptions) {
    try {
      return await dmpRequest(path, options);
    } catch (rawError) {
      try {
        return await serviceRequest(serviceName, serviceOptions || options);
      } catch (serviceError) {
        throw new Error((rawError && rawError.message || rawError) + '；service兜底也失败: ' + (serviceError && serviceError.message || serviceError));
      }
    }
  }

  async function getUserInfo() {
    if (!userInfoPromise) {
      userInfoPromise = requestRaw('/api/login/loginuserinfo', { method: 'GET' }).then((res) => {
        return res && (res.data || res.user || res) || {};
      });
    }
    return userInfoPromise;
  }

  async function dmpRequest(path, options) {
    const user = await getUserInfo();
    const config = options || {};
    const params = Object.assign({}, config.params);
    if (user.csrfId) params.csrfId = user.csrfId;
    if (user.__udToken) params.__tk = user.__udToken;
    return requestRaw(path, Object.assign({}, config, { params }));
  }

  function extractData(response) {
    if (!response) return response;
    if (response.success === false) {
      throw new Error(response.msg || response.message || 'DMP 接口返回失败');
    }
    return response.data !== undefined ? response.data : response;
  }

  function findFirstArray(value, depth) {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value;
    if (Array.isArray(value.crowds)) return value.crowds;
    if (Array.isArray(value.crowdList)) return value.crowdList;
    if (Array.isArray(value.tagGroups)) return value.tagGroups;
    if (Array.isArray(value.tags)) return value.tags;
    if (Array.isArray(value.tagList)) return value.tagList;
    if (Array.isArray(value.list)) return value.list;
    if (Array.isArray(value.data)) return value.data;
    if (Array.isArray(value.records)) return value.records;
    if (Array.isArray(value.rows)) return value.rows;
    if (Array.isArray(value.items)) return value.items;
    if (Array.isArray(value.result)) return value.result;
    if ((depth || 0) < 2) {
      const nestedKeys = ['data', 'result', 'page', 'pagination', 'model'];
      for (const key of nestedKeys) {
        const nested = findFirstArray(value[key], (depth || 0) + 1);
        if (nested.length) return nested;
      }
    }
    return [];
  }

  function chartRowsFromData(data) {
    const findNonEmptyRows = (value, depth) => {
      if (!value || typeof value !== 'object') return [];
      if (Array.isArray(value)) return value.length ? value : [];
      if ((depth || 0) >= 4) return [];
      const keys = ['rows', 'items', 'records', 'data', 'result', 'list', 'chartDataFull', 'chartData'];
      for (const key of keys) {
        const rows = findNonEmptyRows(value[key], (depth || 0) + 1);
        if (rows.length) return rows;
      }
      return [];
    };
    const candidates = data && typeof data === 'object' && !Array.isArray(data)
      ? [data.chartDataFull, data.chartData, data.list, data]
      : [data];
    for (const candidate of candidates) {
      const rows = findNonEmptyRows(candidate, 0);
      if (rows.length) return rows;
    }
    return [];
  }

  function isUsableCoverageValue(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (!text || /计算中|生成中|处理中|暂无|^[-–—]+$/.test(text)) return false;
    return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:万|亿)?$/.test(
      text.replace(/[,，\s]/g, '').replace(/[人个]$/, '')
    );
  }

  function coverageFrom() {
    const values = Array.from(arguments);
    const usable = values.find(isUsableCoverageValue);
    if (usable !== undefined) return usable;
    const pending = values.find((value) => (
      value !== undefined && value !== null && String(value).trim() !== ''
    ));
    return pending === undefined ? '' : pending;
  }

  async function listCrowds(payload) {
    const pageSize = Math.min(Math.max(Number(payload && payload.pageSize) || 100, 10), 500);
    const shouldReadAll = Boolean(payload && payload.all);
    const rows = [];
    const seen = new Set();
    for (let page = 1; page <= (shouldReadAll ? 100 : 1); page += 1) {
      const data = extractData(await dmpRequest('/api/crowd/insight', {
        method: 'GET',
        params: { pageSize: pageSize, page: page },
      }));
      const batch = findFirstArray(data);
      let added = 0;
      batch.forEach((crowd) => {
        const crowdId = crowd && (crowd.crowdId || crowd.id);
        if (!crowdId || seen.has(String(crowdId))) return;
        seen.add(String(crowdId));
        rows.push(crowd);
        added += 1;
      });
      const totals = [
        data && data.total,
        data && data.totalCount,
        data && data.page && data.page.total,
        data && data.pagination && data.pagination.total,
      ].map(Number).filter(Number.isFinite);
      const total = totals.find((value) => value >= 0);
      if (!shouldReadAll || !batch.length || !added || (total !== undefined && rows.length >= total)) break;
      if (total === undefined && batch.length < pageSize) break;
    }
    return {
      list: rows.map((crowd) => ({
        crowdId: crowd.crowdId || crowd.id,
        crowdName: crowd.crowdName || crowd.name,
        coverage: coverageFrom(
          crowd.crowdNum, crowd.coverNum, crowd.coverage, crowd.crowdSize,
          crowd.size, crowd.num, crowd.uv, crowd.count
        ),
        storageType: crowd.storageType,
      })).filter((crowd) => crowd.crowdId && crowd.crowdName),
    };
  }

  async function getCrowd(crowdId) {
    const data = extractData(await dmpRequest('/api/crowd/' + encodeURIComponent(crowdId), { method: 'GET' }));
    return data && (data.crowd || data);
  }

  function buildAnalysisObj(crowd) {
    const all = getMagixConfig('dmp-new.all') || {};
    const base = clone(all.selectTagOptionSet) || { selectTagOptionSet: [] };
    if (!Array.isArray(base.selectTagOptionSet)) base.selectTagOptionSet = [];
    const crowdSet = clone(crowd.selectTagOptionSet || {});
    crowdSet.id = crowd.crowdId || crowd.id || crowdSet.id;
    crowdSet.name = crowd.crowdName || crowd.name || crowdSet.name;
    crowdSet.storageType = crowd.storageType || crowdSet.storageType;
    base.selectTagOptionSet[0] = crowdSet;
    if (!base.selectTagOptionSet[1]) base.selectTagOptionSet[1] = { selectTagOptionSet: [] };
    return base;
  }

  function chartPayload(crowd, tag, payload) {
    const analysisObj = buildAnalysisObj(crowd);
    const body = {
      version: '2.0',
      selectTagOptionSet: analysisObj,
      needUnknown: !(payload && payload.noNeedUnknown),
      ext: {},
      crowdId: crowd.crowdId || crowd.id,
    };
    if (analysisObj.selectTagOptionSet[1] && analysisObj.selectTagOptionSet[1].selectTagOptionSet && analysisObj.selectTagOptionSet[1].selectTagOptionSet.length) {
      body.extraSelectTagOptionSet = analysisObj.selectTagOptionSet[1];
    }
    if (tag && tag._multiGroupOptions) body.multiGroupOptions = tag._multiGroupOptions;
    return body;
  }

  function normalizeChart(tag, data) {
    const rows = chartRowsFromData(data);
    return {
      tagId: tag.id || tag.tagId,
      tagName: tag.tagName || tag.name,
      rows: rows.map((row) => {
        const rawRate = row && row.rate;
        const rate = rawRate === undefined || rawRate === null || String(rawRate).trim() === ''
          ? Number.NaN
          : Number(rawRate);
        const normalizedRate = Number.isFinite(rate) && rate <= 1 ? rate * 100 : rate;
        return {
          optionName: row.optionName || row.tagOptionName || row.name || row.optionValue || '',
          optionValue: row.optionValue ?? row.tagOptionValue ?? row.value ?? '',
          optionNum: row.optionNum ?? row.num ?? row.count ?? '',
          rate: Number.isFinite(normalizedRate) ? Number(normalizedRate.toFixed(2)) : (rawRate ?? ''),
          tgi: row.tgi ?? row.TGI ?? '',
          ctrIndex: row.ctrIndex ?? row.ctr ?? '',
          ppcIndex: row.ppcIndex ?? row.ppc ?? '',
        };
      }),
    };
  }

  async function getTagGroups() {
    const data = extractData(await dmpRequest('/api/analysis/insight/tagGroup/list', { method: 'GET' }));
    return findFirstArray(data).map((group) => ({
      id: group.id ?? group.tagGroupId ?? group.groupId ?? group.value,
      name: group.tagGroupName || group.groupName || group.name || group.label || group.title,
    })).filter((group) => group.id !== undefined);
  }

  async function getTags(payload) {
    const groupId = /^\d+$/.test(String(payload.groupId)) ? Number(payload.groupId) : payload.groupId;
    const body = {
      tagGroupIds: [groupId],
      crowdId: payload.crowdId,
      shopCateId: payload.shopCateId,
    };
    const data = extractData(await dmpRequestWithServiceFallback('/api/analysis/insight/tag/list', {
      method: 'POST',
      body: body,
    }, 'api_analysis_insight_tag_list_post', {
      body: body,
      isJson: true,
    }));
    return findFirstArray(data).map((tag) => ({
      id: tag.id || tag.tagId || tag.insightTagId || tag.value,
      tagName: tag.tagName || tag.name || tag.label || tag.title,
      tagGroupId: payload.groupId,
      _multiGroupOptions: tag._multiGroupOptions || tag.multiGroupOptions,
    })).filter((tag) => tag.id !== undefined);
  }

  async function buildPortrait(payload) {
    const crowd = await getCrowd(payload.crowdId);
    const tags = payload.tags || [];
    const charts = [];
    const warnings = [];
    for (const tag of tags) {
      const tagId = tag.id || tag.tagId;
      const body = chartPayload(crowd, tag, payload);
      try {
        const data = extractData(await dmpRequestWithServiceFallback('/api/analysis/tag/' + encodeURIComponent(tagId), {
          method: 'POST',
          body: body,
        }, 'api_analysis_tag_$id_post', {
          pathParams: [tagId],
          body: body,
          isJson: true,
        }));
        charts.push(normalizeChart(tag, data));
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        warnings.push((tag.tagName || tag.name || tagId) + '：' + message);
        charts.push({
          tagId: tag.id || tag.tagId,
          tagName: tag.tagName || tag.name,
          rows: [],
          error: message,
        });
      }
    }
    if (warnings.length && warnings.length === tags.length) throw new Error(warnings.join('；'));
    return {
      crowd: {
        crowdId: crowd.crowdId || payload.crowdId,
        crowdName: crowd.crowdName || payload.crowdName,
        coverage: coverageFrom(
          crowd.crowdNum, crowd.coverNum, crowd.coverage, crowd.crowdSize,
          crowd.size, crowd.num, crowd.uv, crowd.count
        ),
      },
      charts: charts,
      warnings: warnings,
    };
  }

  const handlers = {
    getUserInfo: getUserInfo,
    listCrowds: listCrowds,
    getCrowd: async function (payload) {
      if (!payload || !payload.crowdId) throw new Error('缺少人群 ID');
      return getCrowd(payload.crowdId);
    },
    getTagGroups: getTagGroups,
    getTags: getTags,
    buildPortrait: buildPortrait,
    navigatePerspective: async function (payload) {
      const crowdId = payload && payload.crowdId;
      if (!crowdId) throw new Error('缺少人群 ID');
      location.hash = '!/insight-new/perspective?crowdId=' + encodeURIComponent(crowdId);
      return { ok: true };
    },
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (!message || ![REQUEST_TYPE, REQUEST_TYPE_V2].includes(message.type) || !message.id) return;
    const responseType = message.type === REQUEST_TYPE_V2 ? RESPONSE_TYPE_V2 : RESPONSE_TYPE;
    try {
      const handler = handlers[message.action];
      if (!handler) throw new Error('未知 DMP 操作: ' + message.action);
      const data = await handler(message.payload || {});
      window.postMessage({ type: responseType, id: message.id, ok: true, data: data }, '*');
    } catch (error) {
      window.postMessage({
        type: responseType,
        id: message.id,
        ok: false,
        message: error && (error.message || error.msg) || String(error),
      }, '*');
    }
  });

})();

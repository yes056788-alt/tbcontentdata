// page-hook.js - 注入 MAIN world，提供 API 批量抓取能力（主路径），并保留 Excel 拦截（降级备用）
(function () {
  const isGuangheHost = location.hostname === 'creator.guanghe.taobao.com';
  const isSycmContentMirror = location.hostname === 'sycm.taobao.com' &&
    location.pathname.includes('/xsite/contentanalysis/overview_new_v2');
  const isGuangheSettingsApp = location.hostname === 'xstore.insights.1688.com';
  const isGuangheDataPage = location.hostname === 'web.taobao.com' &&
    location.pathname.includes('/s-guanghe-creator/asset-overview');
  if (!isGuangheHost && !isSycmContentMirror && !isGuangheSettingsApp && !isGuangheDataPage) return;
  if (window.__ghPageHookV2250 || typeof window.__ghFetchChannelDiagnosis === 'function') return;
  window.__ghPageHookV2250 = true;

  const TAG = '[光合分析]';

  // ===== 主路径：通过 lib.mtop.request 批量抓取 API 数据 =====

  function waitForMtop(cb, retries) {
    if (window.lib && window.lib.mtop && window.lib.mtop.request) {
      cb();
    } else if ((retries || 0) < 60) {
      setTimeout(() => waitForMtop(cb, (retries || 0) + 1), 500);
    } else {
      console.warn(TAG, 'lib.mtop 未就绪，API 抓取不可用');
    }
  }

  waitForMtop(() => {
    console.log(TAG, 'lib.mtop 就绪，API 抓取已启用');

    // ===== 筛选条件缓存：捕获一次后，两个视角的加载更多都复用它 =====
    // 结构：{ contentConditions, productConditions, timeRangeType, timeRangeBegin, timeRangeEnd }
    let capturedCtx = null;

    // 资产总览微应用可能会在用户点击前缓存 request 引用，因此不能等诊断开始后才临时替换。
    // 在页面启动阶段安装一次常驻观察器；它不修改请求参数，只把真实 MTop 响应分发给诊断订阅者。
    const mtopResponseObservers = new Set();
    const nativeMtopRequest = window.lib.mtop.request;
    function observedMtopRequest(opts) {
      const callArgs = Array.from(arguments);
      const apiName = String(opts && opts.api || '');
      let notified = false;
      const notifyResponse = response => {
        if (notified || response == null) return;
        notified = true;
        for (const observer of Array.from(mtopResponseObservers)) {
          try {
            observer({ opts, apiName, response });
          } catch (error) {
            console.warn(TAG, 'MTop 响应观察器异常:', error);
          }
        }
      };

      // lib-mtop 同时支持 request(opts).then(...) 与 request(opts, success, failure)。
      // 光合资产总览采用回调式调用，必须在转发前包住成功回调才能拿到真实响应体。
      if (typeof callArgs[1] === 'function') {
        const successCallback = callArgs[1];
        callArgs[1] = function (response) {
          notifyResponse(response);
          return successCallback.apply(this, arguments);
        };
      }
      if (opts && typeof opts === 'object') {
        let wrappedOpts = opts;
        for (const callbackKey of ['successCallback', 'success', 'onSuccess']) {
          if (typeof opts[callbackKey] !== 'function') continue;
          if (wrappedOpts === opts) wrappedOpts = Object.assign({}, opts);
          const optionCallback = opts[callbackKey];
          wrappedOpts[callbackKey] = function (response) {
            notifyResponse(response);
            return optionCallback.apply(this, arguments);
          };
        }
        callArgs[0] = wrappedOpts;
      }

      const result = nativeMtopRequest.apply(window.lib.mtop, callArgs);
      if (result && typeof result.then === 'function') {
        Promise.resolve(result).then(response => {
          notifyResponse(response);
        }, () => {});
      }
      return result;
    }
    Object.keys(nativeMtopRequest).forEach(key => {
      try { observedMtopRequest[key] = nativeMtopRequest[key]; } catch (error) {}
    });
    window.lib.mtop.request = observedMtopRequest;

    // 作品接口翻页
    function clonePlain(value) {
      try {
        return JSON.parse(JSON.stringify(value || {}));
      } catch (error) {
        return Object.assign({}, value || {});
      }
    }

    function parseConditions(value) {
      if (!value) return {};
      if (typeof value === 'object') return clonePlain(value);
      try {
        return JSON.parse(value);
      } catch (error) {
        return {};
      }
    }

    function stringifyConditionsLike(original, nextValue) {
      return typeof original === 'string' ? JSON.stringify(nextValue) : nextValue;
    }

    const CONTENT_REQUIRED_INDICATOR_FIELDS = [
      'consumePv', 'consumeUv', 'consumeTime', 'consumeTimeAvgPv',
      'itrtUv', 'itrtPv', 'attentionUv',
      'detailIpvPv', 'payBuyerCntZc', 'payAmtZcLast',
      'expoPv', 'expoUv', 'clickPv', 'clickUv',
      'consumePvValid', 'consumeUvValid',
      'ipvPv', 'payOrderCntZcLast',
      'playUv', 'favorUv', 'collectUv',
      'commentUv', 'shareUv', 'cartUv',
    ];

    function requestTemplateWithRequiredIndicators(requestTemplate) {
      if (!requestTemplate) return null;
      const next = clonePlain(requestTemplate);
      next.indicatorFields = JSON.stringify(CONTENT_REQUIRED_INDICATOR_FIELDS);
      return next;
    }

    function forceAutomaticThirtyDayRange(context) {
      context.timeRangeType = '30';
      context.timeRangeBegin = '';
      context.timeRangeEnd = '';
      if (context.contentRequestTemplate) {
        context.contentRequestTemplate.timeRangeType = '30';
        delete context.contentRequestTemplate.timeRangeBegin;
        delete context.contentRequestTemplate.timeRangeEnd;
      }
      return context;
    }

    function fetchContentPage(pageNo, pageSize, conditions, timeRangeType, scene, requestTemplate, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('请求超时')), timeoutMs || 20000);
        const data = requestTemplate ? clonePlain(requestTemplate) : {
          source: 'guanghe',
          orderBy: 'consumeUv:absolute:desc,contentId:absolute:asc',
          extra: JSON.stringify({
            channelLocation: 'shop_workdata_entire_workanalysis',
            promoteSourceUrl: 'https://creator.guanghe.taobao.com/page/unify/asset-overview?tab=singleEffect',
          }),
          indicatorFields: JSON.stringify(CONTENT_REQUIRED_INDICATOR_FIELDS),
        };
        data.source = data.source ?? 'guanghe';
        const setRequestValue = (keys, value, fallbackKey) => {
          let updated = false;
          keys.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
              data[key] = value;
              updated = true;
            }
          });
          if (!updated && fallbackKey) data[fallbackKey] = value;
        };
        setRequestValue(['pageNo', 'pageNum', 'currentPage', 'pageIndex'], pageNo, 'pageNo');
        setRequestValue(['pageSize', 'size', 'limit'], pageSize, 'pageSize');
        setRequestValue(
          ['offset', 'pageOffset', 'start', 'startIndex'],
          Math.max(0, (Number(pageNo) - 1) * Number(pageSize)),
          ''
        );
        data.scene = scene ?? data.scene ?? 'contentAssertContentDetail';
        data.conditions = conditions;
        data.timeRangeType = timeRangeType ?? data.timeRangeType;
        window.lib.mtop.request({
          api: 'mtop.taobao.guangguang.creator.gateway.oneservice.kind.pagelist',
          v: '1.0',
          data,
        }).then(
          (res) => { clearTimeout(timer); resolve(res); },
          (err) => { clearTimeout(timer); reject(err); }
        );
      });
    }

    // 商品接口翻页（消费 / 供给共用）
    function fetchProductPage(pageNo, pageSize, conditions, timeRangeType, timeRangeBegin, timeRangeEnd, scene, orderBy, indicatorFields) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('请求超时')), 20000);
        window.lib.mtop.request({
          api: 'mtop.taobao.guangguang.creator.gateway.oneservice.kind.pagelist',
          v: '1.0',
          data: {
            source: 'guanghe',
            pageNo: pageNo,
            pageSize: pageSize,
            scene: scene,
            conditions: conditions,
            timeRangeBegin: timeRangeBegin,
            timeRangeEnd: timeRangeEnd,
            timeRangeType: timeRangeType,
            orderBy: orderBy,
            indicatorFields: JSON.stringify(indicatorFields),
          },
        }).then(
          (res) => { clearTimeout(timer); resolve(res); },
          (err) => { clearTimeout(timer); reject(err); }
        );
      });
    }

    // 临时 hook 一次 mtop，点击搜索按钮触发真实请求，捕获筛选参数后立即还原
    function captureRawConditions(preferredMode) {
      return new Promise((resolve, reject) => {
        const origRequest = window.lib.mtop.request;
        const captures = [];
        let settled = false;
        let settleTimer = null;

        const isContentScene = scene => String(scene ?? '').toLowerCase().includes('content');
        const isProductScene = scene => /itemanalysis|product/i.test(String(scene ?? ''));
        const chooseCapture = () => {
          if (preferredMode === 'content') {
            return captures.find(capture => isContentScene(capture.scene)) || captures[0];
          }
          if (preferredMode === 'product') {
            return captures.find(capture => isProductScene(capture.scene)) || captures[0];
          }
          return captures.find(capture => isContentScene(capture.scene)) || captures[0];
        };

        const finish = (capture) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          clearTimeout(settleTimer);
          window.lib.mtop.request = origRequest;
          resolve(capture);
        };

        const timeout = setTimeout(() => {
          if (captures.length) {
            finish(chooseCapture());
            return;
          }
          settled = true;
          clearTimeout(settleTimer);
          window.lib.mtop.request = origRequest;
          reject(new Error('捕获筛选参数超时，请先点一次搜索按钮'));
        }, 6000);

        window.lib.mtop.request = function(opts) {
          if (opts && opts.api && opts.api.includes('pagelist') && opts.data && opts.data.conditions) {
            captures.push({
              conditions: opts.data.conditions,
              scene: opts.data.scene ?? '',
              timeRangeType: opts.data.timeRangeType ?? '7',
              timeRangeBegin: opts.data.timeRangeBegin ?? '',
              timeRangeEnd: opts.data.timeRangeEnd ?? '',
              requestData: clonePlain(opts.data),
            });
            const latest = captures[captures.length - 1];
            if ((preferredMode === 'content' && isContentScene(latest.scene)) ||
                (preferredMode === 'product' && isProductScene(latest.scene))) {
              finish(latest);
            } else if (!settleTimer) {
              settleTimer = setTimeout(() => finish(chooseCapture()), 1200);
            }
          }
          return origRequest.apply(window.lib.mtop, arguments);
        };
        // 把原函数上的属性也复制过去（mtop 内部可能读自身属性）
        Object.keys(origRequest).forEach(function(k) {
          try { window.lib.mtop.request[k] = origRequest[k]; } catch (e) {}
        });

        // 点击搜索按钮，触发页面发一次真实请求
        const searchBtn = document.querySelector('[class*="searchBtn"]');
        if (searchBtn) {
          searchBtn.click();
        } else {
          clearTimeout(timeout);
          clearTimeout(settleTimer);
          window.lib.mtop.request = origRequest;
          reject(new Error('找不到搜索按钮，请确认在资产总览页面'));
        }
      });
    }

    async function waitForContentSearchReady(timeoutMs) {
      const deadline = Date.now() + (timeoutMs || 60000);
      while (Date.now() < deadline) {
        if (document.querySelector('[class*="searchBtn"]')) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error('光合作品分析页未完成加载，找不到搜索按钮。');
    }

    async function selectAllContentScope() {
      const candidates = Array.from(document.querySelectorAll('label,button,span,div')).filter((element) => (
        element.children.length <= 3 &&
        /^(所有作品|全部作品)$/.test(String(element.textContent || '').trim())
      ));
      const target = candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!target) return false;
      const input = target.matches('input') ? target : target.querySelector('input');
      const alreadySelected = Boolean(input && input.checked) ||
        target.getAttribute('aria-checked') === 'true' ||
        target.getAttribute('aria-selected') === 'true' ||
        /checked|selected|active/i.test(String(target.className || ''));
      if (!alreadySelected) {
        target.click();
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      return true;
    }

    async function captureContentConditionsWithRetry() {
      await waitForContentSearchReady(60000);
      await selectAllContentScope();
      let lastError = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await captureRawConditions('content');
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      throw lastError || new Error('无法捕获光合作品筛选条件。');
    }

    // 从当前视角捕获的原始条件，合成"作品条件"和"商品条件"两套。
    // 关键：两个接口条件结构不同——作品需 indicatorHideCheck/retainLatestDs，
    // 商品需 content_type/belong_type_lvl1。共享 biz_line 与 ds（日期）。
    function buildBothConditions(raw) {
      const base = parseConditions(raw.conditions);
      const valueOrDefault = (value, fallback) => (
        value === undefined || value === null || value === '' ? fallback : value
      );
      const biz = valueOrDefault(base.biz_line, 'all');
      const ds = valueOrDefault(base.ds, '');

      // 作品接口必须尽量复用页面原生请求条件；不同店铺会带不同的 0/false
      // 筛选位，任何二次重组都可能把有数据的请求改成空结果。
      const contentConditions = raw.conditions;

      const productConditions = {
        content_type: valueOrDefault(base.content_type, 'all'),
        biz_line: biz,
        belong_type_lvl1: valueOrDefault(base.belong_type_lvl1, 'all'),
      };
      if (ds !== '') productConditions.ds = ds;
      const contentScene = raw.scene !== undefined && raw.scene !== null && raw.scene !== ''
        ? raw.scene
        : 'contentAssertContentDetail';
      const contentRequestTemplate = raw.requestData ? clonePlain(raw.requestData) : null;
      const nativeContentPageSize = Number(contentRequestTemplate && contentRequestTemplate.pageSize);
      const contentPageSize = Number.isFinite(nativeContentPageSize) && nativeContentPageSize > 0
        ? nativeContentPageSize
        : 100;
      const contentEffectivePageSize = 0;

      return {
        contentConditions,
        contentScene,
        contentRequestTemplate,
        contentPageSize,
        contentEffectivePageSize,
        productConditions: JSON.stringify(productConditions),
        rawConditions: base,
        timeRangeType: raw.timeRangeType,
        timeRangeBegin: raw.timeRangeBegin,
        timeRangeEnd: raw.timeRangeEnd,
        capturedScene: raw.scene ?? '',
      };
    }

    function pageModel(response) {
      return response && response.data && response.data.model
        ? response.data.model
        : {};
    }

    function pageRows(response) {
      const model = pageModel(response);
      const candidates = [
        model.result,
        model.results,
        model.list,
        model.rows,
        model.data,
        model.pageList,
        model.resultList,
      ];
      if (model.result && typeof model.result === 'object' && !Array.isArray(model.result)) {
        candidates.push(
          model.result.list,
          model.result.rows,
          model.result.data,
          model.result.result,
          model.result.resultList
        );
      }
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
      }
      return [];
    }

    function pageHasMore(response, pageNo, pageSize) {
      const model = pageModel(response);
      const containers = [
        model,
        model.result,
        model.page,
        model.pageInfo,
        model.pagination,
        model.pager,
      ].filter(value => value && typeof value === 'object' && !Array.isArray(value));
      for (const container of containers) {
        for (const key of ['hasNext', 'hasMore', 'nextPage']) {
          if (container[key] === true || container[key] === 'true') return true;
          if (container[key] === false || container[key] === 'false') return false;
          if (key === 'nextPage' && Number(container[key]) > Number(pageNo || 0)) return true;
        }
      }

      const firstNumber = (keys) => {
        for (const container of containers) {
          for (const key of keys) {
            const value = Number(apiScalar(container[key]));
            if (Number.isFinite(value) && value >= 0) return value;
          }
        }
        return null;
      };
      const current = firstNumber(['pageNo', 'pageNum', 'currentPage', 'pageIndex']) ?? Number(pageNo);
      const size = firstNumber(['pageSize', 'size', 'limit']) ?? Number(pageSize);
      const total = firstNumber(['total', 'totalCount', 'totalSize', 'count']);
      const pageCount = firstNumber(['pageCount', 'totalPage', 'totalPages']);
      if (Number.isFinite(pageCount) && Number.isFinite(current)) return current < pageCount;
      if (Number.isFinite(total) && Number.isFinite(current) && Number.isFinite(size) && size > 0) {
        return current * size < total;
      }
      return pageRows(response).length >= Number(pageSize || 0) && Number(pageSize || 0) > 0;
    }

    // 作品接口：ds 若无数据，从昨天往前扫7天找有效日期，返回可用的 conditions 字符串
    async function findValidContentConditions(contentConditions, timeRangeType, scene, requestTemplate, pageSize) {
      const base = parseConditions(contentConditions);
      if (base.ds) {
        try {
          const r = await fetchContentPage(1, pageSize || 100, contentConditions, timeRangeType, scene, requestTemplate);
          if (pageRows(r).length > 0) return contentConditions;
        } catch (e) {}
      }
      const now = new Date();
      for (let i = 1; i <= 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const ds = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
        try {
          const cond = stringifyConditionsLike(contentConditions, Object.assign({}, base, { ds }));
          const r = await fetchContentPage(1, pageSize || 100, cond, timeRangeType, scene, requestTemplate);
          if (pageRows(r).length > 0) return cond;
        } catch (e) {}
      }
      // 找不到就返回原条件（让上层照常处理空结果）
      return contentConditions;
    }

    function uniquePageSizes(values) {
      const output = [];
      values.forEach(value => {
        const number = Number(value);
        if (!Number.isFinite(number) || number <= 0 || output.includes(number)) return;
        output.push(number);
      });
      return output;
    }

    function apiScalar(value) {
      if (value && typeof value === 'object') {
        for (const key of ['absolute', 'value', 'currentValue', 'indicatorValue', 'metricValue', 'id']) {
          if (value[key] != null) return value[key];
        }
      }
      return value;
    }

    function contentRowKey(row) {
      if (!row || typeof row !== 'object') return '';
      const contentInfo = row.contentInfo || {};
      const content = contentInfo.content || row.content || row.contentBaseInfo || {};
      const id = apiScalar(row.contentId) ||
        apiScalar(row.content_id) ||
        apiScalar(contentInfo.contentId) ||
        apiScalar(contentInfo.content_id) ||
        apiScalar(contentInfo.id) ||
        apiScalar(content.id) ||
        apiScalar(content.contentId) ||
        apiScalar(content.content_id) ||
        apiScalar(row.id);
      return id == null ? '' : String(id);
    }

    const CONTENT_IDENTITY_KEYS = new Set([
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

    function normalizedIdentityFieldKey(value) {
      return String(value == null ? '' : value)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
    }

    function isContentIdentityPath(path) {
      const parts = String(path || '').split('.');
      const leaf = normalizedIdentityFieldKey(parts[parts.length - 1]);
      if (CONTENT_IDENTITY_KEYS.has(leaf) || /^(?:视频|作品|内容)(?:主体)?id$/i.test(leaf)) {
        return true;
      }
      if (leaf !== 'id') return false;
      return parts.slice(0, -1).some((part) => {
        const key = normalizedIdentityFieldKey(part);
        return /video|promotion|subject|entity|content|feed|resource|material|creative|work/.test(key) ||
          /视频|作品|内容|主体|素材/.test(key);
      });
    }

    function normalizedContentIdentityValue(value) {
      const scalar = apiScalar(value);
      const text = String(scalar == null ? '' : scalar).trim().replace(/\.0+$/, '');
      return /^[a-z0-9_-]{3,100}$/i.test(text) ? text : '';
    }

    function parseEmbeddedContentValue(value) {
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

    function contentRowIdentityEntries(row) {
      if (!row || typeof row !== 'object') return [];
      const entries = [];
      const seen = new Set();
      const visit = (value, path, depth) => {
        if (depth > 5 || entries.length >= 100 || value == null) return;
        const embedded = parseEmbeddedContentValue(value);
        if (embedded) {
          visit(embedded, path ? path + '.$json' : '$json', depth + 1);
          return;
        }
        if (Array.isArray(value)) {
          value.slice(0, 10).forEach((item, index) => visit(item, path + '[' + index + ']', depth + 1));
          return;
        }
        if (typeof value !== 'object') return;
        Object.entries(value).forEach(([key, child]) => {
          const childPath = path ? path + '.' + key : key;
          if (isContentIdentityPath(childPath)) {
            const identity = normalizedContentIdentityValue(child);
            const signature = childPath + '\u0000' + identity;
            if (identity && !seen.has(signature)) {
              seen.add(signature);
              entries.push({ field: childPath, value: identity });
            }
          }
          visit(child, childPath, depth + 1);
        });
      };
      visit(row, '', 0);
      return entries;
    }

    function normalizeContentTitle(value) {
      return String(value == null ? '' : value)
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\u3000]+/g, '')
        .replace(/[，。！？、,.!?;；:："'“”‘’（）()\[\]【】《》<>·|/\\_-]+/g, '');
    }

    function contentRowTitleEntries(row) {
      if (!row || typeof row !== 'object') return [];
      const entries = [];
      const seen = new Set();
      const titleKeys = new Set([
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
        if (depth > 5 || entries.length >= 50 || value == null) return;
        const embedded = parseEmbeddedContentValue(value);
        if (embedded) {
          visit(embedded, path ? path + '.$json' : '$json', depth + 1);
          return;
        }
        if (Array.isArray(value)) {
          value.slice(0, 10).forEach((item, index) => visit(item, path + '[' + index + ']', depth + 1));
          return;
        }
        if (typeof value !== 'object') return;
        Object.entries(value).forEach(([key, child]) => {
          const childPath = path ? path + '.' + key : key;
          const normalizedKey = normalizedIdentityFieldKey(key);
          const genericTitle = normalizedKey === 'title' || normalizedKey === 'name';
          const embeddedChild = parseEmbeddedContentValue(child);
          const semanticPath = /video|promotion|subject|entity|content|feed|resource|material|creative|work|作品|内容|视频|素材/i.test(childPath) &&
            !/items?(?:\.|\[)|itemlist|商品/i.test(childPath);
          if (
            titleKeys.has(normalizedKey) &&
            (!genericTitle || semanticPath || !path) &&
            typeof child !== 'object' &&
            !embeddedChild
          ) {
            const title = String(child == null ? '' : child).trim();
            const normalized = normalizeContentTitle(title);
            const signature = childPath + '\u0000' + normalized;
            if (normalized.length >= 4 && !/^\d+$/.test(normalized) && !seen.has(signature)) {
              seen.add(signature);
              entries.push({ field: childPath, value: title, normalized });
            }
          }
          visit(child, childPath, depth + 1);
        });
      };
      visit(row, '', 0);
      return entries;
    }

    function contentRowKeys(row) {
      return Array.from(new Set(contentRowIdentityEntries(row).map((entry) => entry.value)));
    }

    function normalizeContentTargetIds(values) {
      return Array.from(new Set((Array.isArray(values) ? values : [])
        .map(value => String(value == null ? '' : value).trim().replace(/\.0+$/, ''))
        .filter(value => /^[a-z0-9_-]{3,100}$/i.test(value))));
    }

    function normalizeContentTargetGroups(values) {
      const groups = new Map();
      (Array.isArray(values) ? values : []).forEach((value) => {
        const source = value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : { ids: Array.isArray(value) ? value : [value] };
        const ids = normalizeContentTargetIds(source.ids);
        const identityEntries = (Array.isArray(source.identityEntries) ? source.identityEntries : [])
          .map((entry) => ({
            field: String(entry && entry.field || 'unknown').slice(0, 200),
            value: String(entry && entry.value || '').trim().replace(/\.0+$/, ''),
          }))
          .filter((entry) => entry.value && ids.includes(entry.value))
          .slice(0, 100);
        const titles = (Array.isArray(source.titles) ? source.titles : [])
          .map((entry) => {
            const title = String(entry && entry.value || '').trim().slice(0, 500);
            return {
              field: String(entry && entry.field || 'unknown').slice(0, 200),
              value: title,
              normalized: normalizeContentTitle(entry && entry.normalized || title),
            };
          })
          .filter((entry) => entry.normalized.length >= 4)
          .slice(0, 50);
        const titleKeys = Array.from(new Set(titles.map((entry) => entry.normalized))).sort();
        if (!ids.length && !titleKeys.length) return;
        const key = ids.length ? ids.slice().sort().join('|') : 'title:' + titleKeys.join('|');
        if (groups.has(key)) return;
        groups.set(key, {
          ids,
          identityEntries,
          titles,
          key,
          rawSample: source.rawSample && typeof source.rawSample === 'object'
            ? clonePlain(source.rawSample)
            : null,
        });
      });
      return Array.from(groups.values());
    }

    function contentConditionsForAsset(contentConditions, assetCode) {
      const next = parseConditions(contentConditions);
      [
        'belong_type_lvl1',
        'belong_type_lvl2',
        'belongTypeLvl1',
        'belongTypeLvl2',
        'assetCode',
        'assetType',
        'contentSource',
        'contentSourceType',
      ].forEach(key => delete next[key]);
      if (!assetCode || assetCode === 'all') {
        return stringifyConditionsLike(contentConditions, next);
      }
      Object.assign(next, {
        belong_type_lvl1: assetCode,
        belong_type_lvl2: 'all',
      });
      return stringifyConditionsLike(contentConditions, next);
    }

    function contentConditionsForTargetIds(contentConditions, targetIds) {
      const base = parseConditions(contentConditionsForAsset(contentConditions, 'all'));
      const ids = normalizeContentTargetIds(targetIds).slice(0, 100);
      if (!ids.length) return [];
      const normalizedKey = (value) => String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
      const looksLikeContentId = (key) => (
        /^(?:content|work)(?:ids?|idlist)$/.test(normalizedKey(key)) ||
        /^(?:内容|作品)id(?:列表)?$/.test(normalizedKey(key))
      );
      const existingKeys = Object.keys(base).filter(looksLikeContentId);
      const candidateKeys = Array.from(new Set([
        ...existingKeys,
        'content_id',
        'contentId',
        'content_ids',
      ])).slice(0, 3);
      const variants = [];
      const seen = new Set();
      candidateKeys.forEach((key) => {
        const next = clonePlain(base);
        Object.keys(next).filter(looksLikeContentId).forEach((existingKey) => {
          delete next[existingKey];
        });
        const original = base[key];
        next[key] = Array.isArray(original) ? ids.slice() : ids.join(',');
        const serialized = stringifyConditionsLike(contentConditions, next);
        const signature = typeof serialized === 'string' ? serialized : JSON.stringify(serialized);
        if (seen.has(signature)) return;
        seen.add(signature);
        variants.push(serialized);
      });
      return variants;
    }

    function contentRowAssetCode(row) {
      if (!row || typeof row !== 'object') return '';
      const contentInfo = row.contentInfo || {};
      const content = contentInfo.content || row.content || row.contentBaseInfo || {};
      const candidates = [
        row.belong_type_lvl1,
        row.belongTypeLvl1,
        row.assetCode,
        row.assetType,
        contentInfo.belong_type_lvl1,
        contentInfo.belongTypeLvl1,
        content.belong_type_lvl1,
        content.belongTypeLvl1,
        content.assetCode,
        content.assetType,
      ];
      for (const value of candidates) {
        const code = String(apiScalar(value) || '').trim().toLowerCase();
        if (code) return code;
      }
      return '';
    }

    async function fetchContentBatchWithPageSize(pageFrom, pageCount, targetRows, pageSize) {
      const ctx = capturedCtx;
      let rows = [];
      const seen = new Set();
      let hasMore = false;
      let pagesFetched = 0;
      const target = targetRows || (pageCount * pageSize);
      const maxPages = Math.max(pageCount, Math.ceil(target / 10) + pageCount);
      let lastBatchRows = 0;
      let lastBatchRawRows = 0;

      const requestPages = async (from, count) => {
        const pages = [];
        for (let i = 0; i < count; i++) pages.push(from + i);
        const batch = await Promise.all(pages.map(p => fetchContentPage(
          p, pageSize, ctx.contentConditions, ctx.timeRangeType, ctx.contentScene, ctx.contentRequestTemplate
        )));
        pagesFetched += pages.length;
        lastBatchRows = 0;
        lastBatchRawRows = 0;
        batch.forEach((res, index) => {
          const responseRows = pageRows(res);
          lastBatchRawRows += responseRows.length;
          for (const row of responseRows) {
            const key = contentRowKey(row);
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            rows.push(row);
            lastBatchRows += 1;
          }
          if (pageHasMore(res, pages[index], pageSize)) hasMore = true;
        });
      };

      await requestPages(pageFrom, pageCount);
      while (
        rows.length < target &&
        (hasMore || (lastBatchRawRows > 0 && lastBatchRows > 0)) &&
        pagesFetched < maxPages
      ) {
        hasMore = false;
        await requestPages(pageFrom + pagesFetched, Math.min(pageCount, maxPages - pagesFetched));
      }
      return {
        rows,
        hasMore: hasMore || rows.length >= target,
        nextPage: pageFrom + pagesFetched,
        pageSize,
      };
    }

    // 抓一批作品数据（pageFrom 起 pageCount 页）。按钮文案是“300 条”，
    // pageCount=3 只代表默认并发 3 页；如果页面每页只有 10/30，就继续补页。
    async function fetchContentBatch(pageFrom, pageCount, targetRows) {
      const ctx = capturedCtx;
      const lockedPageSize = Number(ctx.contentEffectivePageSize);
      if (Number.isFinite(lockedPageSize) && lockedPageSize > 0) {
        return fetchContentBatchWithPageSize(
          pageFrom,
          pageCount,
          targetRows,
          lockedPageSize
        );
      }
      const pageSizes = uniquePageSizes([
        ctx.contentPageSize,
        30,
        10,
        100,
      ]);
      let fallback = null;
      for (const pageSize of pageSizes) {
        const result = await fetchContentBatchWithPageSize(pageFrom, pageCount, targetRows, pageSize);
        if (result.rows.length >= targetRows || (result.rows.length > 0 && result.hasMore)) {
          ctx.contentEffectivePageSize = pageSize;
          return result;
        }
        if (!fallback || result.rows.length > fallback.rows.length) fallback = result;
      }
      if (fallback && fallback.rows.length > 0) {
        ctx.contentEffectivePageSize = fallback.pageSize;
        return fallback;
      }
      return fallback || { rows: [], hasMore: false, nextPage: pageFrom + pageCount, pageSize: pageSizes[0] || 100 };
    }

    // 先尝试按自制/达人来源查找；部分账号的作品明细接口不接受该来源条件，
    // 15秒内未完成时回退到页面原始条件继续定向匹配，避免直接得到空结果。
    async function fetchTargetedContentRows(requestId, rawTargetGroups) {
      const targetGroups = normalizeContentTargetGroups(rawTargetGroups);
      if (!targetGroups.length) {
        return {
          rows: [],
          targetCount: 0,
          matchedCount: 0,
          scannedCount: 0,
          pagesFetched: 0,
          complete: true,
          timedOut: false,
        };
      }

      const rows = [];
      const rowKeysSeen = new Set();
      const rowByKey = new Map();
      const matchedGroups = new Set();
      const targetGroupIndexesById = new Map();
      const targetGroupIndexesByTitle = new Map();
      const titleCandidatesByValue = new Map();
      const rawScannedSamples = [];
      targetGroups.forEach((group, groupIndex) => {
        group.ids.forEach((id) => {
          if (!targetGroupIndexesById.has(id)) targetGroupIndexesById.set(id, []);
          targetGroupIndexesById.get(id).push(groupIndex);
        });
        group.titles.forEach((entry) => {
          const title = entry.normalized;
          if (!title) return;
          if (!targetGroupIndexesByTitle.has(title)) targetGroupIndexesByTitle.set(title, []);
          const indexes = targetGroupIndexesByTitle.get(title);
          if (!indexes.includes(groupIndex)) indexes.push(groupIndex);
        });
      });
      const pageSize = 100;
      const pagesPerRound = 3;
      const maxPagesPerAsset = 240;
      const startedAt = Date.now();
      const deadline = startedAt + 90000;
      const filteredDeadline = Math.min(deadline, startedAt + 15000);
      const assets = [
        { code: 'self', name: '自制内容' },
        { code: 'business', name: '达人合作内容' },
      ];
      const states = assets.map(asset => ({
        ...asset,
        nextPage: 1,
        pagesFetched: 0,
        scannedCount: 0,
        consecutiveFailures: 0,
        done: false,
        capped: false,
        failed: false,
        conditions: contentConditionsForAsset(capturedCtx.contentConditions, asset.code),
      }));
      let rounds = 0;
      let timedOut = false;
      let fallbackUsed = false;
      let fallbackState = null;
      let directLookupUsed = false;
      let directPagesFetched = 0;
      let directScannedCount = 0;
      let directLookupMatched = 0;

      const appendMatchedRow = (row, groupIndexes, method, rowIdentityEntries, rowTitleEntries, matchedValue) => {
        const rowKeys = rowIdentityEntries.map((entry) => entry.value);
        const rowKey = contentRowKey(row) || rowKeys[0] || ('matched-row-' + rows.length);
        let storedRow = rowByKey.get(rowKey);
        if (!storedRow) {
          storedRow = clonePlain(row);
          storedRow.__ghMatch = { targetGroups: [] };
          rowByKey.set(rowKey, storedRow);
          rowKeysSeen.add(rowKey);
          rows.push(storedRow);
        }
        const matchGroups = storedRow.__ghMatch.targetGroups;
        groupIndexes.forEach((groupIndex) => {
          const group = targetGroups[groupIndex];
          if (!group || matchGroups.some((entry) => entry.groupKey === group.key)) return;
          const evidence = [];
          if (method === 'id') {
            const sharedIds = group.ids.filter((id) => rowKeys.includes(id));
            sharedIds.slice(0, 10).forEach((id) => {
              const targetEntry = group.identityEntries.find((entry) => entry.value === id);
              const guangheEntry = rowIdentityEntries.find((entry) => entry.value === id);
              evidence.push({
                wxtField: targetEntry ? targetEntry.field : '候选ID',
                wxtValue: id,
                guangheField: guangheEntry ? guangheEntry.field : '候选ID',
                guangheValue: id,
              });
            });
          } else {
            const targetTitle = matchedValue && typeof matchedValue === 'object'
              ? matchedValue.target
              : matchedValue;
            const guangheTitle = matchedValue && typeof matchedValue === 'object'
              ? matchedValue.candidate
              : matchedValue;
            const targetEntry = group.titles.find((entry) => entry.normalized === targetTitle);
            const guangheEntry = rowTitleEntries.find((entry) => entry.normalized === guangheTitle);
            evidence.push({
              wxtField: targetEntry ? targetEntry.field : '视频标题',
              wxtValue: targetEntry ? targetEntry.value : '',
              guangheField: guangheEntry ? guangheEntry.field : '作品标题',
              guangheValue: guangheEntry ? guangheEntry.value : '',
            });
          }
          matchGroups.push({
            groupKey: group.key,
            targetIds: group.ids.slice(),
            method,
            evidence,
          });
          matchedGroups.add(groupIndex);
        });
      };

      const collectTitleCandidates = (row, rowIdentityEntries, rowTitleEntries) => {
        const rowKey = contentRowKey(row) || rowIdentityEntries.map((entry) => entry.value)[0];
        if (!rowKey) return;
        rowTitleEntries.forEach((entry) => {
          if (!titleCandidatesByValue.has(entry.normalized)) {
            titleCandidatesByValue.set(entry.normalized, new Map());
          }
          const candidates = titleCandidatesByValue.get(entry.normalized);
          if (!candidates.has(rowKey)) {
            candidates.set(rowKey, {
              row: clonePlain(row),
              identityEntries: rowIdentityEntries,
              titleEntries: rowTitleEntries,
            });
          }
        });
      };

      const resolveUniqueTitleMatches = () => {
        targetGroupIndexesByTitle.forEach((groupIndexes, title) => {
          if (groupIndexes.length !== 1) return;
          const groupIndex = groupIndexes[0];
          if (matchedGroups.has(groupIndex)) return;
          const candidates = titleCandidatesByValue.get(title);
          if (!candidates || candidates.size !== 1) return;
          const candidate = Array.from(candidates.values())[0];
          appendMatchedRow(
            candidate.row,
            [groupIndex],
            'title',
            candidate.identityEntries,
            candidate.titleEntries,
            title
          );
        });

        const fuzzyProposals = [];
        targetGroups.slice(0, 500).forEach((group, groupIndex) => {
          if (matchedGroups.has(groupIndex)) return;
          const candidatesByRow = new Map();
          group.titles.forEach((targetTitle) => {
            if (targetTitle.normalized.length < 10) return;
            titleCandidatesByValue.forEach((candidates, candidateTitle) => {
              if (candidateTitle.length < 10 || candidateTitle === targetTitle.normalized) return;
              const shorter = Math.min(candidateTitle.length, targetTitle.normalized.length);
              const longer = Math.max(candidateTitle.length, targetTitle.normalized.length);
              if (shorter / longer < 0.7) return;
              if (
                !candidateTitle.includes(targetTitle.normalized) &&
                !targetTitle.normalized.includes(candidateTitle)
              ) {
                return;
              }
              candidates.forEach((candidate, rowKey) => {
                if (!candidatesByRow.has(rowKey)) {
                  candidatesByRow.set(rowKey, {
                    ...candidate,
                    matchedValue: {
                      target: targetTitle.normalized,
                      candidate: candidateTitle,
                    },
                  });
                }
              });
            });
          });
          if (candidatesByRow.size !== 1) return;
          const [rowKey, candidate] = Array.from(candidatesByRow.entries())[0];
          fuzzyProposals.push({ groupIndex, rowKey, candidate });
        });
        const proposalCounts = new Map();
        fuzzyProposals.forEach((proposal) => {
          proposalCounts.set(proposal.rowKey, (proposalCounts.get(proposal.rowKey) || 0) + 1);
        });
        fuzzyProposals.forEach((proposal) => {
          if (proposalCounts.get(proposal.rowKey) !== 1 || matchedGroups.has(proposal.groupIndex)) return;
          appendMatchedRow(
            proposal.candidate.row,
            [proposal.groupIndex],
            'title',
            proposal.candidate.identityEntries,
            proposal.candidate.titleEntries,
            proposal.candidate.matchedValue
          );
        });
      };

      const processCandidateRow = (row) => {
        if (contentRowAssetCode(row) === 'ugc') return;
        if (rawScannedSamples.length < 2) rawScannedSamples.push(clonePlain(row));
        const identityEntries = contentRowIdentityEntries(row);
        const keys = identityEntries.map((entry) => entry.value);
        const titleEntries = contentRowTitleEntries(row);
        collectTitleCandidates(row, identityEntries, titleEntries);
        const groupIndexes = new Set();
        keys.forEach((key) => {
          (targetGroupIndexesById.get(key) || []).forEach(index => groupIndexes.add(index));
        });
        if (!groupIndexes.size) return;
        appendMatchedRow(
          row,
          Array.from(groupIndexes),
          'id',
          identityEntries,
          titleEntries,
          ''
        );
      };

      const runDirectLookup = async () => {
        const targetIds = [];
        const seenIds = new Set();
        targetGroups.forEach((group) => {
          group.ids.forEach((id) => {
            if (seenIds.has(id) || targetIds.length >= 300) return;
            seenIds.add(id);
            targetIds.push(id);
          });
        });
        const requests = [];
        for (let offset = 0; offset < targetIds.length; offset += 100) {
          const batch = targetIds.slice(offset, offset + 100);
          contentConditionsForTargetIds(capturedCtx.contentConditions, batch).forEach((conditions) => {
            requests.push(fetchContentPage(
              1,
              pageSize,
              conditions,
              capturedCtx.timeRangeType,
              capturedCtx.contentScene,
              capturedCtx.contentRequestTemplate,
              8000
            ));
          });
        }
        if (!requests.length) return;
        directLookupUsed = true;
        const matchedBefore = matchedGroups.size;
        const settled = await Promise.allSettled(requests);
        settled.forEach((result) => {
          if (result.status !== 'fulfilled') return;
          directPagesFetched += 1;
          const responseRows = pageRows(result.value);
          directScannedCount += responseRows.length;
          responseRows.forEach(processCandidateRow);
        });
        directLookupMatched = Math.max(0, matchedGroups.size - matchedBefore);
      };

      const scanState = async (state) => {
        if (state.done || matchedGroups.size >= targetGroups.length) return;
        const remainingPages = maxPagesPerAsset - state.pagesFetched;
        if (remainingPages <= 0) {
          state.done = true;
          state.capped = true;
          return;
        }
        const pageCount = Math.min(pagesPerRound, remainingPages);
        const pages = Array.from({ length: pageCount }, (_, index) => state.nextPage + index);
        const settled = await Promise.allSettled(pages.map(pageNo => fetchContentPage(
          pageNo,
          pageSize,
          state.conditions,
          capturedCtx.timeRangeType,
          capturedCtx.contentScene,
          capturedCtx.contentRequestTemplate
        )));
        state.nextPage += pageCount;
        state.pagesFetched += pageCount;

        const responses = settled.flatMap((result, index) => (
          result.status === 'fulfilled'
            ? [{ response: result.value, pageNo: pages[index] }]
            : []
        ));
        if (!responses.length) {
          state.consecutiveFailures += 1;
          if (state.consecutiveFailures >= 2) {
            state.done = true;
            state.failed = true;
          }
          return;
        }
        state.consecutiveFailures = 0;
        let roundRows = 0;
        let lastPageRows = [];
        let anyHasMore = false;
        responses.forEach(({ response, pageNo }) => {
          const responseRows = pageRows(response);
          lastPageRows = responseRows;
          roundRows += responseRows.length;
          state.scannedCount += responseRows.length;
          if (pageHasMore(response, pageNo, pageSize)) anyHasMore = true;
          responseRows.forEach(processCandidateRow);
        });
        if (roundRows === 0 || (!anyHasMore && lastPageRows.length === 0)) {
          state.done = true;
        }
      };

      const postProgress = (phase) => {
        window.postMessage({
          type: 'GH_FULL_CONTENT_SYNC_PROGRESS',
          requestId,
          loaded: rows.length,
          matched: matchedGroups.size,
          targetTotal: targetGroups.length,
          scanned: directScannedCount +
            states.reduce((sum, state) => sum + state.scannedCount, 0),
          batch: rounds,
          phase,
        }, '*');
      };

      const runStatesUntil = async (activeStates, phaseDeadline, phase, isFinalPhase) => {
        while (activeStates.some(state => !state.done) && matchedGroups.size < targetGroups.length) {
          if (Date.now() >= phaseDeadline) {
            if (isFinalPhase) timedOut = true;
            break;
          }
          await Promise.all(activeStates.map(scanState));
          rounds += 1;
          postProgress(phase);
        }
      };

      await runDirectLookup();
      postProgress('direct');
      await runStatesUntil(states, filteredDeadline, 'filtered', false);
      if (matchedGroups.size < targetGroups.length && Date.now() < deadline) {
        fallbackUsed = true;
        fallbackState = {
          code: 'all',
          name: '全部作品兼容回退',
          nextPage: 1,
          pagesFetched: 0,
          scannedCount: 0,
          consecutiveFailures: 0,
          done: false,
          capped: false,
          failed: false,
          conditions: contentConditionsForAsset(capturedCtx.contentConditions, 'all'),
        };
        states.push(fallbackState);
        await runStatesUntil([fallbackState], deadline, 'fallback', true);
      }
      resolveUniqueTitleMatches();

      const coverageStates = fallbackUsed ? [fallbackState] : states;
      const mappingPairCounts = new Map();
      rows.forEach((row) => {
        const groups = row && row.__ghMatch && Array.isArray(row.__ghMatch.targetGroups)
          ? row.__ghMatch.targetGroups
          : [];
        groups.forEach((group) => {
          (Array.isArray(group.evidence) ? group.evidence : []).forEach((entry) => {
            const key = [
              group.method || 'id',
              entry.wxtField || '候选ID',
              entry.guangheField || '候选ID',
            ].join('\u0000');
            mappingPairCounts.set(key, (mappingPairCounts.get(key) || 0) + 1);
          });
        });
      });
      const mappingPairs = Array.from(mappingPairCounts.entries())
        .map(([key, count]) => {
          const [method, wxtField, guangheField] = key.split('\u0000');
          return { method, wxtField, guangheField, count };
        })
        .sort((left, right) => right.count - left.count);
      const matchedRowsForDebug = rows.slice().sort((left, right) => {
        const hasRawTarget = (row) => {
          const groups = row && row.__ghMatch && Array.isArray(row.__ghMatch.targetGroups)
            ? row.__ghMatch.targetGroups
            : [];
          return groups.some((match) => {
            const target = targetGroups.find((group) => group.key === match.groupKey);
            return Boolean(target && target.rawSample);
          });
        };
        return Number(hasRawTarget(right)) - Number(hasRawTarget(left));
      }).slice(0, 2);
      const matchedPairSamples = matchedRowsForDebug.map((row) => {
        const guangheRaw = clonePlain(row);
        delete guangheRaw.__ghMatch;
        const matchGroups = row && row.__ghMatch && Array.isArray(row.__ghMatch.targetGroups)
          ? row.__ghMatch.targetGroups
          : [];
        const target = matchGroups.length
          ? (
              matchGroups
                .map((match) => targetGroups.find((group) => group.key === match.groupKey))
                .find((group) => group && group.rawSample) ||
              targetGroups.find((group) => group.key === matchGroups[0].groupKey)
            )
          : null;
        const mapping = target
          ? matchGroups.find((match) => match.groupKey === target.key) || matchGroups[0]
          : matchGroups[0] || null;
        return {
          mapping,
          wxtRaw: target && target.rawSample ? clonePlain(target.rawSample) : null,
          guangheRaw,
        };
      });
      return {
        rows,
        targetCount: targetGroups.length,
        matchedCount: matchedGroups.size,
        scannedCount: directScannedCount +
          states.reduce((sum, state) => sum + state.scannedCount, 0),
        pagesFetched: directPagesFetched +
          states.reduce((sum, state) => sum + state.pagesFetched, 0),
        complete: matchedGroups.size >= targetGroups.length || (
          !timedOut &&
          coverageStates.every(state => state.done) &&
          coverageStates.every(state => !state.capped && !state.failed)
        ),
        timedOut,
        capped: states.some(state => state.capped),
        failed: states.some(state => state.failed),
        fallbackUsed,
        directLookupUsed,
        directLookupMatched,
        mappingPairs,
        debugSamples: {
          wxtTargets: targetGroups.filter((group) => group.rawSample).slice(0, 2),
          guangheRows: rawScannedSamples,
          matchedPairs: matchedPairSamples,
        },
      };
    }

    // 抓一批商品数据（消费 + 供给合并）
    function productRowKey(row) {
      if (!row || typeof row !== 'object') return '';
      const itemInfo = row.itemInfo || {};
      const id = apiScalar(row.itemId) || apiScalar(itemInfo.itemId) || apiScalar(row.id);
      return id == null ? '' : String(id);
    }

    async function fetchProductBatch(pageFrom, pageCount, targetRows) {
      const ctx = capturedCtx;
      const pageSize = 100;
      const target = targetRows || (pageCount * pageSize);
      const maxPages = Math.max(pageCount, Math.ceil(target / 10) + pageCount);
      const supplyPromise = Promise.all(Array.from({length: 10}, (_, i) => i + 1).map(p =>
        fetchProductPage(p, pageSize, ctx.productConditions, ctx.timeRangeType, ctx.timeRangeBegin, ctx.timeRangeEnd,
          'itemAnalysisSupply', 'totalPublishPubContentCnt:absolute:desc,itemId:absolute:desc',
          ['publishPubContentCnt','totalPublishPubContentCnt']).catch(() => null)
      ));

      const consumeRows = [];
      const seen = new Set();
      let pagesFetched = 0;
      let hasMore = false;
      while (consumeRows.length < target && pagesFetched < maxPages) {
        const count = Math.min(pageCount, maxPages - pagesFetched);
        const pages = Array.from({ length: count }, (_, index) => pageFrom + pagesFetched + index);
        const settled = await Promise.allSettled(pages.map(p =>
          fetchProductPage(p, pageSize, ctx.productConditions, ctx.timeRangeType, ctx.timeRangeBegin, ctx.timeRangeEnd,
          'itemAnalysisConsume', 'payAmtZcLast:absolute:desc,itemId:absolute:desc',
           ['consumePv','consumeUv','consumeTimeAvgPv','detailIpvPv','ipvPv',
            'payAmtZcLast','payOrderCntZcLast','expoPv','clickPv','consumePvValid','consumeUvValid'])
        ));
        pagesFetched += pages.length;
        const successful = settled.filter(result => result.status === 'fulfilled');
        if (!successful.length) {
          const failed = settled.find(result => result.status === 'rejected');
          throw (failed && failed.reason) || new Error('商品分页请求失败');
        }

        let batchAdded = 0;
        let batchRawRows = 0;
        let batchHasMore = false;
        settled.forEach((result, index) => {
          if (result.status !== 'fulfilled') return;
          const responseRows = pageRows(result.value);
          batchRawRows += responseRows.length;
          if (pageHasMore(result.value, pages[index], pageSize)) batchHasMore = true;
          responseRows.forEach(row => {
            const key = productRowKey(row);
            if (key && seen.has(key)) return;
            if (key) seen.add(key);
            consumeRows.push(row);
            batchAdded += 1;
          });
        });
        hasMore = batchHasMore;
        if (consumeRows.length >= target) {
          hasMore = hasMore || batchRawRows > 0;
          break;
        }
        if (!batchHasMore && (batchRawRows === 0 || batchAdded === 0)) break;
      }

      const supplyResults = await supplyPromise;
      const supplyMap = {};
      for (const res of supplyResults) {
        if (!res) continue;
        for (const row of pageRows(res)) {
          const id = row.itemId && row.itemId.absolute ? String(row.itemId.absolute) : null;
          if (id) supplyMap[id] = row;
        }
      }

      const mergedRows = consumeRows.map(row => {
        const id = row.itemId && row.itemId.absolute ? String(row.itemId.absolute) : null;
        row.__supplyRow = id ? (supplyMap[id] || null) : null;
        return row;
      });
      return {
        rows: mergedRows,
        hasMore: hasMore || mergedRows.length >= target,
        nextPage: pageFrom + pagesFetched,
      };
    }

    // ===== 资产总览渠道诊断：复用页面真实 MTop 请求与筛选口径 =====
    // “全部”通常是页面默认值，放到最后可确保每次选择都会真实触发接口请求。
    const CHANNEL_DIAGNOSIS_LIST = ['首猜', '逛逛', '搜索', '其他', '全部'];
    const CHANNEL_BIZ_LINES = {
      '首猜': 'cnxh',
      '逛逛': 'guangguang',
      '搜索': 'csearch',
      '其他': 'other',
      '全部': 'all',
    };
    const CHANNEL_ASSET_TYPES = [
      { code: 'all', name: '全部资产' },
      { code: 'self', name: '自制内容' },
      { code: 'business', name: '达人合作内容' },
      { code: 'ugc', name: '其他用户内容' },
    ];

    function channelSleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function channelVisible(element) {
      if (!element) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    }

    function channelNormalize(value) {
      return String(value || '')
        .replace(/[\uE000-\uF8FF]/g, '')
        .replace(/\s+/g, '')
        .replace(/[：:]/g, '')
        .trim();
    }

    function channelControl() {
      const labels = Array.from(document.querySelectorAll('label.next-input-label'))
        .filter(element => channelVisible(element) && channelNormalize(element.textContent) === '消费渠道');
      for (const label of labels) {
        const select = label.closest('.next-select');
        if (select && channelVisible(select)) return select;
      }
      return null;
    }

    function selectedChannel() {
      const control = channelControl();
      if (!control) return '';
      const titled = control.querySelector('em[title]');
      if (titled && titled.getAttribute('title')) return channelNormalize(titled.getAttribute('title'));
      const input = control.querySelector('input[aria-valuetext]');
      return input ? channelNormalize(input.getAttribute('aria-valuetext')) : '';
    }

    function channelOption(channel, control) {
      const normalized = channelNormalize(channel);
      const controlRect = control.getBoundingClientRect();
      // 光合使用 Fusion Next 的 portal 下拉。只查 select 专用的 option，
      // 避免把左侧导航（同样是 role=option / next-menu-item）误判成渠道选项。
      const candidates = Array.from(document.querySelectorAll(
        'li.next-select-menu-item[role="option"],[role="option"][class*="select-menu-item"]'
      )).filter(element => {
        if (!channelVisible(element) || control.contains(element)) return false;
        const popup = element.closest('.next-overlay-inner');
        const popupRect = popup && popup.getBoundingClientRect();
        // 三个筛选器都含“全部”，弹层与触发器左边缘对齐；据此锁定消费渠道弹层。
        if (!popupRect ||
            Math.abs(popupRect.left - controlRect.left) > Math.max(24, controlRect.width * 0.2)) {
          return false;
        }
        const title = channelNormalize(element.getAttribute('title'));
        const textNode = element.querySelector('.next-menu-item-text');
        const text = channelNormalize(
          (textNode && (textNode.innerText || textNode.textContent)) ||
          element.innerText || element.textContent
        );
        return title === normalized || text === normalized;
      });
      candidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const leftDistance = Math.abs(leftRect.left - controlRect.left) + Math.abs(leftRect.top - controlRect.bottom);
        const rightDistance = Math.abs(rightRect.left - controlRect.left) + Math.abs(rightRect.top - controlRect.bottom);
        return leftDistance - rightDistance;
      });
      return candidates[0] || null;
    }

    async function openChannelOption(channel, control) {
      // 下拉由 portal 异步挂到 body；动画和接口刷新期间 220ms 并不稳定。
      // 每次最多等待 2.5 秒，失败后关闭并重开一次。
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let option = channelOption(channel, control);
        if (option) return option;

        const trigger = control.querySelector('input[role="combobox"]') || control;
        trigger.click();
        const startedAt = Date.now();
        while (Date.now() - startedAt < 2500) {
          await channelSleep(100);
          option = channelOption(channel, control);
          if (option) return option;
        }

        // 本次点击可能正好关闭了残留弹层；确保下一轮从关闭状态重新打开。
        if (control.getAttribute('aria-expanded') === 'true') {
          trigger.click();
          await channelSleep(160);
        }
      }
      return null;
    }

    function periodControl(period) {
      return Array.from(document.querySelectorAll('div[class*="radioBtn"]')).find(element => (
        channelVisible(element) && channelNormalize(element.textContent) === period
      )) || null;
    }

    function selectedPeriod() {
      const selected = Array.from(document.querySelectorAll('div[class*="radioBtn"]')).find(element => (
        channelVisible(element) &&
        /radioActive/i.test(String(element.className || '')) &&
        ['日', '7日', '30日'].includes(channelNormalize(element.textContent))
      ));
      return selected ? channelNormalize(selected.textContent) : '';
    }

    function selectedDateRange() {
      const pattern = /\d{4}\.\d{2}\.\d{2}\s*-\s*\d{4}\.\d{2}\.\d{2}/;
      const element = Array.from(document.querySelectorAll('div,span'))
        .find(node => channelVisible(node) && node.children.length <= 2 && pattern.test(node.textContent || ''));
      const matched = element && String(element.textContent || '').match(pattern);
      return matched ? matched[0].replace(/\s+/g, ' ') : '';
    }

    function visibleSeedingGmvShare() {
      const labelPattern = /种草成交金额(?:占全店|占比全店|占比)/;
      const labels = Array.from(document.querySelectorAll('div,span,p,label'))
        .filter((element) => {
          if (!channelVisible(element)) return false;
          const text = channelNormalize(element.textContent);
          return text.length <= 60 && labelPattern.test(text);
        })
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
        });
      for (const label of labels) {
        let container = label;
        for (let depth = 0; depth < 5 && container && container !== document.body; depth += 1) {
          const text = channelNormalize(container.innerText || container.textContent);
          if (text.length <= 500) {
            const matched = text.match(/种草成交金额(?:占全店|占比全店|占比)[^\d-]{0,24}(-?\d+(?:\.\d+)?)%/);
            if (matched) {
              const value = Number(matched[1]) / 100;
              if (Number.isFinite(value) && value >= 0 && value <= 1) return value;
            }
          }
          container = container.parentElement;
        }
      }
      return null;
    }

    async function selectPeriod(period) {
      if (selectedPeriod() === period) return;
      const control = periodControl(period);
      if (!control) throw new Error('未找到光合资产总览的“' + period + '”统计周期。');
      control.click();
      const startedAt = Date.now();
      while (Date.now() - startedAt < 8000 && selectedPeriod() !== period) {
        await channelSleep(180);
      }
      if (selectedPeriod() !== period) {
        throw new Error('光合资产总览未能切换到“' + period + '”统计周期。');
      }
      // 周期变化会刷新整组指标，等待页面请求稳定后再逐个切换渠道。
      await channelSleep(1000);
    }

    async function selectChannelForRequest(channel) {
      if (selectedChannel() === channel) {
        throw new Error('“' + channel + '”已是当前渠道，未触发新的接口请求。');
      }
      const control = channelControl();
      if (!control) throw new Error('未找到光合页面的“消费渠道”筛选控件。');
      const option = await openChannelOption(channel, control);
      if (!option) throw new Error('消费渠道中未找到“' + channel + '”。');
      option.click();
      const startedAt = Date.now();
      while (Date.now() - startedAt < 5000 && selectedChannel() !== channel) {
        await channelSleep(120);
      }
      if (selectedChannel() !== channel) {
        throw new Error('消费渠道未能切换到“' + channel + '”。');
      }
    }

    async function prepareChannelRequest(channel) {
      if (selectedChannel() !== channel) return;
      const temporaryChannel = CHANNEL_DIAGNOSIS_LIST.find(candidate => candidate !== channel) || '全部';
      await restoreChannel(temporaryChannel);
      if (selectedChannel() !== temporaryChannel) {
        throw new Error('无法临时切换消费渠道以刷新“' + channel + '”接口数据。');
      }
      // 等待临时渠道自身的请求结束，避免被下一次接口捕获混入。
      await channelSleep(700);
    }

    async function restoreChannel(channel) {
      if (!channel || selectedChannel() === channel) return;
      const control = channelControl();
      if (!control) return;
      const option = await openChannelOption(channel, control);
      if (option) {
        option.click();
        const startedAt = Date.now();
        while (Date.now() - startedAt < 5000 && selectedChannel() !== channel) {
          await channelSleep(180);
        }
      }
    }

    function apiMetricNumber(value) {
      const raw = value && typeof value === 'object'
        ? (value.absolute != null ? value.absolute : value.absoluteFormat != null ? value.absoluteFormat : value)
        : value;
      const text = String(raw == null ? '' : raw).replace(/[¥￥,\s，]/g, '');
      const matched = text.match(/^(-?(?:\d+\.?\d*|\.\d+))(万|亿)?$/);
      if (!matched) return null;
      const unit = matched[2] === '亿' ? 100000000 : matched[2] === '万' ? 10000 : 1;
      const number = Number(matched[1]) * unit;
      return Number.isFinite(number) ? number : null;
    }

    function apiRatioNumber(value) {
      let raw = value;
      if (value && typeof value === 'object') {
        raw = value.ratio ?? value.rate ?? value.percent ?? value.share ??
          value.currentValue ?? value.indicatorValue ?? value.metricValue ??
          value.value ?? value.absolute;
      }
      const text = String(raw == null ? '' : raw).replace(/[\s，,]/g, '');
      const matched = text.match(/^(-?(?:\d+\.?\d*|\.\d+))(%?)$/);
      if (!matched) return null;
      let number = Number(matched[1]);
      if (!Number.isFinite(number)) return null;
      if (matched[2] === '%' || Math.abs(number) > 1) number /= 100;
      return number >= 0 && number <= 1 ? number : null;
    }

    function isSeedingGmvShareIdentity(value) {
      const normalized = String(value || '').toLowerCase().replace(/[\s_\-.：:]/g, '');
      const isSeedingAmount = normalized.includes('payamtzc') || normalized.includes('种草成交金额');
      const isShare = /(share|ratio|rate|percent|pct|proportion|占全店|占比)/.test(normalized);
      return isSeedingAmount && isShare;
    }

    function mergeSeedingGmvShareCandidate(accumulator, rawValue, path, apiName, directField) {
      const value = apiRatioNumber(rawValue);
      if (!Number.isFinite(value)) return;
      const normalizedPath = String(path || '').toLowerCase();
      let score = directField ? 90 : 65;
      if (/种草成交金额(?:占全店|占比)/.test(String(path || ''))) score += 20;
      if (/(summary|overview|core|indicator|current)/.test(normalizedPath)) score += 10;
      if (/(compare|relative|trend|daily|history|yoy|mom)/.test(normalizedPath)) score -= 100;
      const candidate = { value, score, path, apiName };
      if (!accumulator.seedingGmvShare || candidate.score > accumulator.seedingGmvShare.score) {
        accumulator.seedingGmvShare = candidate;
      }
    }

    const CHANNEL_METRIC_FIELDS = {
      consumeUv: 'contentViewers',
      ipvUv: 'productClickers',
      cartUv: 'cartBuyers',
      payBuyerCntZc: 'seedingBuyers',
      payAmtZcLast: 'seedingAmount',
    };

    function channelMetricPathScore(path, hasAbsolute, directField) {
      const normalized = String(path || '').toLowerCase();
      let score = directField ? 40 : 22;
      if (hasAbsolute) score += 30;
      if (/(^|\.)(model|result|summary|overview|core|indicator|index|current)(\.|$)/.test(normalized)) score += 12;
      if (/(compare|relative|ratio|rate|trend|chart|series|daily|date|history|distribution)/.test(normalized)) score -= 45;
      return score;
    }

    function mergeChannelMetricCandidate(accumulator, field, rawValue, path, apiName, directField) {
      const outputKey = CHANNEL_METRIC_FIELDS[field];
      if (!outputKey) return;
      const hasAbsolute = !!(rawValue && typeof rawValue === 'object' && rawValue.absolute != null);
      const value = apiMetricNumber(rawValue);
      if (!Number.isFinite(value)) return;
      const candidate = {
        value,
        score: channelMetricPathScore(path, hasAbsolute, directField),
        path,
        apiName,
      };
      if (!accumulator[outputKey] || candidate.score > accumulator[outputKey].score) {
        accumulator[outputKey] = candidate;
      }
    }

    // 光合资产总览会把核心指标拆在不同响应/不同层级中返回。
    // 这里只解析 MTop 原始响应并跨响应聚合，不读取页面上渲染后的数字。
    function collectChannelMetricCandidates(payload, apiName, accumulator) {
      const queue = [{ value: payload, path: 'data' }];
      const seen = new Set();
      let inspected = 0;
      while (queue.length && inspected < 20000) {
        const item = queue.shift();
        let current = item.value;
        const path = item.path;
        if (typeof current === 'string') {
          const trimmed = current.trim();
          if (trimmed.length > 1 && trimmed.length < 2000000 &&
              ((trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') ||
               (trimmed[0] === '[' && trimmed[trimmed.length - 1] === ']'))) {
            try {
              current = JSON.parse(trimmed);
            } catch (error) {
              continue;
            }
          }
        }
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);
        inspected += 1;

        for (const field of Object.keys(CHANNEL_METRIC_FIELDS)) {
          if (Object.prototype.hasOwnProperty.call(current, field)) {
            mergeChannelMetricCandidate(
              accumulator, field, current[field], path + '.' + field, apiName, true
            );
          }
        }
        for (const key of Object.keys(current)) {
          if (isSeedingGmvShareIdentity(key)) {
            mergeSeedingGmvShareCandidate(
              accumulator, current[key], path + '.' + key, apiName, true
            );
          }
        }

        const identityKeys = ['indicatorCode', 'indicatorKey', 'metricCode', 'metricKey', 'fieldCode', 'field', 'code', 'key'];
        const valueKeys = ['absolute', 'currentValue', 'indicatorValue', 'metricValue', 'value'];
        const identity = identityKeys
          .map(key => current[key])
          .find(value => typeof value === 'string' && CHANNEL_METRIC_FIELDS[value]);
        if (identity) {
          for (const valueKey of valueKeys) {
            if (Object.prototype.hasOwnProperty.call(current, valueKey)) {
              mergeChannelMetricCandidate(
                accumulator, identity, current[valueKey],
                path + '.' + identity + '.' + valueKey, apiName, false
              );
            }
          }
        }
        const seedingShareIdentity = identityKeys
          .map(key => current[key])
          .find(value => typeof value === 'string' && isSeedingGmvShareIdentity(value));
        if (seedingShareIdentity) {
          for (const valueKey of ['ratio', 'rate', 'percent', 'share', 'currentValue', 'indicatorValue', 'metricValue', 'value', 'absolute']) {
            if (!Object.prototype.hasOwnProperty.call(current, valueKey)) continue;
            mergeSeedingGmvShareCandidate(
              accumulator, current[valueKey],
              path + '.' + seedingShareIdentity + '.' + valueKey, apiName, false
            );
          }
        }

        for (const key of Object.keys(current)) {
          const child = current[key];
          if (child && (typeof child === 'object' || typeof child === 'string')) {
            queue.push({ value: child, path: path + '.' + key });
          }
        }
      }
    }

    function channelMetricsFromAccumulator(accumulator) {
      const metricValue = key => {
        const candidate = accumulator[key];
        return candidate && Number.isFinite(candidate.value) ? candidate.value : 0;
      };
      const contentViewers = metricValue('contentViewers');
      const productClickers = metricValue('productClickers');
      const cartBuyers = metricValue('cartBuyers');
      const seedingBuyers = metricValue('seedingBuyers');
      const seedingAmount = metricValue('seedingAmount');
      const paidTrafficShare = accumulator.paidTrafficShare &&
        accumulator.paidTrafficShare.value;
      const seedingGmvShare = accumulator.seedingGmvShare &&
        accumulator.seedingGmvShare.value;
      return Number.isFinite(contentViewers) && Number.isFinite(productClickers) &&
        Number.isFinite(cartBuyers) && Number.isFinite(seedingBuyers) &&
        Number.isFinite(seedingAmount)
        ? {
          contentViewers,
          paidTrafficShare: Number.isFinite(paidTrafficShare) ? paidTrafficShare : null,
          productClickers,
          cartBuyers,
          seedingBuyers,
          seedingAmount,
          seedingGmvShare: Number.isFinite(seedingGmvShare) ? seedingGmvShare : null,
        }
        : null;
    }

    function paidTrafficNumber(value) {
      const raw = value && typeof value === 'object'
        ? (value.ratio != null ? value.ratio
          : value.rate != null ? value.rate
            : value.percent != null ? value.percent
              : value.share != null ? value.share
                : value.value != null ? value.value
                  : value.absolute != null ? value.absolute : value)
        : value;
      const text = String(raw == null ? '' : raw).replace(/[\s，,]/g, '');
      const matched = text.match(/^(-?(?:\d+\.?\d*|\.\d+))(%|％)?$/);
      if (!matched) return null;
      const number = Number(matched[1]);
      if (!Number.isFinite(number)) return null;
      return matched[2] ? number / 100 : number;
    }

    function paidTrafficEntryValue(entry) {
      if (!entry || typeof entry !== 'object') return paidTrafficNumber(entry);
      const preferred = ['ratio', 'rate', 'percent', 'share', 'value', 'absolute', 'currentValue'];
      for (const key of preferred) {
        if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
        const value = paidTrafficNumber(entry[key]);
        if (Number.isFinite(value)) return value;
      }
      return null;
    }

    function supplyMetricsFromResponse(payload) {
      const queue = [payload];
      const seen = new Set();
      let inspected = 0;
      let publishedContents = null;
      let publicContents = null;
      while (queue.length && inspected < 5000) {
        let current = queue.shift();
        if (typeof current === 'string') {
          const trimmed = current.trim();
          if (trimmed.length > 1 && trimmed.length < 2000000 &&
              ((trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') ||
               (trimmed[0] === '[' && trimmed[trimmed.length - 1] === ']'))) {
            try { current = JSON.parse(trimmed); } catch (error) {}
          }
        }
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);
        inspected += 1;
        if (!Array.isArray(current)) {
          if (Object.prototype.hasOwnProperty.call(current, 'publishAllContentCnt')) {
            const value = apiMetricNumber(current.publishAllContentCnt);
            if (Number.isFinite(value)) publishedContents = value;
          }
          if (Object.prototype.hasOwnProperty.call(current, 'publicContentCnt')) {
            const value = apiMetricNumber(current.publicContentCnt);
            if (Number.isFinite(value)) publicContents = value;
          }
          if (Number.isFinite(publishedContents) && Number.isFinite(publicContents)) {
            return { publishedContents, publicContents };
          }
        }
        for (const key of Object.keys(current)) {
          const child = current[key];
          if (child && (typeof child === 'object' || typeof child === 'string')) {
            queue.push(child);
          }
        }
      }
      if (Number.isFinite(publishedContents) || Number.isFinite(publicContents)) {
        return {
          publishedContents: Number.isFinite(publishedContents) ? publishedContents : 0,
          publicContents: Number.isFinite(publicContents) ? publicContents : 0,
        };
      }
      return null;
    }

    function emptySupplyMetrics() {
      return { publishedContents: 0, publicContents: 0 };
    }

    function fetchSupplyAssetMetrics(assetCode, range) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('内容供给接口请求超时')), 20000);
        window.lib.mtop.request({
          api: 'mtop.taobao.guangguang.creator.gateway.oneservice.kind.list',
          v: '1.0',
          data: {
            source: 'guanghe',
            timeRangeType: '30',
            scene: 'contentAssertKeyIndicatorsV1Supply',
            conditions: JSON.stringify({
              content_type: range.contentType || 'all',
              stat_date: range.statDate,
              end_date: range.endDate,
              retainLatestDs: true,
              retainChosenDs: true,
              belong_type_lvl1: assetCode,
              belong_type_lvl2: 'all',
            }),
          },
        }).then(response => {
          clearTimeout(timer);
          const metrics = supplyMetricsFromResponse(response);
          if (!metrics) {
            console.warn(TAG, '内容供给接口缺少发布内容数或公域内容数，按 0 展示:', assetCode);
            resolve(emptySupplyMetrics());
            return;
          }
          resolve(metrics);
        }, error => {
          clearTimeout(timer);
          reject(error);
        });
      });
    }

    async function fetchSupplyMetrics(range) {
      if (!range || !range.statDate || !range.endDate) {
        const output = {};
        CHANNEL_ASSET_TYPES.forEach(asset => { output[asset.code] = emptySupplyMetrics(); });
        return output;
      }
      const pairs = await Promise.all(CHANNEL_ASSET_TYPES.map(async asset => (
        [asset.code, await fetchSupplyAssetMetrics(asset.code, range).catch(error => {
          console.warn(TAG, '内容供给接口读取失败，按 0 展示:', asset.code, error);
          return emptySupplyMetrics();
        })]
      )));
      const output = {};
      pairs.forEach(pair => { output[pair[0]] = pair[1]; });
      return output;
    }

    function supplyRangeFromDateText(dateRange) {
      const dates = String(dateRange || '').match(/\d{4}[.-]\d{2}[.-]\d{2}/g) || [];
      if (dates.length < 2) return null;
      return {
        statDate: dates[0].replace(/\D/g, ''),
        endDate: dates[dates.length - 1].replace(/\D/g, ''),
        contentType: 'all',
      };
    }

    async function fetchBusinessDefenseMetrics(opts) {
      const originalChannel = selectedChannel() || '全部';
      const originalPeriod = selectedPeriod();
      window.postMessage({
        type: 'GH_CHANNEL_DIAGNOSIS_PROGRESS',
        channel: '30日指标',
        index: 1,
        total: 2,
      }, '*');
      try {
        await selectPeriod('30日');
        let diagnosisDateRange = selectedDateRange();
        let supplyRange = supplyRangeFromDateText(diagnosisDateRange);
        let seedingGmvShare = visibleSeedingGmvShare();

        // 页面未直接渲染占比或日期时，只刷新一次“全部”渠道取接口口径。
        // 不再遍历首猜、逛逛、搜索、其他及全部资产矩阵。
        if (!supplyRange || !Number.isFinite(seedingGmvShare)) {
          await prepareChannelRequest('全部');
          const channelResult = await captureChannelMetrics('全部');
          const overallRow = channelResult.rows.find(row => row.assetCode === 'all');
          if (!Number.isFinite(seedingGmvShare) && overallRow &&
              Number.isFinite(overallRow.seedingGmvShare)) {
            seedingGmvShare = overallRow.seedingGmvShare;
          }
          if (!diagnosisDateRange && channelResult.dateRange) {
            diagnosisDateRange = channelResult.dateRange;
          }
          if (!supplyRange && channelResult.supplyRange) {
            supplyRange = channelResult.supplyRange;
          }
        }

        if (!supplyRange) throw new Error('未能识别光合30日数据范围。');
        if (!Number.isFinite(seedingGmvShare)) {
          throw new Error('未找到光合30日“种草成交金额占比”。');
        }
        window.postMessage({
          type: 'GH_CHANNEL_DIAGNOSIS_PROGRESS',
          channel: '自制内容供给',
          index: 2,
          total: 2,
        }, '*');
        const supply = await fetchSupplyAssetMetrics('self', supplyRange);
        const rows = [{
          channel: '全部',
          asset: '自制内容',
          assetCode: 'self',
          publishedContents: supply.publishedContents,
          publicContents: supply.publicContents,
        }];

        await restoreChannel(originalChannel);
        if (originalPeriod && originalPeriod !== '30日') await selectPeriod(originalPeriod);
        window.postMessage({
          type: 'GH_CHANNEL_DIAGNOSIS_DATA',
          metricsOnly: true,
          rows,
          seedingGmvShare,
          filterContext: Object.assign({}, (opts && opts.visibleFilters) || {}, {
            '统计周期': diagnosisDateRange || '最近30天',
          }),
        }, '*');
      } catch (error) {
        await restoreChannel(originalChannel);
        if (originalPeriod && originalPeriod !== selectedPeriod()) {
          try { await selectPeriod(originalPeriod); } catch (restoreError) {}
        }
        window.postMessage({
          type: 'GH_CHANNEL_DIAGNOSIS_ERROR',
          metricsOnly: true,
          message: error && error.message ? error.message : String(error),
        }, '*');
      }
    }

    function normalizePaidTrafficPair(paidValue, freeValue) {
      if (!Number.isFinite(paidValue)) return null;
      if (!Number.isFinite(freeValue)) {
        if (paidValue >= 0 && paidValue <= 1) return paidValue;
        if (paidValue >= 0 && paidValue <= 100) return paidValue / 100;
        return null;
      }
      const total = paidValue + freeValue;
      if (total === 0) return 0;
      if (total < 0) return null;
      if (paidValue <= 1 && freeValue <= 1 && total <= 1.01) return paidValue;
      return paidValue / total;
    }

    // 渠道分布接口返回“付费流量/免费流量”两项；兼容数组、键值表和
    // name/value 等不同包装，始终用后端原始值计算占比，不读取圆环图 DOM。
    function extractPaidTrafficShare(payload) {
      const queue = [payload];
      const seen = new Set();
      let inspected = 0;
      while (queue.length && inspected < 20000) {
        let current = queue.shift();
        if (typeof current === 'string') {
          const trimmed = current.trim();
          if (trimmed.length > 1 && trimmed.length < 2000000 &&
              ((trimmed[0] === '{' && trimmed[trimmed.length - 1] === '}') ||
               (trimmed[0] === '[' && trimmed[trimmed.length - 1] === ']'))) {
            try { current = JSON.parse(trimmed); } catch (error) {}
          }
        }
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);
        inspected += 1;

        // 光合核心指标接口用这两个内部字段生成页面“渠道分布”。
        // 字段名与前台文案是反直觉映射：实测同一响应中，前台“付费流量”
        // 对应 freeConsumePv，“免费流量”对应 notFreeConsumePv。
        // 因此付费占比 = freeConsumePv ÷ (freeConsumePv + notFreeConsumePv)。
        if (!Array.isArray(current) &&
            Object.prototype.hasOwnProperty.call(current, 'notFreeConsumePv')) {
          const paidValue = apiMetricNumber(current.freeConsumePv);
          const freeValue = apiMetricNumber(current.notFreeConsumePv);
          const share = normalizePaidTrafficPair(paidValue, freeValue);
          if (Number.isFinite(share)) return share;
        }

        if (Array.isArray(current)) {
          let paidValue = null;
          let freeValue = null;
          for (const entry of current) {
            if (!entry || typeof entry !== 'object') continue;
            const label = Object.values(entry)
              .find(value => typeof value === 'string' &&
                (value.includes('付费流量') || value.includes('免费流量')));
            if (!label) continue;
            const value = paidTrafficEntryValue(entry);
            if (label.includes('付费流量')) paidValue = value;
            if (label.includes('免费流量')) freeValue = value;
          }
          const share = normalizePaidTrafficPair(paidValue, freeValue);
          if (Number.isFinite(share)) return share;
        } else {
          let paidValue = null;
          let freeValue = null;
          for (const key of Object.keys(current)) {
            if (key.includes('付费流量')) paidValue = paidTrafficNumber(current[key]);
            if (key.includes('免费流量')) freeValue = paidTrafficNumber(current[key]);
          }
          const share = normalizePaidTrafficPair(paidValue, freeValue);
          if (Number.isFinite(share)) return share;
        }

        for (const key of Object.keys(current)) {
          const child = current[key];
          if (child && (typeof child === 'object' || typeof child === 'string')) {
            queue.push(child);
          }
        }
      }
      return null;
    }

    function channelResponseShape(payload) {
      const queue = [{ value: payload, path: 'response', depth: 0 }];
      const seen = new Set();
      const parts = [];
      while (queue.length && parts.length < 12) {
        const item = queue.shift();
        let value = item.value;
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if ((trimmed[0] === '{' || trimmed[0] === '[') && trimmed.length < 2000000) {
            try { value = JSON.parse(trimmed); } catch (error) {}
          }
        }
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value);
        const keys = Object.keys(value);
        parts.push(item.path + '{' + keys.slice(0, 12).join(',') + '}');
        if (item.depth >= 3) continue;
        for (const key of keys.slice(0, 20)) {
          const child = value[key];
          if (child && (typeof child === 'object' || typeof child === 'string')) {
            queue.push({ value: child, path: item.path + '.' + key, depth: item.depth + 1 });
          }
        }
      }
      return parts.join(' > ');
    }

    function channelDateText(value) {
      const text = String(value || '').replace(/\D/g, '');
      return text.length === 8
        ? text.slice(0, 4) + '.' + text.slice(4, 6) + '.' + text.slice(6, 8)
        : String(value || '');
    }

    function captureChannelMetrics(channel) {
      return new Promise((resolve, reject) => {
        const accumulators = {};
        const completed = {};
        CHANNEL_ASSET_TYPES.forEach(asset => { accumulators[asset.code] = {}; });
        const observedApis = new Set();
        const responseShapes = new Set();
        let dateRange = '';
        let supplyRange = null;
        let settled = false;
        let completionTimer = null;
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          clearTimeout(completionTimer);
          mtopResponseObservers.delete(inspectMtopResult);
          if (error) reject(error); else resolve(result);
        };
        const timeout = setTimeout(() => {
          const found = CHANNEL_ASSET_TYPES
            .filter(asset => completed[asset.code])
            .map(asset => asset.name)
            .join('、') || '无';
          const apis = Array.from(observedApis).slice(0, 6).join('、') || '无';
          finish(new Error(
            '等待“' + channel + '”渠道资产指标接口超时（已完成：' + found + '；接口：' + apis +
            '；结构：' + (Array.from(responseShapes)[0] || '无') + '）。'
          ));
        }, 18000);

        function inspectResponse(response, apiName, assetCode) {
          try {
            if (responseShapes.size < 3) responseShapes.add(channelResponseShape(response));
            const paidTrafficShare = extractPaidTrafficShare(response);
            if (Number.isFinite(paidTrafficShare) && accumulators[assetCode]) {
              accumulators[assetCode].paidTrafficShare = {
                value: paidTrafficShare,
                score: 100,
                path: 'channelDistribution',
                apiName,
              };
            }
            collectChannelMetricCandidates(response, apiName, accumulators[assetCode]);
            const metrics = channelMetricsFromAccumulator(accumulators[assetCode]);
            if (metrics) completed[assetCode] = metrics;
            if (CHANNEL_ASSET_TYPES.every(asset => completed[asset.code])) {
              // 渠道分布与核心卡片是并发响应，给付费占比响应留出短暂聚合时间。
              clearTimeout(completionTimer);
              completionTimer = setTimeout(() => {
                finish(null, {
                  rows: CHANNEL_ASSET_TYPES.map(asset => Object.assign({
                    channel,
                    asset: asset.name,
                    assetCode: asset.code,
                  }, channelMetricsFromAccumulator(accumulators[asset.code]))),
                  dateRange,
                  supplyRange,
                });
              }, 1200);
            }
          } catch (error) {
            console.warn(TAG, '解析渠道指标响应失败:', apiName, error);
          }
        }

        function inspectMtopResult(entry) {
          const apiName = entry.apiName;
          // pagelist 是作品/商品明细，不可用明细首行冒充资产总览汇总数据。
          if (apiName.includes('pagelist')) return;
          let requestData = entry.opts && entry.opts.data;
          if (typeof requestData === 'string') {
            try { requestData = JSON.parse(requestData); } catch (error) {}
          }
          const scene = String(requestData && requestData.scene || '');
          let conditions = requestData && requestData.conditions;
          if (typeof conditions === 'string') {
            try { conditions = JSON.parse(conditions); } catch (error) {}
          }
          let assetCode = '';
          assetCode = String(conditions && conditions.belong_type_lvl1 || '');
          // 资产总览还会并发请求选型分析；核心人数与金额只取核心指标场景。
          if (scene === 'contentAssertKeyIndicatorsV1') {
            // 同一场景还会并发趋势请求；只采用最近30天、核心卡片口径。
            if (String(requestData && requestData.timeRangeType || '') !== '30' ||
                !conditions || !CHANNEL_ASSET_TYPES.some(asset => asset.code === assetCode) ||
                String(conditions.biz_line || '') !== CHANNEL_BIZ_LINES[channel] ||
                conditions.retainLatestDs !== true || conditions.retainChosenDs !== true) {
              return;
            }
            if (conditions.stat_date && conditions.end_date) {
              dateRange = channelDateText(conditions.stat_date) + ' - ' + channelDateText(conditions.end_date);
              supplyRange = {
                statDate: String(conditions.stat_date),
                endDate: String(conditions.end_date),
                contentType: String(conditions.content_type || 'all'),
              };
            }
          } else {
            return;
          }
          if (apiName) observedApis.add(apiName + (scene ? '[' + scene + ']' : ''));
          inspectResponse(entry.response, apiName, assetCode);
        }

        mtopResponseObservers.add(inspectMtopResult);
        selectChannelForRequest(channel).catch(error => finish(error));
      });
    }

    window.__ghFetchChannelDiagnosis = async function (opts) {
      if (opts && opts.metricsOnly) {
        await fetchBusinessDefenseMetrics(opts);
        return;
      }
      const originalChannel = selectedChannel() || '全部';
      const originalPeriod = selectedPeriod();
      window.postMessage({ type: 'GH_CHANNEL_DIAGNOSIS_PROGRESS', channel: '', index: 0, total: CHANNEL_DIAGNOSIS_LIST.length }, '*');
      try {
        await selectPeriod('30日');
        const rows = [];
        let supplyRange = null;
        // 展示口径取页面已确认的30天实际区间；接口中的 stat_date 可能是最新产出日。
        let diagnosisDateRange = selectedDateRange();
        for (let index = 0; index < CHANNEL_DIAGNOSIS_LIST.length; index += 1) {
          const channel = CHANNEL_DIAGNOSIS_LIST[index];
          window.postMessage({
            type: 'GH_CHANNEL_DIAGNOSIS_PROGRESS',
            channel,
            index: index + 1,
            total: CHANNEL_DIAGNOSIS_LIST.length,
          }, '*');
          await prepareChannelRequest(channel);
          const channelResult = await captureChannelMetrics(channel);
          rows.push.apply(rows, channelResult.rows);
          if (!diagnosisDateRange && channelResult.dateRange) diagnosisDateRange = channelResult.dateRange;
          if (!supplyRange && channelResult.supplyRange) supplyRange = channelResult.supplyRange;
        }
        const supplyByAsset = await fetchSupplyMetrics(supplyRange);
        rows.forEach(row => {
          if (row.channel !== '全部' || !supplyByAsset[row.assetCode]) return;
          Object.assign(row, supplyByAsset[row.assetCode]);
        });
        await restoreChannel('全部');
        await channelSleep(700);
        const overallRow = rows.find(row => row.channel === '全部' && row.assetCode === 'all');
        const seedingGmvShare = overallRow && Number.isFinite(overallRow.seedingGmvShare)
          ? overallRow.seedingGmvShare
          : visibleSeedingGmvShare();
        if (overallRow && Number.isFinite(seedingGmvShare)) {
          overallRow.seedingGmvShare = seedingGmvShare;
        }
        await restoreChannel(originalChannel);
        if (originalPeriod && originalPeriod !== '30日') await selectPeriod(originalPeriod);
        window.postMessage({
          type: 'GH_CHANNEL_DIAGNOSIS_DATA',
          rows,
          seedingGmvShare,
          filterContext: Object.assign({}, (opts && opts.visibleFilters) || {}, {
            '统计周期': diagnosisDateRange || '最近30天',
          }),
        }, '*');
      } catch (error) {
        await restoreChannel(originalChannel);
        if (originalPeriod && originalPeriod !== selectedPeriod()) {
          try { await selectPeriod(originalPeriod); } catch (restoreError) {}
        }
        window.postMessage({
          type: 'GH_CHANNEL_DIAGNOSIS_ERROR',
          message: error && error.message ? error.message : String(error),
        }, '*');
      }
    };

    // 主入口：一次捕获条件，同时抓作品 + 商品两套数据
    window.__ghFetchBoth = async function (opts) {
      const pageCount = (opts && opts.pageCount) || 3;
      const requestId = String(opts && opts.requestId || '');
      window.postMessage({ type: 'GH_FETCH_PROGRESS', requestId, step: 'start', loaded: 0 }, '*');
      try {
        const raw = await captureRawConditions((opts && opts.triggerMode) || '');
        capturedCtx = buildBothConditions(raw);
        // 作品侧确认有效日期（顺便回填到 contentConditions）
        capturedCtx.contentConditions = await findValidContentConditions(
          capturedCtx.contentConditions,
          capturedCtx.timeRangeType,
          capturedCtx.contentScene,
          capturedCtx.contentRequestTemplate,
          capturedCtx.contentPageSize
        );

        const [content, product] = await Promise.all([
          fetchContentBatch(1, pageCount, pageCount * 100).catch(e => ({ rows: [], hasMore: false, nextPage: 1 + pageCount, error: e })),
          fetchProductBatch(1, pageCount, pageCount * 100).catch(e => ({ rows: [], hasMore: false, nextPage: 1 + pageCount, error: e })),
        ]);

        const total = content.rows.length + product.rows.length;
        window.postMessage({
          type: 'GH_BOTH_API_DATA',
          requestId,
          content: { rows: content.rows, hasMore: content.hasMore, nextPage: content.nextPage || (1 + pageCount) },
          product: { rows: product.rows, hasMore: product.hasMore, nextPage: product.nextPage || (1 + pageCount) },
          timeRangeType: capturedCtx.timeRangeType,
          dataContext: {
            source: '光合实时接口',
            fetchedAt: Date.now(),
            triggerMode: (opts && opts.triggerMode) || '',
            visibleFilters: (opts && opts.visibleFilters) || {},
            timeRangeType: capturedCtx.timeRangeType,
            timeRangeBegin: capturedCtx.timeRangeBegin,
            timeRangeEnd: capturedCtx.timeRangeEnd,
            capturedScene: capturedCtx.capturedScene,
            contentScene: capturedCtx.contentScene,
            contentRequestTemplateScene: capturedCtx.contentRequestTemplate && capturedCtx.contentRequestTemplate.scene,
            contentRequestTemplateOrderBy: capturedCtx.contentRequestTemplate && capturedCtx.contentRequestTemplate.orderBy,
            contentPageSize: capturedCtx.contentPageSize,
            contentEffectivePageSize: capturedCtx.contentEffectivePageSize,
            rawConditions: capturedCtx.rawConditions,
            contentConditions: parseConditions(capturedCtx.contentConditions),
            productConditions: JSON.parse(capturedCtx.productConditions || '{}'),
          },
        }, '*');
        window.postMessage({ type: 'GH_FETCH_PROGRESS', requestId, step: 'done', loaded: total }, '*');
      } catch (e) {
        console.error(TAG, '数据抓取失败:', e);
        window.postMessage({ type: 'GH_FETCH_PROGRESS', requestId, step: 'error', message: e.message || String(e) }, '*');
      }
    };

    const fullContentSyncRequests = new Set();
    window.__ghFetchAllContent = async function (opts) {
      const requestId = String(opts && opts.requestId || '');
      const targetVideoGroups = normalizeContentTargetGroups(
        opts && (opts.targetVideoGroups || opts.targetVideoIds)
      );
      if (!requestId || fullContentSyncRequests.has(requestId)) return;
      fullContentSyncRequests.add(requestId);
      window.postMessage({
        type: 'GH_FULL_CONTENT_SYNC_PROGRESS',
        requestId,
        loaded: 0,
        batch: 0,
      }, '*');
      try {
        const raw = await captureContentConditionsWithRetry();
        capturedCtx = forceAutomaticThirtyDayRange(buildBothConditions(raw));
        capturedCtx.contentRequestTemplate = requestTemplateWithRequiredIndicators(
          capturedCtx.contentRequestTemplate
        );
        capturedCtx.contentConditions = await findValidContentConditions(
          capturedCtx.contentConditions,
          capturedCtx.timeRangeType,
          capturedCtx.contentScene,
          capturedCtx.contentRequestTemplate,
          capturedCtx.contentPageSize
        );
        const syncResult = await fetchTargetedContentRows(requestId, targetVideoGroups);
        const visibleFilters = Object.assign({}, (opts && opts.visibleFilters) || {}, {
          '统计周期': '最近30天（光合30日口径）',
          '内容来源': syncResult.fallbackUsed
            ? '优先自制/达人，作品接口不兼容时回退全部作品并跳过可识别的其他用户内容'
            : '自制内容、达人合作内容（已排除其他用户内容）',
        });
        window.postMessage({
          type: 'GH_FULL_CONTENT_SYNC_DATA',
          requestId,
          rows: syncResult.rows,
          dataContext: {
            source: '光合自动定向同步',
            requestId,
            fetchedAt: Date.now(),
            triggerMode: 'content',
            visibleFilters,
            targetCount: syncResult.targetCount,
            matchedCount: syncResult.matchedCount,
            scannedCount: syncResult.scannedCount,
            pagesFetched: syncResult.pagesFetched,
            complete: syncResult.complete,
            timedOut: syncResult.timedOut,
            capped: syncResult.capped,
            failed: syncResult.failed,
            fallbackUsed: syncResult.fallbackUsed,
            directLookupUsed: syncResult.directLookupUsed,
            directLookupMatched: syncResult.directLookupMatched,
            mappingPairs: syncResult.mappingPairs,
            mappingDebugSamples: syncResult.debugSamples,
            excludedAssetCodes: ['ugc'],
            includedAssetCodes: syncResult.fallbackUsed
              ? ['self', 'business', 'all-fallback']
              : ['self', 'business'],
            timeRangeType: capturedCtx.timeRangeType,
            timeRangeBegin: capturedCtx.timeRangeBegin,
            timeRangeEnd: capturedCtx.timeRangeEnd,
            capturedScene: capturedCtx.capturedScene,
            contentScene: capturedCtx.contentScene,
            contentPageSize: capturedCtx.contentPageSize,
            contentEffectivePageSize: capturedCtx.contentEffectivePageSize,
            rawConditions: capturedCtx.rawConditions,
            contentConditions: parseConditions(capturedCtx.contentConditions),
          },
        }, '*');
      } catch (error) {
        window.postMessage({
          type: 'GH_FULL_CONTENT_SYNC_ERROR',
          requestId,
          message: error && error.message ? error.message : String(error),
        }, '*');
      } finally {
        fullContentSyncRequests.delete(requestId);
      }
    };

    // 加载更多：复用已缓存的条件，只抓指定视角的后续页
    window.__ghFetchMore = async function (opts) {
      const view = opts && opts.view;         // 'content' | 'product'
      const pageFrom = (opts && opts.pageFrom) || 1;
      const pageCount = (opts && opts.pageCount) || 3;
      const requestId = String(opts && opts.requestId || '');
      if (!capturedCtx) {
        window.postMessage({ type: 'GH_FETCH_PROGRESS', requestId, step: 'error', message: '尚未加载数据，请先点数据分析' }, '*');
        return;
      }
      window.postMessage({ type: 'GH_FETCH_PROGRESS', requestId, step: 'start', loaded: 0 }, '*');
      try {
        if (view === 'product') {
          const r = await fetchProductBatch(pageFrom, pageCount, pageCount * 100);
          window.postMessage({
            type: 'GH_PRODUCT_API_DATA',
            requestId,
            rows: r.rows, append: true, hasMore: r.hasMore, nextPage: r.nextPage || (pageFrom + pageCount),
          }, '*');
          window.postMessage({ type: 'GH_FETCH_PROGRESS', requestId, step: 'done', loaded: r.rows.length }, '*');
        } else {
          const r = await fetchContentBatch(pageFrom, pageCount, pageCount * 100);
          window.postMessage({
            type: 'GH_API_DATA',
            requestId,
            rows: r.rows, append: true, hasMore: r.hasMore, nextPage: r.nextPage || (pageFrom + pageCount),
          }, '*');
          window.postMessage({ type: 'GH_FETCH_PROGRESS', requestId, step: 'done', loaded: r.rows.length }, '*');
        }
      } catch (e) {
        console.error(TAG, '加载更多失败:', e);
        window.postMessage({ type: 'GH_FETCH_PROGRESS', requestId, step: 'error', message: e.message || String(e) }, '*');
      }
    };

    console.log(TAG, 'window.__ghFetchBoth / __ghFetchMore 已就绪');

    // 监听来自 content-script（ISOLATED world）的触发请求
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data && event.data.type === 'GH_FETCH_BOTH_REQUEST') {
        window.__ghFetchBoth({
          requestId: event.data.requestId,
          pageCount: event.data.pageCount || 3,
          triggerMode: event.data.triggerMode || '',
          visibleFilters: event.data.visibleFilters || {},
        });
      }
      if (event.data && event.data.type === 'GH_FETCH_MORE_REQUEST') {
        window.__ghFetchMore({
          requestId: event.data.requestId,
          view: event.data.view,
          pageFrom: event.data.pageFrom || 1,
          pageCount: event.data.pageCount || 3,
        });
      }
      if (event.data && event.data.type === 'GH_FETCH_ALL_CONTENT_REQUEST') {
        window.__ghFetchAllContent({
          requestId: event.data.requestId,
          targetVideoGroups: event.data.targetVideoGroups || event.data.targetVideoIds || [],
          visibleFilters: event.data.visibleFilters || {},
        });
      }
      if (event.data && event.data.type === 'GH_CHANNEL_DIAGNOSIS_REQUEST') {
        window.__ghFetchChannelDiagnosis({
          metricsOnly: event.data.metricsOnly === true,
          visibleFilters: event.data.visibleFilters || {},
        });
      }
    });
  });

  // ===== 降级路径：保留 Excel 拦截 =====

  const blobMap = new Map();

  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (blob) {
    const url = originalCreateObjectURL(blob);
    if (blob instanceof Blob) {
      blob.arrayBuffer().then(buf => { blobMap.set(url, buf); }).catch(() => {});
    }
    return url;
  };

  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[download]') || e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    const download = a.getAttribute('download') || '';
    if (!href.startsWith('blob:') && !download.match(/\.xlsx?$/i)) return;
    const buf = blobMap.get(href);
    if (buf) {
      console.log(TAG, '✅ 拦截到 <a download> Excel:', download || href);
      window.postMessage({ type: 'GH_XLSX_CAPTURED', buffer: buf.slice(0) }, '*', [buf.slice(0)]);
    }
  }, true);

  const originalWindowOpen = window.open;
  window.open = function (url, ...rest) {
    if (url && url.startsWith('blob:')) {
      const buf = blobMap.get(url);
      if (buf) {
        console.log(TAG, '✅ 拦截到 window.open Excel blob');
        window.postMessage({ type: 'GH_XLSX_CAPTURED', buffer: buf.slice(0) }, '*', [buf.slice(0)]);
      }
    }
    return originalWindowOpen.call(this, url, ...rest);
  };

  function isExcelResponse(contentType, disposition) {
    if (contentType.includes('spreadsheet') || contentType.includes('excel') || contentType.includes('octet-stream')) return true;
    if (disposition.includes('.xlsx') || disposition.includes('.xls')) return true;
    return false;
  }

  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await _origFetch.apply(this, args);
    try {
      const ct = response.headers.get('content-type') || '';
      const cd = response.headers.get('content-disposition') || '';
      if (isExcelResponse(ct, cd)) {
        const clone = response.clone();
        clone.arrayBuffer().then(buf => {
          console.log(TAG, '✅ fetch 拦截到 Excel，大小:', buf.byteLength);
          window.postMessage({ type: 'GH_XLSX_CAPTURED', buffer: buf }, '*', [buf]);
        });
      }
    } catch (e) {}
    return response;
  };

  const _XHROpen = XMLHttpRequest.prototype.open;
  const _XHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ghUrl = url;
    this._ghMethod = method;
    return _XHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    const xhr = this;
    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState !== 4) return;
      try {
        const ct = xhr.getResponseHeader('content-type') || '';
        const cd = xhr.getResponseHeader('content-disposition') || '';
        if (isExcelResponse(ct, cd)) {
          if (xhr.response instanceof ArrayBuffer) {
            window.postMessage({ type: 'GH_XLSX_CAPTURED', buffer: xhr.response.slice(0) }, '*', [xhr.response.slice(0)]);
          } else if (xhr.response instanceof Blob) {
            xhr.response.arrayBuffer().then(buf => {
              window.postMessage({ type: 'GH_XLSX_CAPTURED', buffer: buf }, '*', [buf]);
            });
          }
        }
      } catch (e) {}
    });
    return _XHRSend.apply(this, args);
  };

  console.log(TAG, 'page-hook 已注入');
})();

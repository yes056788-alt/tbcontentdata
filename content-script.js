// content-script.js - ISOLATED world，接收 Excel 数据，解析计算，渲染面板
(function () {
  const IS_GUANGHE_HOST = location.hostname === 'creator.guanghe.taobao.com';
  const IS_SYCM_CONTENT_MIRROR = location.hostname === 'sycm.taobao.com' &&
    location.pathname.includes('/xsite/contentanalysis/overview_new_v2');
  const IS_GUANGHE_SETTINGS_APP = location.hostname === 'xstore.insights.1688.com';
  const IS_GUANGHE_DATA_PAGE = location.hostname === 'web.taobao.com' &&
    location.pathname.includes('/s-guanghe-creator/asset-overview');
  if (!IS_GUANGHE_HOST && !IS_SYCM_CONTENT_MIRROR && !IS_GUANGHE_SETTINGS_APP && !IS_GUANGHE_DATA_PAGE) return;
  if (window.__ghContentScriptV2250) return;
  window.__ghContentScriptV2250 = true;

  const TAG = '[光合分析]';
  // 版本号取自 manifest，显示在面板上，方便确认加载的是不是最新代码
  const EXT_VERSION = (function () {
    try { return chrome.runtime.getManifest().version; } catch (e) { return ''; }
  })();
  let panelRoot = null;
  let previousBodyOverflow = '';

  // 双视角状态：content=作品视角，product=商品视角，各自独立筛选/排序/分页
  function makeViewState() {
    return {
      results: null,
      filter: '',        // 商品ID筛选（各视角独立）
      nameFilter: '',    // 内容名称搜索（各视角独立）
      idFilter: '',      // 内容ID搜索（仅作品视角）
      goalFilters: [],   // 达标多选筛选（各视角独立）: ['曝光点击率_met', ...]
      nextPage: 1,       // 下次加载更多的起始页
      hasMore: false,    // 是否还有更多数据
    };
  }
  const views = { content: makeViewState(), product: makeViewState() };
  let activeView = 'content';   // 面板当前显示的视角
  // 排序两视角共享（切换视角保持同一排序）
  let sortField = 'raw_查看次数';
  let sortOrder = 'desc';

  // 展开钻取：记录每个视角下已展开的行 id
  const expanded = { content: new Set(), product: new Set() };
  // 关联索引：itemId → 作品记录数组；itemId → 商品记录
  let itemToContents = {};
  let itemToProduct = {};

  let currentMode = null;   // 当前所在 tab（决定按钮标签/位置/默认视角）
  let lastUrl = location.href;
  let lastParsedAt = null;
  let fetchInProgress = false;  // 全局抓取锁
  let fetchWatchdog = null;
  let activeFetchRequestId = '';
  let fetchRequestSequence = 0;
  const FETCH_WATCHDOG_MS = 90000;
  let panelOpen = false;        // 面板是否已打开
  let snapshotMeta = null;       // { fingerprint, ts } 上次抓取时的快照信息（快照缓存判断用）
  let pendingFingerprint = null; // 本次抓取用的指纹，抓完写入 snapshotMeta
  let dataContext = null;        // 本次数据来源与用户可读筛选口径
  let showingCachedData = false; // 当前面板是否直接展示缓存快照
  let contextExpanded = false;   // 用户展开数据口径后，筛选/排序重渲染时保持状态
  let channelDiagnosisRunning = false;
  let channelDiagnosisTimeout = null;
  let channelDiagnosisSnapshotKey = '';
  let channelDiagnosisSilent = false;
  let channelDiagnosisMetricsOnly = false;
  let channelReportRows = [];
  let channelReportFilterContext = {};
  let channelReportView = 'channel';
  let channelReportFromSnapshot = false;
  let channelMemorySnapshot = null;
  const channelExpandedGroups = {
    channel: new Set(),
    asset: new Set(),
  };

  // 便捷访问当前视角状态
  function V() { return views[activeView]; }

  function releaseFetchLock(requestId, shouldRender) {
    if (requestId && activeFetchRequestId && requestId !== activeFetchRequestId) return false;
    if (fetchWatchdog) clearTimeout(fetchWatchdog);
    fetchWatchdog = null;
    fetchInProgress = false;
    if (shouldRender && panelOpen) renderPanel();
    return true;
  }

  function beginFetchLock() {
    if (fetchInProgress) return '';
    fetchInProgress = true;
    activeFetchRequestId = 'gh-fetch-' + Date.now() + '-' + (++fetchRequestSequence);
    const requestId = activeFetchRequestId;
    fetchWatchdog = setTimeout(() => {
      if (activeFetchRequestId !== requestId) return;
      releaseFetchLock(requestId, false);
      if (!panelOpen) return;
      if (views.content.results || views.product.results) {
        renderPanel();
        showToast('加载超时，按钮已恢复，请稍后重试。', 5000);
      } else {
        showNotice('获取数据超时，请稍后重新点击分析。');
      }
    }, FETCH_WATCHDOG_MS);
    return requestId;
  }

  function isCurrentFetchMessage(data) {
    const requestId = data && data.requestId;
    return !requestId || !activeFetchRequestId || requestId === activeFetchRequestId;
  }

  function getPageMode() {
    if (IS_SYCM_CONTENT_MIRROR) return 'overview';
    const pathname = location.pathname;
    const isAssetOverview = pathname.includes('/page/unify/asset-overview') || pathname.includes('/guanghe-creator/asset-overview');
    if (!isAssetOverview) return null;
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab === 'singleEffect') return 'content';
    if (tab === 'productAnalysis') return 'product';
    return 'overview';
  }

  function onUrlChange() {
    const newMode = getPageMode();
    if (newMode === currentMode) return;

    releaseFetchLock('', false);
    activeFetchRequestId = 'gh-cancelled-' + Date.now() + '-' + (++fetchRequestSequence);
    currentMode = newMode;

    // 移除旧按钮
    const oldBtn = document.getElementById('gh-trigger-btn');
    if (oldBtn) oldBtn.remove();
    const oldChannelBtn = document.getElementById('gh-channel-trigger-btn');
    if (oldChannelBtn) oldChannelBtn.remove();
    const oldChannelPanel = document.getElementById('gh-channel-panel');
    if (oldChannelPanel) oldChannelPanel.remove();

    // 重建按钮（如果在允许的页面）
    if (currentMode && !IS_SYCM_CONTENT_MIRROR) {
      createTriggerButton();
    }
  }

  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onUrlChange();
    }
  }

  // 页面加载时初始化
  currentMode = getPageMode();
  if (currentMode) {
    if (!IS_SYCM_CONTENT_MIRROR) createTriggerButton();
    if (currentMode !== 'overview') restoreFromStorage();
  }

  // 监听 URL 变化（SPA 页面）
  window.addEventListener('popstate', checkUrlChange);
  window.addEventListener('hashchange', checkUrlChange);
  setInterval(checkUrlChange, 500);

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const type = event.data && event.data.type;

    // 双视角一次性数据：同时含作品 + 商品
    if (type === 'GH_BOTH_API_DATA') {
      if (!isCurrentFetchMessage(event.data)) return;
      releaseFetchLock(event.data.requestId, false);
      const c = event.data.content || { rows: [], hasMore: false, nextPage: 1 };
      const p = event.data.product || { rows: [], hasMore: false, nextPage: 1 };
      views.content.results = parseContentRows(c.rows);
      views.content.hasMore = !!c.hasMore;
      views.content.nextPage = c.nextPage || 1;
      views.product.results = parseProductRows(p.rows);
      views.product.hasMore = !!p.hasMore;
      views.product.nextPage = p.nextPage || 1;
      // 首次加载重置筛选 + 共享排序
      resetViewFilters('content');
      resetViewFilters('product');
      sortField = 'raw_查看次数';
      sortOrder = 'desc';
      expanded.content.clear();
      expanded.product.clear();
      buildRelationIndexes();
      dataContext = event.data.dataContext || {
        source: '光合实时接口', fetchedAt: Date.now(), triggerMode: currentMode,
        visibleFilters: collectVisibleFilters(),
      };
      showingCachedData = false;
      // 记录本次抓取的快照指纹（供下次判断筛选器是否变化）
      snapshotMeta = { fingerprint: pendingFingerprint || computeFilterFingerprint(), ts: Date.now() };
      saveToStorage();
      lastParsedAt = Date.now();
      renderPanel();
      hideProgress();
      return;
    }

    // 作品视角加载更多
    if (type === 'GH_API_DATA') {
      if (!isCurrentFetchMessage(event.data)) return;
      releaseFetchLock(event.data.requestId, false);
      const vs = views.content;
      vs.hasMore = !!(event.data.hasMore);
      if (event.data.nextPage) vs.nextPage = event.data.nextPage;
      appendContentRows(event.data.rows);
      return;
    }

    // 商品视角加载更多
    if (type === 'GH_PRODUCT_API_DATA') {
      if (!isCurrentFetchMessage(event.data)) return;
      releaseFetchLock(event.data.requestId, false);
      const vs = views.product;
      vs.hasMore = !!(event.data.hasMore);
      if (event.data.nextPage) vs.nextPage = event.data.nextPage;
      appendProductRows(event.data.rows);
      return;
    }

    if (type === 'GH_FETCH_PROGRESS') {
      const d = event.data;
      if (!isCurrentFetchMessage(d)) return;
      const loadingText = panelRoot && panelRoot.shadowRoot.querySelector('.panel-loading-text');
      if (d.step === 'start' || d.step === 'paging') {
        // 首次/重抓：更新表格区内的加载文字（不再弹右下角小窗）
        if (loadingText) {
          loadingText.textContent = d.step === 'paging'
            ? ('正在获取数据…已加载 ' + d.loaded + ' 条')
            : '正在连接接口…';
        }
      } else if (d.step === 'done') {
        releaseFetchLock(d.requestId, false);
        if (loadingText) loadingText.textContent = '加载完成，正在计算…';
      } else if (d.step === 'error') {
        releaseFetchLock(d.requestId, false);
        // 首次/重抓失败：表格区显示错误；加载更多失败：保留已有数据仅恢复渲染
        if (loadingText) {
          showNotice('获取失败：' + (d.message || '未知错误') + '\n\n请稍后重试，或手动点击页面导出按钮降级');
        } else {
          renderPanel();
        }
      }
      return;
    }

    if (type === 'GH_CHANNEL_DIAGNOSIS_PROGRESS') {
      const button = document.getElementById('gh-channel-trigger-btn');
      if (button) {
        button.disabled = true;
        button.textContent = event.data.channel
          ? ('正在取数 ' + event.data.index + '/' + event.data.total)
          : '正在连接接口…';
      }
      return;
    }

    if (type === 'GH_CHANNEL_DIAGNOSIS_DATA') {
      if (channelDiagnosisTimeout) clearTimeout(channelDiagnosisTimeout);
      channelDiagnosisTimeout = null;
      channelDiagnosisRunning = false;
      const button = document.getElementById('gh-channel-trigger-btn');
      if (button) {
        button.disabled = false;
        button.textContent = '渠道诊断';
      }
      const rows = event.data.rows || [];
      const filterContext = event.data.filterContext || {};
      const overallRow = rows.find(row => row.channel === '全部' && row.assetCode === 'all');
      const seedingGmvShare = channelNormalizeShare(
        event.data.seedingGmvShare ?? (overallRow && overallRow.seedingGmvShare)
      );
      const metricsOnly = event.data.metricsOnly === true || channelDiagnosisMetricsOnly;
      const snapshot = {
        schema: metricsOnly ? 10 : 9,
        mode: metricsOnly ? 'businessDefense' : 'full',
        key: channelDiagnosisSnapshotKey || channelBuildSnapshotKey(filterContext, metricsOnly),
        rows,
        seedingGmvShare,
        filterContext,
        ts: Date.now(),
      };
      channelMemorySnapshot = snapshot;
      try {
        chrome.storage.local.set({ gh_channel_snapshot: snapshot }, () => {
          // 扩展刚重新加载时旧页面上下文可能失效；快照保存失败不能阻断结果展示。
          try { void chrome.runtime.lastError; } catch (error) {}
        });
      } catch (error) {
        console.warn(TAG, '渠道快照保存失败，继续展示本次结果:', error);
      }
      const shouldRender = !channelDiagnosisSilent;
      channelDiagnosisSilent = false;
      channelDiagnosisMetricsOnly = false;
      channelDiagnosisSnapshotKey = '';
      if (shouldRender) channelRenderReport(rows, filterContext, { fromSnapshot: false });
      return;
    }

    if (type === 'GH_CHANNEL_DIAGNOSIS_ERROR') {
      if (channelDiagnosisTimeout) clearTimeout(channelDiagnosisTimeout);
      channelDiagnosisTimeout = null;
      channelDiagnosisRunning = false;
      const button = document.getElementById('gh-channel-trigger-btn');
      if (button) {
        button.disabled = false;
        button.textContent = '渠道诊断';
      }
      const shouldRender = !channelDiagnosisSilent;
      channelDiagnosisSilent = false;
      channelDiagnosisMetricsOnly = false;
      channelDiagnosisSnapshotKey = '';
      if (shouldRender) {
        channelShowPanel('光合渠道诊断',
          '<p class="ghc-warning">' + escapeHtml(event.data.message || '渠道接口数据读取失败。') + '</p>');
      }
      return;
    }

    if (type === 'GH_XLSX_CAPTURED') {
      parseAndRender(event.data.buffer);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'GH_RUN_CHANNEL_DIAGNOSIS') {
      const visibleFilters = collectVisibleFilters();
      const metricsOnly = message.metricsOnly === true;
      const snapshotKey = channelBuildSnapshotKey(visibleFilters, metricsOnly);
      runChannelDiagnosis({
        force: true,
        silent: message.silent === true,
        metricsOnly,
      });
      waitForChannelSnapshot(snapshotKey, Number(message.timeoutMs) || 120000, metricsOnly)
        .then(sendResponse)
        .catch((error) => sendResponse({
          ok: false,
          message: error && error.message ? error.message : '光合渠道诊断取数失败。',
        }));
      return true;
    }
    if (!message || message.type !== 'GH_XLSX_FROM_BACKGROUND') return;
    try {
      const binary = atob(message.base64);
      const buffer = new ArrayBuffer(binary.length);
      const view = new Uint8Array(buffer);
      for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
      parseAndRender(buffer);
    } catch (e) {
      console.error(TAG, '解码失败:', e);
    }
  });

  function persistAutomaticContentSync(apiRows, nextDataContext) {
    const parsedRows = parseContentRows(apiRows || []);
    const automaticDataContext = nextDataContext || {
      source: '光合自动定向同步',
      fetchedAt: Date.now(),
      triggerMode: 'content',
      visibleFilters: collectVisibleFilters(),
    };
    const automaticSnapshotMeta = {
      fingerprint: computeFilterFingerprint(),
      ts: Date.now(),
      automatic: true,
      complete: automaticDataContext.complete !== false,
    };
    const productIds = new Set();
    parsedRows.forEach((row) => {
      (row.items || []).forEach((item) => {
        if (item.itemId) productIds.add(String(item.itemId));
      });
    });
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({
        gh_wxt_results: parsedRows,
        gh_wxt_snapshot_meta: automaticSnapshotMeta,
        gh_wxt_data_context: automaticDataContext,
      }, () => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || '光合作品数据写入失败。'));
          return;
        }
        resolve({
          ok: true,
          requestId: automaticDataContext.requestId || '',
          contentCount: parsedRows.length,
          productCount: productIds.size,
          targetCount: Number(automaticDataContext.targetCount) || 0,
          matchedCount: Number(automaticDataContext.matchedCount) || parsedRows.length,
          scannedCount: Number(automaticDataContext.scannedCount) || 0,
          pagesFetched: Number(automaticDataContext.pagesFetched) || 0,
          complete: automaticDataContext.complete !== false,
          timedOut: automaticDataContext.timedOut === true,
          capped: automaticDataContext.capped === true,
          failed: automaticDataContext.failed === true,
          fallbackUsed: automaticDataContext.fallbackUsed === true,
          directLookupUsed: automaticDataContext.directLookupUsed === true,
          directLookupMatched: Number(automaticDataContext.directLookupMatched) || 0,
          mappingPairs: Array.isArray(automaticDataContext.mappingPairs)
            ? automaticDataContext.mappingPairs
            : [],
          fetchedAt: automaticDataContext.fetchedAt || Date.now(),
        });
      });
    });
  }

  function runAutomaticFullContentSync(requestId, targetVideoGroups) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('光合作品定向同步超时，请检查光合页面登录状态。'));
      }, 3 * 60 * 1000);
      let requestTimer = null;
      let started = false;

      const cleanup = () => {
        window.clearTimeout(timeout);
        if (requestTimer) window.clearInterval(requestTimer);
        window.removeEventListener('message', onPageMessage);
      };

      const onPageMessage = (event) => {
        if (event.source !== window || !event.data || event.data.requestId !== requestId) return;
        if (event.data.type === 'GH_FULL_CONTENT_SYNC_PROGRESS') {
          started = true;
          if (requestTimer) {
            window.clearInterval(requestTimer);
            requestTimer = null;
          }
          return;
        }
        if (event.data.type === 'GH_FULL_CONTENT_SYNC_ERROR') {
          cleanup();
          reject(new Error(event.data.message || '光合作品全量同步失败。'));
          return;
        }
        if (event.data.type !== 'GH_FULL_CONTENT_SYNC_DATA') return;
        cleanup();
        persistAutomaticContentSync(event.data.rows, event.data.dataContext).then(resolve, reject);
      };

      const requestPageSync = () => {
        if (started) return;
        window.postMessage({
          type: 'GH_FETCH_ALL_CONTENT_REQUEST',
          requestId,
          targetVideoGroups,
          visibleFilters: collectVisibleFilters(),
        }, '*');
      };

      window.addEventListener('message', onPageMessage);
      requestPageSync();
      requestTimer = window.setInterval(requestPageSync, 1000);
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'GH_SYNC_ALL_CONTENT') return;
    const requestId = String(message.requestId || '');
    if (!/^gh-sync-[a-z0-9-]{8,80}$/i.test(requestId)) {
      sendResponse({ ok: false, message: '光合自动同步请求无效。' });
      return;
    }
    const targetVideoGroups = Array.isArray(message.targetVideoGroups)
      ? message.targetVideoGroups.slice(0, 5000)
      : [];
    runAutomaticFullContentSync(requestId, targetVideoGroups).then(sendResponse).catch((error) => {
      sendResponse({
        ok: false,
        message: error && error.message ? error.message : '光合作品定向同步失败。',
      });
    });
    return true;
  });

  function restoreFromStorage() {
    chrome.storage.local.get(['gh_last_results', 'gh_product_results', 'gh_snapshot_meta', 'gh_data_context', 'gh_pagination_state'], (data) => {
      if (data.gh_last_results && data.gh_last_results.length > 0) {
        views.content.results = data.gh_last_results;
      }
      if (data.gh_product_results && data.gh_product_results.length > 0) {
        views.product.results = data.gh_product_results;
      }
      if (data.gh_snapshot_meta) {
        snapshotMeta = data.gh_snapshot_meta;
      }
      if (data.gh_data_context) {
        dataContext = data.gh_data_context;
      }
      const pagination = data.gh_pagination_state || {};
      ['content', 'product'].forEach(view => {
        const saved = pagination[view];
        if (!saved) return;
        views[view].hasMore = !!saved.hasMore;
        const nextPage = Number(saved.nextPage);
        if (Number.isFinite(nextPage) && nextPage > 0) views[view].nextPage = nextPage;
      });
      if (views.content.results || views.product.results) {
        buildRelationIndexes();
        console.log(TAG, '已恢复缓存数据');
      }
    });
  }

  function saveToStorage() {
    chrome.storage.local.set({
      gh_last_results: views.content.results || [],
      gh_product_results: views.product.results || [],
      gh_snapshot_meta: snapshotMeta || null,
      gh_data_context: dataContext || null,
      gh_pagination_state: {
        content: { hasMore: views.content.hasMore, nextPage: views.content.nextPage },
        product: { hasMore: views.product.hasMore, nextPage: views.product.nextPage },
      },
    });
  }

  function resetViewFilters(view) {
    const vs = views[view];
    vs.filter = '';
    vs.nameFilter = '';
    vs.idFilter = '';
    vs.goalFilters = [];
  }

  // ===== 纯解析：把 API 原始行转成内部记录（不触发渲染） =====

  // 作品行：保留 items（商品明细：itemId/名称/价格/图片/链接），供钻取展示
  function parseContentRows(apiRows) {
    if (!apiRows) return [];
    return apiRows.map(row => {
      const unwrap = (v) => {
        if (v == null) return '';
        if (typeof v === 'object' && v !== null) {
          const keys = ['absolute', 'value', 'currentValue', 'indicatorValue', 'metricValue', 'absoluteFormat'];
          for (const key of keys) {
            if (v[key] != null) return v[key];
          }
          return '';
        }
        return v;
      };
      const getVal = (field) => unwrap(row[field]);
      const contentInfo = row.contentInfo || {};
      const content = contentInfo.content || row.content || row.contentBaseInfo || {};
      const items = contentInfo.items || contentInfo.itemList || row.items || row.itemList || [];
      const name = unwrap(content.title || content.name || row.contentTitle || row.title || row.name);
      const id = getVal('contentId') || getVal('content_id') ||
        unwrap(content.id || content.contentId || content.content_id || row.id);
      const releaseTs = unwrap(content.releaseTime || row.releaseTime || row.publishTime || row.gmtCreate);
      const releaseTime = Number(releaseTs);
      const time = releaseTime ? new Date(releaseTime).toISOString().slice(0, 10) : '';
      const itemList = items.map(it => ({
        itemId: String(unwrap(it.itemId || it.id) || ''),
        name: unwrap(it.itemName || it.title || it.name),
        price: unwrap(it.price),
        pic: unwrap(it.itemPic || it.pic || it.image),
        url: unwrap(it.targetUrl || it.url),
      })).filter(it => it.itemId);
      return {
        name: name,
        id: String(id),
        time: time,
        productId: itemList.map(it => it.itemId).join(','),
        items: itemList,
        metrics: calcMetricsFromAPI(row),
        match: row.__ghMatch && typeof row.__ghMatch === 'object'
          ? JSON.parse(JSON.stringify(row.__ghMatch))
          : null,
      };
    }).filter(r => (
      r.id || r.name || r.productId ||
      Object.values(r.metrics).some(v => v !== null && v !== 0)
    ));
  }

  // 商品行：合并消费 + 供给
  function parseProductRows(apiRows) {
    if (!apiRows) return [];
    return apiRows.map(row => {
      const itemInfo = row.itemInfo || {};
      const id = (row.itemId && row.itemId.absolute) ? String(row.itemId.absolute) : String(itemInfo.itemId || '');
      const name = itemInfo.title || '';
      return {
        name: name,
        id: id,
        time: '',
        productId: id,
        metrics: calcMetricsFromProductAPI(row, row.__supplyRow || null),
      };
    }).filter(r => Object.values(r.metrics).some(v => v !== null && v !== 0));
  }

  // 作品视角加载更多：追加去重
  function appendContentRows(apiRows) {
    const vs = views.content;
    const newRows = parseContentRows(apiRows);
    if (vs.results) {
      const existing = new Set(vs.results.map(r => r.id));
      vs.results = vs.results.concat(newRows.filter(r => !existing.has(r.id)));
    } else {
      vs.results = newRows;
    }
    buildRelationIndexes();
    saveToStorage();
    lastParsedAt = Date.now();
    renderPanel();
    setTimeout(hideProgress, 600);
  }

  // 商品视角加载更多：追加去重
  function appendProductRows(apiRows) {
    const vs = views.product;
    const newRows = parseProductRows(apiRows);
    if (vs.results) {
      const existing = new Set(vs.results.map(r => r.id));
      vs.results = vs.results.concat(newRows.filter(r => !existing.has(r.id)));
    } else {
      vs.results = newRows;
    }
    buildRelationIndexes();
    saveToStorage();
    lastParsedAt = Date.now();
    renderPanel();
    setTimeout(hideProgress, 600);
  }

  // 建立钻取索引：itemId → 关联的作品列表 / itemId → 商品记录
  function buildRelationIndexes() {
    itemToContents = {};
    itemToProduct = {};
    const contents = views.content.results || [];
    for (const c of contents) {
      for (const it of (c.items || [])) {
        if (!itemToContents[it.itemId]) itemToContents[it.itemId] = [];
        itemToContents[it.itemId].push(c);
      }
    }
    const products = views.product.results || [];
    for (const p of products) {
      if (p.id) itemToProduct[p.id] = p;
    }
  }

  // Excel 降级路径：只填充当前所在 tab 对应视角
  function parseAndRender(buffer) {
    if (!buffer) return;
    try {
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const sheetName = workbook.SheetNames.find(n => n.includes('明细')) || workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rows.length === 0) { showNotice('Excel 中没有数据行'); return; }

      const firstRow = rows[0];
      const fieldMap = buildFieldMap(firstRow);
      const required = ['查看次数', '有效查看次数', '曝光次数', '点击次数'];
      const missing = required.filter(f => !(normalizeKey(f) in fieldMap));
      if (missing.length > 0) {
        showNotice('缺少字段：' + missing.join(', ') + '\n\n实际字段：' + Object.keys(firstRow).join(', '));
        return;
      }

      const isProduct = currentMode === 'product';
      const targetView = isProduct ? 'product' : 'content';

      const results = rows.map(row => {
        const fm = buildFieldMap(row);
        const getName = (...keys) => {
          for (const k of keys) { const v = fm[normalizeKey(k)]; if (v) return String(v); }
          return '';
        };
        let name, id, time, productId;
        if (isProduct) {
          id = getName('商品id', '商品ID') || '';
          name = '';
          time = '';
          productId = id;
        } else {
          name = getName('内容名称') || row['内容名称'] || '';
          id = getName('内容ID') || row['内容ID'] || '';
          time = getName('内容发布时间') || row['内容发布时间'] || '';
          productId = getName('商品ID', '商品id') || String(row['商品ID'] || row['商品id'] || '');
        }
        return {
          name: name, id: id, time: time, productId: productId,
          items: [],
          metrics: calcMetrics(row),
        };
      });

      views[targetView].results = results.filter(r => Object.values(r.metrics).some(v => v !== null && v !== 0));
      resetViewFilters(targetView);
      expanded[targetView].clear();
      activeView = targetView;
      dataContext = {
        source: 'Excel 导出文件',
        fetchedAt: Date.now(),
        triggerMode: currentMode,
        visibleFilters: collectVisibleFilters(),
      };
      showingCachedData = false;
      buildRelationIndexes();
      saveToStorage();
      lastParsedAt = Date.now();
      renderPanel();
      setTimeout(hideProgress, 1500);
    } catch (e) {
      showNotice('解析失败：' + e.message);
    }
  }

  // 判断一条记录的指标是否满足一组达标筛选（取交集：全部满足才算通过）
  function matchesGoalFilters(metrics, goalFilters) {
    for (const gf of goalFilters) {
      const wantMet = gf.endsWith('_met');
      const key = gf.replace(/_met$|_unmet$/, '');
      const def = METRIC_DEFS.find(d => d.key === key);
      if (!def) continue;
      const ok = isGoalMet(def, metrics[key]);
      if (wantMet && ok !== true) return false;
      if (!wantMet && ok !== false) return false;
    }
    return true;
  }

  function getFilteredResults(results) {
    const vs = V();
    const isProduct = activeView === 'product';
    let filtered = results || [];
    if (vs.filter) {
      filtered = filtered.filter(r => r.productId.includes(vs.filter));
    }
    if (vs.nameFilter && !isProduct) {
      filtered = filtered.filter(r => r.name && r.name.includes(vs.nameFilter));
    }
    if (vs.idFilter && !isProduct) {
      filtered = filtered.filter(r => r.id && r.id.includes(vs.idFilter));
    }
    // 多选达标筛选：取交集（同时满足所有勾选条件）
    if (vs.goalFilters.length > 0) {
      filtered = filtered.filter(r => matchesGoalFilters(r.metrics, vs.goalFilters));
    }
    // 排序（两视角共享 sortField/sortOrder）
    filtered = [...filtered].sort((a, b) => {
      if (sortField === 'time') {
        const va = a.time || '', vb = b.time || '';
        return sortOrder === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      } else if (sortField === 'relatedCount') {
        const va = (itemToContents[a.id] || []).length;
        const vb = (itemToContents[b.id] || []).length;
        return sortOrder === 'asc' ? va - vb : vb - va;
      } else if (sortField === 'id') {
        const va = a.id || '', vb = b.id || '';
        return sortOrder === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      } else {
        const va = a.metrics[sortField] || 0;
        const vb = b.metrics[sortField] || 0;
        return sortOrder === 'asc' ? va - vb : vb - va;
      }
    });
    return filtered;
  }

  function showNotice(msg) {
    ensurePanel();
    const container = panelRoot.shadowRoot.querySelector('.panel-container');
    container.innerHTML = buildHeaderHTML()
      + '<div class="panel-body"><div class="panel-notice"><p>' + msg.replace(/\n/g, '<br>') + '</p></div></div>';
    bindPanelEvents(container);
  }

  function renderPanel() {
    ensurePanel();
    const container = panelRoot.shadowRoot.querySelector('.panel-container');
    // 保存筛选框的光标位置，渲染后恢复
    const prevInput = container.querySelector('.panel-filter-input');
    const prevSelStart = prevInput ? prevInput.selectionStart : null;
    const prevSelEnd = prevInput ? prevInput.selectionEnd : null;
    const hadFocus = prevInput && panelRoot.shadowRoot.activeElement === prevInput;

    const results = V().results || [];
    const filtered = getFilteredResults(results);
    container.innerHTML = buildPanelHTML(filtered, results.length);
    bindPanelEvents(container);

    // 恢复焦点和光标
    if (hadFocus) {
      const newInput = container.querySelector('.panel-filter-input');
      if (newInput) {
        newInput.focus();
        try { newInput.setSelectionRange(prevSelStart, prevSelEnd); } catch(e) {}
      }
    }
  }

  function buildSortIcon(field) {
    if (sortField !== field) return '<span class="sort-icon">↕</span>';
    return '<span class="sort-icon active">' + (sortOrder === 'desc' ? '↓' : '↑') + '</span>';
  }

  // 面板头部（含视角切换 tab、筛选框、按钮）——两种状态（通知/表格）共用
  function buildHeaderHTML() {
    const vs = V();
    const isProduct = activeView === 'product';
    const count = getFilteredResults(vs.results || []).length;
    const loadedCount = (vs.results || []).length;
    const hasPanelFilter = !!(vs.filter || vs.nameFilter || vs.idFilter || vs.goalFilters.length);
    return '<div class="panel-header">'
      + '<div class="view-switch">'
      + '<button class="view-tab' + (!isProduct ? ' active' : '') + '" data-view="content">作品视角</button>'
      + '<button class="view-tab' + (isProduct ? ' active' : '') + '" data-view="product">商品视角</button>'
      + '</div>'
      + '<div class="panel-controls">'
      + '<input class="panel-filter-input" type="text" placeholder="输入商品ID" value="' + escapeHtml(vs.filter) + '" />'
      + (!isProduct ? '<input class="panel-name-filter-input" type="text" placeholder="搜索视频标题" value="' + escapeHtml(vs.nameFilter) + '" />' : '')
      + (!isProduct ? '<input class="panel-id-filter-input" type="text" placeholder="搜索内容ID" value="' + escapeHtml(vs.idFilter) + '" />' : '')
      + '<button class="panel-search-btn" type="button">搜索</button>'
      + '<button class="panel-clear-btn" type="button"' + (hasPanelFilter ? '' : ' disabled') + '>清空</button>'
      + '<span class="panel-count-tag">' + (hasPanelFilter ? ('显示 ' + count + ' 条 / 已加载 ' + loadedCount + ' 条') : (loadedCount + ' 条')) + '</span>'
      + '</div>'
      + (EXT_VERSION ? '<span class="panel-version" title="插件版本">v' + escapeHtml(EXT_VERSION) + '</span>' : '')
      + '<button class="panel-close">×</button>'
      + '</div>';
  }

  // 小折叠：只展示用户能理解的数据口径，不暴露接口内部字段名。
  function buildDataContextHTML() {
    if (!dataContext) return '';
    const filters = Object.assign({}, dataContext.visibleFilters || {});
    if (filters['内容发布时间'] && !filters['作品范围']) {
      const publishScope = String(filters['内容发布时间']);
      filters['作品范围'] = /近\s*30\s*天/.test(publishScope) ? '近30天作品'
        : (publishScope === '全部' ? '全部作品' : publishScope);
    }
    delete filters['内容发布时间'];
    if (filters['统计周期']) {
      filters['统计周期'] = String(filters['统计周期'])
        .replace(/^数据时间范围[：:\s]*/, '')
        .replace(/\s+-\s+/g, '—');
    }
    const sourceLabel = showingCachedData ? '缓存快照' : (dataContext.source || '光合实时接口');
    const buildFilterChips = (source, excluded) => Object.keys(source)
      .filter(k => source[k] && !(excluded || []).includes(k))
      .map(k => '<span class="context-chip"><b>' + escapeHtml(k) + '</b> ' + escapeHtml(String(source[k])) + '</span>')
      .join('') || '<span class="context-chip">未识别到筛选值</span>';
    const contentFilterChips = dataContext.triggerMode === 'product'
      ? '<span class="context-chip"><b>统计周期</b> ' + escapeHtml(filters['统计周期'] || '未识别') + '</span><span class="context-chip"><b>作品范围</b> 接口默认</span>'
      : buildFilterChips(filters);
    const productFilterChips = buildFilterChips(filters, ['作品范围'])
      + '<span class="context-chip muted"><b>作品范围</b> 不适用</span>';

    return '<details class="data-context"' + (contextExpanded ? ' open' : '') + '>'
      + '<summary><span class="context-dot"></span>数据口径 <em>' + escapeHtml(sourceLabel) + '</em></summary>'
      + '<div class="context-content">'
      + '<section class="context-card content"><div class="context-card-title"><span>作品</span>数据口径</div><div class="context-method-chips">' + contentFilterChips + '</div></section>'
      + '<section class="context-card product"><div class="context-card-title"><span>商品</span>数据口径</div><div class="context-method-chips">' + productFilterChips + '</div></section>'
      + '</div></details>';
  }

  function buildPanelHTML(results, totalCount) {
    const goalDefs = METRIC_DEFS.filter(d => d.goal !== null || d.goalMin !== undefined);

    // 达标筛选：每个指标使用“全部 / 达标 / 不达标”三态分段按钮。
    const vs = V();
    const isProduct = activeView === 'product';

    let filterChecks = '<div class="goal-filter-group">';
    for (const d of goalDefs) {
      const metActive = vs.goalFilters.includes(d.key + '_met');
      const unmetActive = vs.goalFilters.includes(d.key + '_unmet');
      filterChecks += '<span class="goal-item"><span class="goal-name">' + d.label + '</span>'
        + '<span class="goal-options">'
        + '<button class="goal-option' + (!metActive && !unmetActive ? ' active' : '') + '" data-key="' + d.key + '" data-state="all">全部</button>'
        + '<button class="goal-option met-option' + (metActive ? ' active' : '') + '" data-key="' + d.key + '" data-state="met">达标</button>'
        + '<button class="goal-option unmet-option' + (unmetActive ? ' active' : '') + '" data-key="' + d.key + '" data-state="unmet">不达标</button>'
        + '</span>'
        + '</span>';
    }
    filterChecks += '</div>';

    // 两个视角使用独立列结构：作品保留内容信息，商品只保留商品信息与关联作品数。
    const nameLabel = isProduct ? '商品标题' : '视频标题';
    const visibleMetricDefs = METRIC_DEFS.filter(d => isProduct || !d.productOnly);

    let html = buildHeaderHTML()
      + buildDataContextHTML()
      + filterChecks
      + '<div class="panel-body"><table class="' + (isProduct ? 'view-product' : 'view-content') + '"><thead><tr>'
      + '<th class="col-rowhead">#</th>'
      + '<th class="col-name">' + nameLabel + '</th>'
      + '<th class="col-product' + (isProduct ? ' sticky-last' : '') + '">商品ID</th>'
      + (isProduct
        ? '<th class="col-related col-sortable" data-sort="relatedCount">关联作品数' + buildSortIcon('relatedCount') + '</th>'
        : '<th class="col-content-id">内容ID</th><th class="col-time sticky-last col-sortable" data-sort="time">发布时间' + buildSortIcon('time') + '</th>');

    for (const def of visibleMetricDefs) {
      html += '<th class="col-metric col-sortable" data-sort="' + def.key + '">'
        + def.label + buildSortIcon(def.key)
        + (def.goalLabel ? '<br><small>' + def.goalLabel + '</small>' : '') + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const isOpen = expanded[activeView].has(r.id);
      html += buildMainRowHTML(r, i + 1, isProduct, isOpen);
      // 钻取子行：与主行同构，插入同一张表
      if (isOpen) {
        html += buildDrillRowsHTML(r, isProduct);
      }
    }
    html += '</tbody></table>'
      + (vs.hasMore
        ? '<div class="load-more-bar"><button class="load-more-btn"' + (fetchInProgress ? ' disabled' : '') + '>加载更多 300 条</button></div>'
        : ((vs.results && vs.results.length > 0) ? '<div class="load-more-bar load-more-end">已加载全部 ' + vs.results.length + ' 条</div>' : ''))
      + '</div>';
    return html;
  }

  // 商品ID单元格：支持多个ID（作品可能关联多个商品）
  function productIdCellHTML(productId) {
    if (!productId) return '<span class="dash">—</span>';
    const ids = String(productId).split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) return '<span class="dash">—</span>';
    return ids.map(function(id) {
      return '<a class="product-link" href="https://detail.tmall.com/item.htm?id=' + encodeURIComponent(id) + '" target="_blank" title="' + escapeHtml(id) + '">' + escapeHtml(id.substring(0, 20)) + '</a>';
    }).join('<span style="color:#ccc">, </span>');
  }

  // 内容ID单元格（可复制）
  function contentIdCellHTML(id) {
    return id ? '<span class="copy-id" title="点击复制内容ID" data-id="' + escapeHtml(id) + '">' + escapeHtml(id) + '</span>' : '<span class="dash">—</span>';
  }

  // 指标单元格（统一：按 METRIC_DEFS 全量输出；数据没有的指标显示 —）
  function metricCellsHTML(metrics, isProductView) {
    let cells = '';
    const defs = METRIC_DEFS.filter(d => isProductView || !d.productOnly);
    for (const def of defs) {
      const val = (metrics && def.key in metrics) ? metrics[def.key] : null;
      const met = isGoalMet(def, val);
      const cls = met === true ? 'met' : met === false ? 'unmet' : '';
      cells += '<td class="col-metric ' + cls + '">' + formatValue(def, val) + '</td>';
    }
    return cells;
  }

  // 主行：两个视角分别输出自己的信息列结构。
  function buildMainRowHTML(r, idx, isProduct, isOpen) {
    const displayText = isProduct ? (r.name || r.id) : (r.name || r.id);
    const displayIdShort = escapeHtml(displayText.substring(0, 25));
    let nameCell;
    if (isProduct) {
      nameCell = r.id
        ? '<span class="entity-title main-title product-title"><span class="entity-type product-type">商品</span><a class="product-link entity-title-link" href="https://detail.tmall.com/item.htm?id=' + encodeURIComponent(r.id) + '" target="_blank" title="' + escapeHtml(displayText) + '">' + displayIdShort + '</a></span>'
        : '<span title="' + escapeHtml(displayText) + '">' + displayIdShort + '</span>';
    } else {
      nameCell = r.id
        ? '<span class="entity-title main-title content-title"><span class="entity-type content-type">视频</span><a class="content-link entity-title-link" href="https://creator.guanghe.taobao.com/page/unify/contentDetail?contentId=' + encodeURIComponent(r.id) + '&tab=2&mode=0&contentType=video&source=guanghe" target="_blank" title="' + escapeHtml(r.name) + '">' + displayIdShort + '</a></span>'
        : '<span title="' + escapeHtml(r.name) + '">' + displayIdShort + '</span>';
    }
    const productCell = isProduct ? productIdCellHTML(r.id) : productIdCellHTML(r.productId);
    const timeCell = r.time ? r.time.substring(0, 10) : '<span class="dash">—</span>';
    const relatedCount = isProduct ? (itemToContents[r.id] || []).length : (r.items || []).length;

    if (isProduct) {
      return '<tr class="main-row' + (isOpen ? ' row-open' : '') + '" data-row-id="' + escapeHtml(r.id) + '">'
        + '<td class="col-rowhead"><button class="expand-btn" data-row-id="' + escapeHtml(r.id) + '" title="展开 ' + relatedCount + ' 个关联作品">' + (isOpen ? '▾' : '▸') + '</button><span>' + idx + '</span></td>'
        + '<td class="col-name">' + nameCell + '</td>'
        + '<td class="col-product sticky-last">' + productCell + '</td>'
        + '<td class="col-related"><span class="related-count">' + relatedCount + '</span></td>'
        + metricCellsHTML(r.metrics, true)
        + '</tr>';
    }

    return '<tr class="main-row' + (isOpen ? ' row-open' : '') + '" data-row-id="' + escapeHtml(r.id) + '">'
      + '<td class="col-rowhead"><button class="expand-btn" data-row-id="' + escapeHtml(r.id) + '" title="展开 ' + relatedCount + ' 个关联商品">' + (isOpen ? '▾' : '▸') + '</button><span>' + idx + '</span></td>'
      + '<td class="col-name">' + nameCell + '</td>'
      + '<td class="col-product">' + productCell + '</td>'
      + '<td class="col-content-id">' + contentIdCellHTML(r.id) + '</td>'
      + '<td class="col-time sticky-last">' + timeCell + '</td>'
      + metricCellsHTML(r.metrics, false)
      + '</tr>';
  }

  // 钻取子行：与主行同构（同一套列），保证左右滚动/锁定列完全对齐
  function buildDrillRowsHTML(r, isProduct) {
    if (isProduct) {
      // 商品视角展开 → 关联作品（每行是一条作品）
      let contents = itemToContents[r.id] || [];
      const allCount = contents.length;
      // 达标筛选同步作用到展开的作品：只显示满足达标条件的作品
      const gf = views.product.goalFilters;
      if (gf.length > 0) {
        contents = contents.filter(c => matchesGoalFilters(c.metrics, gf));
      }
      if (allCount === 0) {
        return drillMessageRow('已加载的作品里没有带这个商品的 — 切到「作品视角」点底部「加载更多」后可能出现。');
      }
      if (contents.length === 0) {
        return drillMessageRow('这个商品下的 ' + allCount + ' 个关联作品都不满足当前达标筛选');
      }
      let rows = '';
      for (const c of contents) {
        const nameText = escapeHtml((c.name || c.id).substring(0, 25));
        const link = c.id
          ? '<span class="entity-title drill-title content-title"><span class="entity-type content-type">视频</span><a class="content-link entity-title-link" href="https://creator.guanghe.taobao.com/page/unify/contentDetail?contentId=' + encodeURIComponent(c.id) + '&tab=2&mode=0&contentType=video&source=guanghe" target="_blank" title="' + escapeHtml(c.name) + '">' + nameText + '</a></span>'
          : '<span>' + nameText + '</span>';
        rows += '<tr class="drill-row">'
          + '<td class="col-rowhead drill-tag">↳</td>'
          + '<td class="col-name drill-name">' + link + '<small class="drill-submeta">内容ID ' + escapeHtml(c.id || '—') + (c.time ? ' · ' + escapeHtml(c.time.substring(0, 10)) : '') + '</small></td>'
          + '<td class="col-product sticky-last">' + productIdCellHTML(r.id) + '</td>'
          + '<td class="col-related"><span class="drill-type">作品</span></td>'
          + metricCellsHTML(c.metrics, true)
          + '</tr>';
      }
      return rows;
    } else {
      // 作品视角展开 → 关联商品（每行是一个商品）
      const items = r.items || [];
      if (items.length === 0) {
        return drillMessageRow('这条作品没有关联商品');
      }
      let rows = '';
      let missing = 0;
      for (const it of items) {
        const prod = itemToProduct[it.itemId];
        const nameText = escapeHtml((it.name || (prod && prod.name) || it.itemId).substring(0, 25));
        const link = '<span class="entity-title drill-title product-title"><span class="entity-type product-type">商品</span><a class="product-link entity-title-link" href="https://detail.tmall.com/item.htm?id=' + encodeURIComponent(it.itemId) + '" target="_blank" title="' + escapeHtml(it.name || '') + '">' + nameText + '</a></span>';
        const contentMetricCount = METRIC_DEFS.filter(d => !d.productOnly).length;
        const metricsCells = prod
          ? metricCellsHTML(prod.metrics, false)
          : '<td class="col-metric drill-missing" colspan="' + contentMetricCount + '">商品数据未加载，切到「商品视角」点「加载更多」补全</td>';
        if (!prod) missing++;
        rows += '<tr class="drill-row">'
          + '<td class="col-rowhead drill-tag">↳</td>'
          + '<td class="col-name drill-name">' + link + '<small class="drill-submeta">关联商品</small></td>'
          + '<td class="col-product">' + productIdCellHTML(it.itemId) + '</td>'
          + '<td class="col-content-id"><span class="dash">—</span></td>'
          + '<td class="col-time sticky-last"><span class="dash">—</span></td>'
          + metricsCells
          + '</tr>';
      }
      return rows;
    }
  }

  // 钻取提示行（占满整行）
  function drillMessageRow(msg) {
    const metricCount = METRIC_DEFS.filter(d => activeView === 'product' || !d.productOnly).length;
    const infoColumns = activeView === 'product' ? 4 : 5;
    return '<tr class="drill-row"><td class="drill-msg" colspan="' + (infoColumns + metricCount) + '">' + escapeHtml(msg) + '</td></tr>';
  }

  function ensurePanel() {
    if (panelRoot) return;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRoot = document.createElement('div');
    panelRoot.id = 'gh-analysis-panel';
    const shadow = panelRoot.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = getPanelCSS();
    shadow.appendChild(style);
    // 遮罩层
    const overlay = document.createElement('div');
    overlay.className = 'panel-overlay';
    overlay.addEventListener('click', closePanel);
    shadow.appendChild(overlay);
    const container = document.createElement('div');
    container.className = 'panel-container';
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('aria-label', '光合数据分析');
    shadow.appendChild(container);
    document.body.appendChild(panelRoot);
    document.addEventListener('keydown', handlePanelKeydown);
    panelOpen = true;
  }

  function handlePanelKeydown(event) {
    if (event.key === 'Escape') closePanel();
  }

  function closePanel() {
    if (!panelRoot) return;
    panelRoot.remove();
    panelRoot = null;
    panelOpen = false;
    document.body.style.overflow = previousBodyOverflow;
    document.removeEventListener('keydown', handlePanelKeydown);
  }

  function bindPanelEvents(container) {
    const contextDetails = container.querySelector('.data-context');
    if (contextDetails) {
      contextDetails.addEventListener('toggle', () => {
        contextExpanded = contextDetails.open;
      });
    }
    // 视角切换 tab
    container.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const view = tab.getAttribute('data-view');
        if (view && view !== activeView) {
          activeView = view;
          renderPanel();
        }
      });
    });
    // 加载更多：只加载当前视角
    const loadMoreBtn = container.querySelector('.load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        if (fetchInProgress) return;
        triggerFetchMore(activeView);
      });
    }
    // 展开/收起钻取
    container.querySelectorAll('.expand-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-row-id');
        const set = expanded[activeView];
        if (set.has(id)) set.delete(id); else set.add(id);
        renderPanel();
      });
    });
    // 顶部筛选统一由“搜索”按钮提交，输入框失焦不再自动触发筛选。
    const searchBtn = container.querySelector('.panel-search-btn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        const filterInput = container.querySelector('.panel-filter-input');
        const nameFilterInput = container.querySelector('.panel-name-filter-input');
        const idFilterInput = container.querySelector('.panel-id-filter-input');
        const vs = V();
        vs.filter = filterInput ? filterInput.value.trim() : '';
        vs.nameFilter = nameFilterInput ? nameFilterInput.value.trim() : '';
        vs.idFilter = idFilterInput ? idFilterInput.value.trim() : '';
        renderPanel();
      });
      container.querySelectorAll('.panel-filter-input,.panel-name-filter-input,.panel-id-filter-input').forEach(input => {
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') searchBtn.click();
        });
      });
    }
    const clearBtn = container.querySelector('.panel-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        resetViewFilters(activeView);
        renderPanel();
      });
    }
    // 表头点击排序（两视角共享，切换视角保持一致）
    container.querySelectorAll('.col-sortable').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.getAttribute('data-sort');
        if (sortField === field) {
          sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
        } else {
          sortField = field;
          sortOrder = 'desc';
        }
        renderPanel();
      });
    });
    // 达标三态分段按钮。
    container.querySelectorAll('.goal-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        const state = btn.getAttribute('data-state');
        const vs = V();
        vs.goalFilters = vs.goalFilters.filter(v => v !== key + '_met' && v !== key + '_unmet');
        if (state === 'met') vs.goalFilters.push(key + '_met');
        if (state === 'unmet') vs.goalFilters.push(key + '_unmet');
        renderPanel();
      });
    });
    // 内容ID点击复制
    container.addEventListener('click', function(e) {
      const el = e.target.closest('.copy-id');
      if (!el) return;
      const id = el.getAttribute('data-id');
      navigator.clipboard.writeText(id).then(() => {
        const prev = el.textContent;
        el.textContent = '已复制';
        el.style.color = '#16a34a';
        setTimeout(() => { el.textContent = prev; el.style.color = ''; }, 1500);
      }).catch(() => {});
    });
    const close = container.querySelector('.panel-close');
    if (close) close.addEventListener('click', closePanel);
  }

  function createTriggerButton() {
    if (!currentMode) return;
    if (currentMode === 'overview') {
      createChannelDiagnosisButton();
      return;
    }

    const label = currentMode === 'product' ? '商品分析' : '数据分析';

    // 精确定位"展开更多指标"按钮本身（叶子元素，最多含一个箭头图标）；
    // 其父节点即为 flex 行容器（内含"展开更多指标"与导出图标），是我们要挂靠的行。
    function getSpreadEl() {
      return Array.from(document.querySelectorAll('button,span,div'))
        .find(el => el.children.length <= 1 && el.textContent.trim().startsWith('展开更多指标'));
    }

    function tryInjectNearSearch() {
      const spread = getSpreadEl();
      if (!spread) return false;
      if (document.getElementById('gh-trigger-btn')) return true;

      const btn = document.createElement('button');
      btn.id = 'gh-trigger-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        // 点哪个按钮就默认进对应视角，打开同一个双视角面板
        activeView = currentMode === 'product' ? 'product' : 'content';
        openPanelAndFetch();
      });

      const baseStyle = 'height:32px;padding:0 16px;border-radius:16px;cursor:pointer;font-size:13px;font-weight:700;border:none;background:linear-gradient(135deg,#ff8a2a 0%,#ff5f00 100%);color:#fff;box-shadow:0 4px 12px rgba(255,96,0,.3);transition:box-shadow .15s,transform .15s;white-space:nowrap;vertical-align:middle;';
      btn.onmouseenter = () => { btn.style.boxShadow = '0 6px 18px rgba(255,96,0,.45)'; btn.style.transform = 'translateY(-1px)'; };
      btn.onmouseleave = () => { btn.style.boxShadow = '0 4px 12px rgba(255,96,0,.3)'; btn.style.transform = ''; };

      if (currentMode === 'product') {
        // 插入到"展开更多指标"前面，作为页面内元素
        btn.style.cssText = baseStyle + 'margin-right:8px;';
        spread.parentNode.insertBefore(btn, spread);
      } else {
        // content 模式：插入到"展开更多指标"行最右端，靠右对齐表格操作列，随页面一起滚动
        btn.style.cssText = baseStyle + 'margin-left:auto;';
        spread.parentNode.appendChild(btn);
      }
      return true;
    }

    if (!tryInjectNearSearch()) {
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        if (tryInjectNearSearch() || attempts > 40) clearInterval(timer);
      }, 500);
    }
  }

  // ===== 光合资产总览：渠道诊断 =====
  // 生意参谋版本保留在独立文件中但不再注入；渠道数值统一由 page-hook 的 MTop 响应提供。
  const GH_CHANNELS = ['全部', '首猜', '逛逛', '搜索', '其他'];
  const GH_ASSETS = [
    { code: 'self', name: '自制内容' },
    { code: 'business', name: '达人合作内容' },
    { code: 'ugc', name: '其他用户内容' },
  ];

  function channelSafeDivide(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
    if (denominator === 0) return numerator === 0 ? 0 : null;
    return numerator / denominator;
  }

  function channelNormalizeShare(value) {
    const text = String(value == null ? '' : value).replace(/[\s,，]/g, '');
    const matched = text.match(/^(-?(?:\d+\.?\d*|\.\d+))(%?)$/);
    if (!matched) return null;
    let number = Number(matched[1]);
    if (!Number.isFinite(number)) return null;
    if (matched[2] === '%' || Math.abs(number) > 1) number /= 100;
    return number >= 0 && number <= 1 ? number : null;
  }

  function channelFormatInteger(value) {
    return Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '—';
  }

  function channelFormatMoney(value) {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 10000) {
      const wan = value / 10000;
      return wan.toFixed(wan >= 100 ? 1 : 2).replace(/\.0$/, '') + '万';
    }
    return Math.round(value).toLocaleString('zh-CN');
  }

  function channelFormatPercent(value, digits) {
    if (!Number.isFinite(value)) return '—';
    return (value * 100).toFixed(digits == null ? 0 : digits).replace(/\.0+$/, '') + '%';
  }

  function channelFormatFixed(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : '—';
  }

  function channelShowPanel(title, bodyHtml) {
    const previous = document.getElementById('gh-channel-panel');
    if (previous) previous.remove();
    const root = document.createElement('section');
    root.id = 'gh-channel-panel';
    root.innerHTML = [
      '<style>',
      '#gh-channel-panel{position:fixed;z-index:2147483646;top:50%;left:50%;transform:translate(-50%,-50%);width:min(1180px,calc(100vw - 32px));height:min(680px,calc(100vh - 40px));overflow:hidden;display:flex;flex-direction:column;background:#fff;border:1px solid #eadfd7;border-radius:10px;box-shadow:0 24px 64px rgba(15,23,42,.28);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937}',
      '#gh-channel-panel .ghc-head{height:54px;min-height:54px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f0e5dc;font-size:18px;font-weight:750;background:#fffaf6}',
      '#gh-channel-panel .ghc-close{appearance:none;border:0;background:transparent;padding:6px 9px;font-size:26px;line-height:1;color:#94a3b8;cursor:pointer}',
      '#gh-channel-panel .ghc-content{padding:18px;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden}',
      '#gh-channel-panel .ghc-context{margin:0 0 14px;font-size:13px;line-height:1.5;color:#64748b}',
      '#gh-channel-panel .ghc-warning{margin:0;padding:10px 12px;border-left:3px solid #ff6600;background:#fff5eb;color:#8a4100;font-size:13px;line-height:1.6}',
      '#gh-channel-panel .ghc-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px}',
      '#gh-channel-panel .ghc-views{display:inline-flex;padding:3px;border-radius:8px;background:#fff1e7}',
      '#gh-channel-panel .ghc-view-btn{border:0;border-radius:6px;padding:7px 18px;background:transparent;color:#9a4a13;cursor:pointer;font-size:13px;font-weight:700}',
      '#gh-channel-panel .ghc-view-btn.active{background:#ff6a00;color:#fff;box-shadow:0 2px 7px rgba(255,96,0,.24)}',
      '#gh-channel-panel .ghc-cache{font-size:12px;color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:999px;padding:4px 9px}',
      '#gh-channel-panel table{border-collapse:collapse;width:100%;font-size:14px}',
      '#gh-channel-panel th,#gh-channel-panel td{border:1px solid #ffd7ba;padding:10px 9px;text-align:center;white-space:nowrap}',
      '#gh-channel-panel th{background:#ff7a1a;color:#fff;font-size:14px;font-weight:700}',
      '#gh-channel-panel .ghc-table-asset{table-layout:fixed;font-size:12px}',
      '#gh-channel-panel .ghc-table-asset th,#gh-channel-panel .ghc-table-asset td{padding:6px 4px;white-space:normal;line-height:1.25;word-break:keep-all}',
      '#gh-channel-panel .ghc-table-asset th{font-size:12px}',
      '#gh-channel-panel .ghc-table-asset th:first-child,#gh-channel-panel .ghc-table-asset td:first-child{width:112px}',
      '#gh-channel-panel .ghc-table-asset .ghc-key{width:112px;word-break:keep-all}',
      '#gh-channel-panel .ghc-table-asset .ghc-child .ghc-key{padding-left:18px}',
      '#gh-channel-panel .ghc-table-asset .ghc-expand{width:18px;margin-right:2px;font-size:12px}',
      '#gh-channel-panel .ghc-table-asset .ghc-best-tag{display:block;width:max-content;margin:2px auto 0;padding:0 3px;font-size:9px;line-height:13px}',
      '@media (max-width:900px){#gh-channel-panel .ghc-content{padding:10px}#gh-channel-panel .ghc-table-asset{font-size:11px}#gh-channel-panel .ghc-table-asset th,#gh-channel-panel .ghc-table-asset td{padding:5px 2px}#gh-channel-panel .ghc-table-asset th:first-child,#gh-channel-panel .ghc-table-asset td:first-child,#gh-channel-panel .ghc-table-asset .ghc-key{width:82px}}',
      '#gh-channel-panel .ghc-parent{background:#fff7f0}',
      '#gh-channel-panel .ghc-parent:hover{background:#fff0e4}',
      '#gh-channel-panel .ghc-child{background:#fff}',
      '#gh-channel-panel .ghc-child:hover{background:#fffaf6}',
      '#gh-channel-panel .ghc-key{font-weight:650;text-align:left}',
      '#gh-channel-panel .ghc-child .ghc-key{padding-left:38px;color:#64748b;font-weight:500}',
      '#gh-channel-panel .ghc-expand{width:24px;margin-right:4px;border:0;background:transparent;color:#ff6600;cursor:pointer;font-size:14px;line-height:1}',
      '#gh-channel-panel .ghc-best{background:#ecfdf5!important;color:#047857;font-weight:750}',
      '#gh-channel-panel .ghc-best-tag{display:inline-block;margin-left:5px;padding:1px 5px;border-radius:8px;background:#10b981;color:#fff;font-size:10px;line-height:16px;vertical-align:1px}',
      '#gh-channel-panel .ghc-actions{display:flex;justify-content:flex-end;margin-top:14px}',
      '#gh-channel-panel .ghc-copy{border:0;border-radius:6px;padding:8px 14px;background:#ff6600;color:#fff;cursor:pointer;font-size:13px;font-weight:650}',
      '#gh-channel-panel .ghc-refresh{border:1px solid #ffb37a;border-radius:6px;padding:7px 13px;background:#fff;color:#d95700;cursor:pointer;font-size:13px;font-weight:650;margin-right:8px}',
      '</style>',
      '<div class="ghc-head"><span>' + escapeHtml(title) + '</span><button class="ghc-close" type="button" aria-label="关闭">×</button></div>',
      '<div class="ghc-content">' + bodyHtml + '</div>',
    ].join('');
    document.body.appendChild(root);
    root.querySelector('.ghc-close').addEventListener('click', () => root.remove());
    const copyButton = root.querySelector('.ghc-copy');
    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(root.querySelector('table').innerText);
          copyButton.textContent = '已复制';
          setTimeout(() => { copyButton.textContent = '复制表格'; }, 1200);
        } catch (error) {
          copyButton.textContent = '复制失败';
        }
      });
    }
    root.querySelectorAll('.ghc-view-btn').forEach(viewButton => {
      viewButton.addEventListener('click', () => {
        channelReportView = viewButton.getAttribute('data-view') || 'channel';
        channelRenderCurrentReport();
      });
    });
    root.querySelectorAll('.ghc-expand').forEach(expandButton => {
      expandButton.addEventListener('click', () => {
        const view = expandButton.getAttribute('data-view') || 'channel';
        const group = expandButton.getAttribute('data-group') || '';
        const expanded = channelExpandedGroups[view];
        if (expanded.has(group)) expanded.delete(group);
        else expanded.add(group);
        channelRenderCurrentReport();
      });
    });
    const refreshButton = root.querySelector('.ghc-refresh');
    if (refreshButton) {
      refreshButton.addEventListener('click', () => {
        root.remove();
        runChannelDiagnosis({ force: true });
      });
    }
  }

  function channelFindRow(channel, assetCode) {
    return channelReportRows.find(row => row.channel === channel && row.assetCode === assetCode);
  }

  function channelHighest(rows, getter) {
    const values = (rows || []).map(getter).filter(Number.isFinite);
    return values.length ? Math.max.apply(null, values) : null;
  }

  function channelIsHighest(row, peerRows, getter) {
    const value = getter(row);
    const highest = channelHighest(peerRows, getter);
    return Number.isFinite(value) && Number.isFinite(highest) && highest > 0 &&
      Math.abs(value - highest) < Math.max(1, Math.abs(highest)) * 1e-10;
  }

  function channelMetricCell(text, best, label) {
    return '<td' + (best ? ' class="ghc-best"' : '') + '>' + text +
      (best ? '<span class="ghc-best-tag">' + escapeHtml(label || '最高') + '</span>' : '') +
      '</td>';
  }

  function channelMetricCells(row, baseline, peerRows) {
    const supplyCells = channelReportView === 'asset'
      ? channelMetricCell(channelFormatInteger(row.publishedContents), false) +
        channelMetricCell(channelFormatInteger(row.publicContents), false) +
        channelMetricCell(
          channelFormatPercent(channelSafeDivide(row.publicContents, row.publishedContents), 2),
          false
        )
      : '';
    const contentShare = channelSafeDivide(row.contentViewers, baseline.contentViewers);
    const productClickShare = channelSafeDivide(row.productClickers, baseline.productClickers);
    const cartBuyerShare = channelSafeDivide(row.cartBuyers, baseline.cartBuyers);
    const seedingBuyerShare = channelSafeDivide(row.seedingBuyers, baseline.seedingBuyers);
    const averageOrderValue = channelSafeDivide(row.seedingAmount, row.seedingBuyers);
    const uvValue = channelSafeDivide(row.seedingAmount, row.contentViewers);
    const shareGetter = field => candidate => channelSafeDivide(candidate[field], baseline[field]);
    const averageOrderValueGetter = candidate => channelSafeDivide(
      candidate.seedingAmount, candidate.seedingBuyers
    );
    const uvValueGetter = candidate => channelSafeDivide(
      candidate.seedingAmount, candidate.contentViewers
    );
    return supplyCells +
      channelMetricCell(channelFormatInteger(row.contentViewers), false) +
      channelMetricCell(
        channelFormatPercent(contentShare),
        channelIsHighest(row, peerRows, shareGetter('contentViewers')),
        '占比最高'
      ) +
      channelMetricCell(channelFormatPercent(row.paidTrafficShare, 2), false) +
      channelMetricCell(channelFormatInteger(row.productClickers), false) +
      channelMetricCell(
        channelFormatPercent(productClickShare),
        channelIsHighest(row, peerRows, shareGetter('productClickers')),
        '占比最高'
      ) +
      channelMetricCell(channelFormatInteger(row.cartBuyers), false) +
      channelMetricCell(
        channelFormatPercent(cartBuyerShare),
        channelIsHighest(row, peerRows, shareGetter('cartBuyers')),
        '占比最高'
      ) +
      channelMetricCell(channelFormatInteger(row.seedingBuyers), false) +
      channelMetricCell(
        channelFormatPercent(seedingBuyerShare),
        channelIsHighest(row, peerRows, shareGetter('seedingBuyers')),
        '占比最高'
      ) +
      channelMetricCell(channelFormatMoney(row.seedingAmount), false) +
      channelMetricCell(
        channelFormatMoney(averageOrderValue),
        channelIsHighest(row, peerRows, averageOrderValueGetter),
        '价值最高'
      ) +
      channelMetricCell(
        channelFormatFixed(uvValue, 2),
        channelIsHighest(row, peerRows, uvValueGetter),
        '价值最高'
      );
  }

  function channelParentRow(label, row, baseline, peerRows, view, group) {
    const expanded = channelExpandedGroups[view].has(group);
    return '<tr class="ghc-parent"><td class="ghc-key">' +
      '<button class="ghc-expand" type="button" data-view="' + view + '" data-group="' +
      escapeHtml(group) + '" aria-label="' + (expanded ? '收起' : '展开') + '">' +
      (expanded ? '▼' : '▶') + '</button>' + escapeHtml(label) + '</td>' +
      channelMetricCells(row, baseline, peerRows) + '</tr>';
  }

  function channelChildRow(label, row, baseline, peerRows) {
    return '<tr class="ghc-child"><td class="ghc-key">↳ ' + escapeHtml(label) + '</td>' +
      channelMetricCells(row, baseline, peerRows) + '</tr>';
  }

  function channelBuildBody() {
    const grandTotal = channelFindRow('全部', 'all');
    if (channelReportView === 'asset') {
      const assetParents = GH_ASSETS.map(asset => channelFindRow('全部', asset.code)).filter(Boolean);
      const assetRows = [{ code: 'all', name: '全部资产' }].concat(GH_ASSETS);
      return assetRows.map(asset => {
        const parent = channelFindRow('全部', asset.code);
        if (!parent) return '';
        const peerRows = asset.code === 'all' ? [] : assetParents;
        let html = channelParentRow(asset.name, parent, grandTotal, peerRows, 'asset', asset.code);
        if (channelExpandedGroups.asset.has(asset.code)) {
          const channelChildren = GH_CHANNELS.filter(channel => channel !== '全部')
            .map(channel => channelFindRow(channel, asset.code)).filter(Boolean);
          html += GH_CHANNELS.filter(channel => channel !== '全部').map(channel => {
            const child = channelFindRow(channel, asset.code);
            return child ? channelChildRow(channel, child, parent, channelChildren) : '';
          }).join('');
        }
        return html;
      }).join('');
    }
    const channelParents = GH_CHANNELS.filter(channel => channel !== '全部')
      .map(channel => channelFindRow(channel, 'all')).filter(Boolean);
    return GH_CHANNELS.map(channel => {
      const parent = channelFindRow(channel, 'all');
      if (!parent) return '';
      const parentPeers = channel === '全部' ? [] : channelParents;
      let html = channelParentRow(channel, parent, grandTotal, parentPeers, 'channel', channel);
      if (channelExpandedGroups.channel.has(channel)) {
        const assetChildren = GH_ASSETS.map(asset => channelFindRow(channel, asset.code)).filter(Boolean);
        html += GH_ASSETS.map(asset => {
          const child = channelFindRow(channel, asset.code);
          return child ? channelChildRow(asset.name, child, parent, assetChildren) : '';
        }).join('');
      }
      return html;
    }).join('');
  }

  function channelRenderCurrentReport() {
    const total = channelFindRow('全部', 'all');
    if (!total || !Number.isFinite(total.contentViewers) || !Number.isFinite(total.productClickers) ||
        !Number.isFinite(total.cartBuyers) || !Number.isFinite(total.seedingBuyers) ||
        !Number.isFinite(total.seedingAmount)) {
      throw new Error('“全部”渠道缺少核心指标，无法计算渠道占比。');
    }
    const firstColumn = channelReportView === 'asset' ? '资产' : '渠道';
    const supplyHeader = channelReportView === 'asset'
      ? '<th colspan="3">内容供给</th>'
      : '';
    const supplySubHeader = channelReportView === 'asset'
      ? '<th>发布内容数</th><th>公域内容数</th><th>审核通过率</th>'
      : '';
    const tableClass = channelReportView === 'asset' ? 'ghc-table-asset' : 'ghc-table-channel';
    const table = '<table class="' + tableClass + '"><thead><tr><th rowspan="2">' + firstColumn +
      '</th>' + supplyHeader +
      '<th colspan="3">内容查看人数</th><th colspan="2">商品点击人数</th>' +
      '<th colspan="2">商品加购人数</th><th colspan="2">种草成交人数</th><th colspan="3">价值</th></tr>' +
      '<tr>' + supplySubHeader +
      '<th>人数</th><th>占比</th><th>付费占比</th>' +
      '<th>人数</th><th>占比</th>' +
      '<th>人数</th><th>占比</th>' +
      '<th>人数</th><th>占比</th>' +
      '<th>种草成交金额</th><th>客单价</th><th>UV价值</th></tr></thead><tbody>' +
      channelBuildBody() + '</tbody></table>';
    const contextItems = Object.keys(channelReportFilterContext || {}).map((key) => (
      '<b>' + escapeHtml(key) + '</b> ' + escapeHtml(String(channelReportFilterContext[key]))
    )).join('；');
    channelShowPanel('光合渠道诊断',
      '<p class="ghc-context">数据口径：' + (contextItems || '当前资产总览筛选条件') +
      '。数据来自光合 MTop 核心指标接口，完成后已恢复原渠道和周期。</p>' +
      '<div class="ghc-toolbar"><div class="ghc-views">' +
      '<button class="ghc-view-btn' + (channelReportView === 'channel' ? ' active' : '') +
      '" type="button" data-view="channel">渠道视角</button>' +
      '<button class="ghc-view-btn' + (channelReportView === 'asset' ? ' active' : '') +
      '" type="button" data-view="asset">资产视角</button></div>' +
      (channelReportFromSnapshot ? '<span class="ghc-cache">已读取本地快照</span>' : '') +
      '</div>' + table +
      '<div class="ghc-actions"><button class="ghc-refresh" type="button">重新抓取</button>' +
      '<button class="ghc-copy" type="button">复制表格</button></div>');
  }

  function channelRenderReport(rows, filterContext, options) {
    channelReportRows = Array.isArray(rows) ? rows : [];
    channelReportFilterContext = filterContext || {};
    channelReportFromSnapshot = !!(options && options.fromSnapshot);
    channelReportView = 'channel';
    channelExpandedGroups.channel.clear();
    channelExpandedGroups.asset.clear();
    channelRenderCurrentReport();
  }

  function channelBuildSnapshotKey(filters, metricsOnly) {
    const visible = filters || {};
    const rangeText = String(visible['统计周期'] || '');
    const dates = rangeText.match(/\d{4}[.-]\d{2}[.-]\d{2}/g) || [];
    // 渠道诊断固定抓最近30天；只要最新数据日期不变，30天起止区间就不会变。
    const latestDate = dates.length ? dates[dates.length - 1].replace(/-/g, '.') : '';
    return JSON.stringify({
      schema: metricsOnly ? 10 : 9,
      mode: metricsOnly ? 'businessDefense' : 'full',
      page: location.pathname,
      latestDate,
      contentType: visible['内容类型'] || '全部',
      contentSource: visible['内容来源'] || '全部',
      workScope: visible['作品范围'] || '全部作品',
    });
  }

  function channelSnapshotComplete(snapshot) {
    if (!snapshot || snapshot.schema !== 9 || !Array.isArray(snapshot.rows)) return false;
    return GH_CHANNELS.every(channel => (
      ['all'].concat(GH_ASSETS.map(asset => asset.code)).every(assetCode => (
        snapshot.rows.some(row => (
          row.channel === channel && row.assetCode === assetCode &&
          (channel !== '全部' || (
            Number.isFinite(row.publishedContents) &&
            Number.isFinite(row.publicContents)
          )) &&
          Number.isFinite(row.contentViewers) &&
          (row.paidTrafficShare == null || Number.isFinite(row.paidTrafficShare)) &&
          Number.isFinite(row.productClickers) &&
          Number.isFinite(row.cartBuyers) &&
          Number.isFinite(row.seedingBuyers) &&
          Number.isFinite(row.seedingAmount)
        ))
      ))
    ));
  }

  function channelBusinessMetricsComplete(snapshot) {
    if (!snapshot || snapshot.schema !== 10 || snapshot.mode !== 'businessDefense' ||
        !Array.isArray(snapshot.rows) || !Number.isFinite(snapshot.seedingGmvShare)) {
      return false;
    }
    const selfRow = snapshot.rows.find(row => (
      row.channel === '全部' && row.assetCode === 'self'
    ));
    return !!selfRow && Number.isFinite(selfRow.publishedContents) &&
      Number.isFinite(selfRow.publicContents);
  }

  function channelReadSnapshot(callback) {
    let settled = false;
    const finish = snapshot => {
      if (settled) return;
      settled = true;
      clearTimeout(fallbackTimer);
      callback(snapshot || null);
    };
    // 扩展重新加载后，旧页面的 storage 回调可能既不成功也不报错。
    const fallbackTimer = setTimeout(() => finish(null), 3000);
    try {
      chrome.storage.local.get(['gh_channel_snapshot'], (data) => {
        try {
          if (chrome.runtime.lastError) {
            finish(null);
            return;
          }
        } catch (error) {
          finish(null);
          return;
        }
        finish(data && data.gh_channel_snapshot);
      });
    } catch (error) {
      console.warn(TAG, '渠道快照读取失败，改为重新抓取:', error);
      finish(null);
    }
  }

  function channelStartFetch(button, visibleFilters, snapshotKey) {
    channelDiagnosisSnapshotKey = snapshotKey;
    if (button) button.textContent = '正在连接接口…';
    if (channelDiagnosisTimeout) clearTimeout(channelDiagnosisTimeout);
    channelDiagnosisTimeout = setTimeout(() => {
      channelDiagnosisTimeout = null;
      channelDiagnosisRunning = false;
      channelDiagnosisSnapshotKey = '';
      if (button) {
        button.disabled = false;
        button.textContent = '渠道诊断';
      }
      const shouldRender = !channelDiagnosisSilent;
      channelDiagnosisSilent = false;
      channelDiagnosisMetricsOnly = false;
      if (shouldRender) {
        channelShowPanel('光合渠道诊断',
          '<p class="ghc-warning">渠道接口取数超时，请刷新资产总览后重试。</p>');
      }
    }, 110000);
    window.postMessage({
      type: 'GH_CHANNEL_DIAGNOSIS_REQUEST',
      channels: GH_CHANNELS,
      metricsOnly: channelDiagnosisMetricsOnly,
      visibleFilters,
    }, '*');
  }

  function runChannelDiagnosis(options) {
    if (channelDiagnosisRunning) return;
    channelDiagnosisRunning = true;
    channelDiagnosisSilent = Boolean(options && options.silent);
    channelDiagnosisMetricsOnly = Boolean(options && options.metricsOnly);
    const button = document.getElementById('gh-channel-trigger-btn');
    if (button) {
      button.disabled = true;
      button.textContent = '正在检查快照…';
    }
    const visibleFilters = collectVisibleFilters();
    const snapshotKey = channelBuildSnapshotKey(visibleFilters, channelDiagnosisMetricsOnly);
    const snapshotComplete = channelDiagnosisMetricsOnly
      ? channelBusinessMetricsComplete
      : channelSnapshotComplete;
    if (options && options.force) {
      channelStartFetch(button, visibleFilters, snapshotKey);
      return;
    }
    if (channelMemorySnapshot && channelMemorySnapshot.key === snapshotKey &&
        snapshotComplete(channelMemorySnapshot)) {
      channelDiagnosisRunning = false;
      channelDiagnosisSnapshotKey = '';
      if (button) {
        button.disabled = false;
        button.textContent = '渠道诊断';
      }
      const shouldRender = !channelDiagnosisSilent;
      channelDiagnosisSilent = false;
      channelDiagnosisMetricsOnly = false;
      if (shouldRender) {
        channelRenderReport(
          channelMemorySnapshot.rows,
          channelMemorySnapshot.filterContext || visibleFilters,
          { fromSnapshot: true }
        );
      }
      return;
    }
    channelReadSnapshot((snapshot) => {
      if (snapshot && snapshot.key === snapshotKey && snapshotComplete(snapshot)) {
        channelMemorySnapshot = snapshot;
        channelDiagnosisRunning = false;
        channelDiagnosisSnapshotKey = '';
        if (button) {
          button.disabled = false;
          button.textContent = '渠道诊断';
        }
        const shouldRender = !channelDiagnosisSilent;
        channelDiagnosisSilent = false;
        channelDiagnosisMetricsOnly = false;
        if (shouldRender) {
          channelRenderReport(snapshot.rows, snapshot.filterContext || visibleFilters, { fromSnapshot: true });
        }
        return;
      }
      channelStartFetch(button, visibleFilters, snapshotKey);
    });
  }

  function waitForChannelSnapshot(snapshotKey, timeoutMs, metricsOnly) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = setInterval(() => {
        chrome.storage.local.get(['gh_channel_snapshot'], (data) => {
          const snapshot = data && data.gh_channel_snapshot;
          const complete = metricsOnly
            ? channelBusinessMetricsComplete(snapshot)
            : channelSnapshotComplete(snapshot);
          if (snapshot && snapshot.key === snapshotKey && complete) {
            clearInterval(timer);
            resolve({ ok: true, snapshot });
            return;
          }
          if (Date.now() - startedAt > timeoutMs) {
            clearInterval(timer);
            resolve({ ok: false, message: '光合渠道诊断取数超时。' });
          }
        });
      }, 1000);
    });
  }

  function createChannelDiagnosisButton() {
    if (document.getElementById('gh-channel-trigger-btn')) return;
    const button = document.createElement('button');
    button.id = 'gh-channel-trigger-btn';
    button.type = 'button';
    button.textContent = '渠道诊断';
    button.dataset.pluginVersion = '2.14.7';
    button.setAttribute('aria-label', '渠道诊断');
    button.style.cssText = [
      'position:fixed', 'right:22px', 'top:50%', 'transform:translateY(-50%)',
      'z-index:2147483645', 'height:38px', 'padding:0 16px', 'border:0',
      'border-radius:19px', 'background:linear-gradient(135deg,#ff8a2a 0%,#ff5f00 100%)',
      'color:#fff', 'font:700 14px/38px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
      'box-shadow:0 6px 18px rgba(255,96,0,.34)', 'cursor:pointer',
    ].join(';');
    button.addEventListener('click', runChannelDiagnosis);
    document.body.appendChild(button);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function showToast(msg, duration = 3000) {
    let toast = document.getElementById('gh-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'gh-toast';
      toast.style.cssText = 'position:fixed;right:64px;top:50%;transform:translateY(-50%);background:rgba(28,32,38,.9);color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;z-index:99999;pointer-events:none;white-space:nowrap;box-shadow:0 12px 30px rgba(20,24,31,.22);backdrop-filter:blur(8px);';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.display = 'none'; }, duration);
  }

  // showProgress(label) — API 模式简单文字提示
  // showProgress(currentStep, totalSteps, label) — Excel 模式带步骤进度
  function showProgress(currentStepOrLabel, totalSteps, label) {
    let box = document.getElementById('gh-progress');
    if (!box) {
      box = document.createElement('div');
      box.id = 'gh-progress';
      box.style.cssText = 'position:fixed;right:64px;top:calc(50% + 44px);transform:translateY(-50%);background:#fff;border:1px solid rgba(226,232,240,.95);border-radius:8px;box-shadow:0 18px 42px rgba(15,23,42,.16);padding:14px 16px;min-width:238px;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:12px;color:#334155;';
      document.body.appendChild(box);
    }

    // API 模式：showProgress('文字提示')
    if (typeof totalSteps !== 'number') {
      const msg = currentStepOrLabel;
      box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">`
        + `<span style="font-weight:700;color:#111827;font-size:13px">正在获取数据</span>`
        + `<span id="gh-progress-close" style="cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;padding:0 2px;user-select:none" title="关闭">×</span>`
        + `</div>`
        + `<div style="color:#475569;font-size:12px;line-height:1.6">${escapeHtml(String(msg))}</div>`;
      box.style.display = 'block';
      const closeBtn = box.querySelector('#gh-progress-close');
      if (closeBtn) closeBtn.onclick = hideProgress;
      return;
    }

    // Excel 模式：showProgress(step, total, label)
    const currentStep = currentStepOrLabel;
    const pct = Math.round((currentStep / totalSteps) * 100);
    const steps = ['展开指标面板', '全选所有指标', '点击下载按钮', '等待数据拦截'];
    let stepsHTML = steps.map((s, i) => {
      const idx = i + 1;
      let icon, color;
      if (idx < currentStep) { icon = '✓'; color = '#16a34a'; }
      else if (idx === currentStep) { icon = '●'; color = '#ff6600'; }
      else { icon = '○'; color = '#cbd5e1'; }
      return `<div style="display:flex;align-items:center;gap:8px;margin:5px 0;color:${color};font-weight:${idx===currentStep?'600':'400'}">`
        + `<span style="width:16px;text-align:center;font-size:11px">${icon}</span><span style="color:${idx===currentStep?'#1e293b':'#64748b'}">${s}</span></div>`;
    }).join('');

    box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">`
      + `<span style="font-weight:700;color:#111827;font-size:13px">自动获取数据</span>`
      + `<span id="gh-progress-close" style="cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;padding:0 2px;user-select:none" title="关闭">×</span>`
      + `</div>`
      + stepsHTML
      + `<div style="margin-top:12px;background:#f1f5f9;border-radius:999px;height:7px;overflow:hidden">`
      + `<div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#ff8a2a 0%,#ff6600 100%);transition:width .3s;border-radius:999px"></div></div>`
      + `<div style="text-align:right;color:#94a3b8;margin-top:6px;font-size:11px">${label}</div>`;
    box.style.display = 'block';
    const progressCloseBtn = box.querySelector('#gh-progress-close');
    if (progressCloseBtn) {
      progressCloseBtn.onclick = hideProgress;
    }
  }

  function hideProgress() {
    const box = document.getElementById('gh-progress');
    if (box) box.remove();
  }

  // 按文字内容查找元素
  function findByText(selector, text) {
    return Array.from(document.querySelectorAll(selector))
      .find(el => el.textContent.trim().includes(text));
  }

  // ===== 快照缓存：一天内筛选器没变 → 秒出缓存，不重新抓 =====
  const SNAPSHOT_TTL = 24 * 60 * 60 * 1000; // 1 天

  // 从页面上读取用户看得懂的筛选文字。真实接口参数另行保存，但不直接展示给用户。
  function collectVisibleFilters() {
    const result = {};
    const rangeEl = Array.from(document.querySelectorAll('*')).find(el =>
      el.children.length === 0 && /\d{4}\.\d{2}\.\d{2}\s*-\s*\d{4}\.\d{2}\.\d{2}/.test(el.textContent));
    if (rangeEl) result['统计周期'] = rangeEl.textContent.trim();

    ['内容类型', '消费渠道', '内容来源', '内容发布时间'].forEach(label => {
      const el = Array.from(document.querySelectorAll('div,span')).find(node => {
        const text = node.textContent.trim();
        return node.children.length <= 3 && text.startsWith(label) && text.length < 40;
      });
      if (el) {
        const value = el.textContent.trim().slice(label.length).replace(/^[：:\s]+/, '').trim();
        if (value) result[label] = value;
      }
    });

    // “近30天作品 / 所有作品”可能是单选框、按钮或下拉当前值，优先取选中态。
    const scopePattern = /^(近\s*30\s*天(?:的)?作品|所有作品)$/;
    const scopeCandidates = Array.from(document.querySelectorAll('label,button,span,div')).filter(el =>
      el.children.length <= 3 && scopePattern.test(el.textContent.trim()));
    const isSelected = el => {
      const input = el.matches('input') ? el : el.querySelector('input');
      if (input && input.checked) return true;
      let node = el;
      for (let i = 0; node && i < 4; i++, node = node.parentElement) {
        if (node.getAttribute && (node.getAttribute('aria-checked') === 'true' || node.getAttribute('aria-selected') === 'true')) return true;
        if (/checked|selected|active/i.test(String(node.className || ''))) return true;
      }
      return false;
    };
    const selectedScope = scopeCandidates.find(isSelected);
    const uniqueScopes = [...new Set(scopeCandidates.map(el => el.textContent.trim()))];
    if (selectedScope) result['作品范围'] = selectedScope.textContent.trim();
    else if (uniqueScopes.length === 1) result['作品范围'] = uniqueScopes[0];

    Array.from(document.querySelectorAll('input')).forEach(input => {
      const placeholder = (input.placeholder || '').trim();
      const value = (input.value || '').trim();
      if (!value) return;
      if (placeholder.includes('内容ID')) result['内容ID'] = value;
      else if (placeholder.includes('逛逛ID')) result['逛逛ID'] = value;
    });
    // 页面上的“内容发布时间”实际表达作品集合范围，统一成用户口径“作品范围”。
    if (result['内容发布时间'] && !result['作品范围']) {
      const scope = String(result['内容发布时间']);
      result['作品范围'] = /近\s*30\s*天/.test(scope) ? '近30天作品'
        : (scope === '全部' ? '全部作品' : scope);
    }
    delete result['内容发布时间'];
    return result;
  }

  // 读当前页面筛选器状态，拼成"指纹"。筛选器一变，指纹就变。
  // 纳入：数据时间范围（把日/7日/30日/自定义/周/月都归一成实际日期区间）、
  //       内容类型/消费渠道/内容来源/内容发布时间 四个下拉、内容ID、逛逛ID 输入框。
  function computeFilterFingerprint() {
    return JSON.stringify({ mode: currentMode || '', filters: collectVisibleFilters() });
  }

  // 点按钮：打开面板。筛选器没变且缓存未过期 → 秒出；否则清屏显示加载态并重新抓。
  function openPanelAndFetch() {
    ensurePanel();
    const fp = computeFilterFingerprint();
    // 每次点击分析都重新捕获页面筛选并请求接口，避免旧缓存让筛选结果看起来不变。
    releaseFetchLock('', false);
    pendingFingerprint = fp;
    showingCachedData = false;
    renderLoadingPanel();
    triggerFetchBoth();
  }

  // 一次抓取作品 + 商品两套数据
  function triggerFetchBoth() {
    const requestId = beginFetchLock();
    if (!requestId) return;
    window.postMessage({
      type: 'GH_FETCH_BOTH_REQUEST',
      requestId: requestId,
      pageCount: 3,
      triggerMode: currentMode,
      visibleFilters: collectVisibleFilters(),
    }, '*');
  }

  // 加载态：把"正在获取数据"直接渲染在面板表格区（替代右下角小弹窗）
  function renderLoadingPanel(msg) {
    ensurePanel();
    const container = panelRoot.shadowRoot.querySelector('.panel-container');
    container.innerHTML = buildHeaderHTML()
      + '<div class="panel-body"><div class="panel-loading">'
      + '<div class="gh-spinner"></div>'
      + '<div class="panel-loading-text">' + escapeHtml(msg || '正在获取数据…') + '</div>'
      + '<div class="panel-loading-sub">首次或筛选变化后需要重新拉取，请稍候</div>'
      + '</div></div>';
    bindPanelEvents(container);
  }

  // 加载更多：只补当前视角的后续页
  function triggerFetchMore(view) {
    const requestId = beginFetchLock();
    if (!requestId) return;
    const vs = views[view];
    window.postMessage({
      type: 'GH_FETCH_MORE_REQUEST',
      requestId: requestId,
      view: view,
      pageFrom: vs.nextPage || 1,
      pageCount: 3,
    }, '*');
    renderPanel();  // 刷新使"加载更多"按钮进入禁用态
  }

  async function autoTriggerDownload() {
    showProgress(1, 4, '准备中...');

    // 商品分析模式：先点击"内容消费"tab 切换到商品维度
    if (currentMode === 'product') {
      showProgress(1, 4, '切换到内容消费...');
      const contentConsumeTab = findByText('span', '内容消费') || findByText('div', '内容消费');
      if (contentConsumeTab) {
        contentConsumeTab.click();
        await sleep(800);
      }
    }

    // Step 1: 如果指标面板是收起状态，先展开
    // 尝试多个选择器查找展开按钮（按优先级依次尝试）
    let expandBtn = document.querySelector('.spreadBtn--lxl3fFWE')  // 当前版本类名
                 || document.querySelector('.spreadBtn--BH3DwCER'); // 旧版本类名兼容
    if (!expandBtn) {
      // 通过 data-spm-anchor-id 属性查找（更稳定）
      expandBtn = document.querySelector('[data-spm-anchor-id*="spreadNormal"]')
               || document.querySelector('[class*="spreadBtn"]');
    }
    if (!expandBtn) {
      // 最后回退：查找文字为"展开更多指标"或"展开"的按钮/div，但排除含子元素过多的容器
      const candidates = document.querySelectorAll('div[class*="spread"], button[class*="spread"]');
      for (const el of candidates) {
        if (el.children.length < 5) { expandBtn = el; break; }
      }
    }
    if (!expandBtn) {
      showProgress(1, 4, '❌ 未找到展开按钮，请手动展开');
      setTimeout(hideProgress, 4000);
      return;
    }
    const isExpanded = expandBtn.textContent.includes('收起');
    if (!isExpanded) {
      showProgress(1, 4, '点击展开...');
      expandBtn.click();
      await sleep(800);
    }
    showProgress(1, 4, '✓ 已展开');

    // Step 2: 全选指标（检查 aria-checked 避免重复点击取消全选）
    showProgress(2, 4, '查找全选按钮...');
    const selectAllEl = Array.from(document.querySelectorAll('span.next-checkbox-label'))
      .find(el => el.textContent.trim() === '全选/全不选');
    if (!selectAllEl) {
      showProgress(2, 4, '❌ 未找到全选按钮，请手动全选');
      setTimeout(hideProgress, 4000);
      return;
    }
    const checkboxInput = selectAllEl.parentElement.querySelector('input.next-checkbox-input');
    const isAllChecked = checkboxInput && checkboxInput.getAttribute('aria-checked') === 'true';
    if (!isAllChecked) {
      selectAllEl.click();
      await sleep(600);
    }
    showProgress(2, 4, '✓ 已全选');

    // Step 3: 点击下载按钮
    showProgress(3, 4, '点击下载...');
    const downloadBtn = document.querySelector('.gg-btn-export') || document.querySelector('.export--jX4Um15Q');
    if (!downloadBtn) {
      showProgress(3, 4, '❌ 未找到下载按钮，请手动点击导出');
      setTimeout(hideProgress, 5000);
      return;
    }
    downloadBtn.click();
    showProgress(3, 4, '✓ 已点击下载');

    // Step 4: 等待 Excel 被拦截后自动解析
    showProgress(4, 4, '等待文件下载...');
    const startTime = Date.now();
    let waited = 0;
    const check = setInterval(() => {
      waited += 500;
      if (lastParsedAt && lastParsedAt >= startTime) {
        clearInterval(check);
        showProgress(4, 4, '✓ 数据已获取，面板已弹出');
        setTimeout(hideProgress, 2000);
      } else if (waited >= 120000) {
        clearInterval(check);
        showProgress(4, 4, '⚠️ 超时，请检查文件是否已下载');
        setTimeout(hideProgress, 4000);
      }
    }, 500);
  }

  function readTableFromDOM() {
    const cells = document.querySelectorAll('.next-table-cell-wrapper[data-next-table-row]');
    if (!cells.length) return null;

    // 读表头，确定列顺序
    const headerEls = document.querySelectorAll('.next-table-header .next-table-cell-wrapper');
    const headers = Array.from(headerEls).map(el => el.textContent.trim());

    // 按行分组（每个值出现两次，去重）
    const rowMap = {};
    cells.forEach(el => {
      const row = el.getAttribute('data-next-table-row');
      if (!rowMap[row]) rowMap[row] = [];
      rowMap[row].push(el.textContent.trim());
    });

    // 去掉每行的重复值（表格固定列+滚动列各渲染一次）
    const results = [];
    Object.keys(rowMap).sort((a, b) => Number(a) - Number(b)).forEach(rowIdx => {
      const raw = rowMap[rowIdx];
      // 表格固定列+滚动列都渲染时会重复；部分店铺只渲染一套列，不能盲目取半。
      const cols = raw.length >= headers.length * 2
        ? raw.slice(0, Math.ceil(raw.length / 2))
        : raw.slice(0, headers.length || raw.length);

      // 解析内容信息列（含内容ID、时间、商品ID）
      const infoText = cols[0] || '';
      const idMatch = infoText.match(/内容ID[：:]\s*(\d+)/);
      const timeMatch = infoText.match(/(\d{4}-\d{2}-\d{2})/);
      const productMatch = infoText.match(/商品ID[：:]\s*([\d,，]+)/);
      const titleText = infoText
        .replace(/^\d{1,2}:\d{2}/, '')
        .replace(/内容ID[：:][\s\S]*$/, '')
        .trim();

      // 建立列名→值的映射
      const colMap = {};
      headers.forEach((h, i) => { colMap[h] = cols[i] || ''; });

      function parseNum(...keys) {
        for (const key of keys) {
          const source = colMap[key];
          if (!source) continue;
          const matched = String(source).replace(/[,，]/g, '').match(/-?\d+(?:\.\d+)?/);
          if (matched) return parseFloat(matched[0]) || 0;
        }
        return 0;
      }

      const 曝光次数 = parseNum('曝光次数');
      const 点击次数 = parseNum('点击次数');
      const 查看次数 = parseNum('查看次数');
      const 有效查看次数 = parseNum('有效查看次数');
      const 次均停留时长 = parseNum('次均停留时长(秒)', '次均停留时长（秒）') || null;
      const 商品引导点击次数 = parseNum('商品引导点击次数', '商品引导点击人数');
      const 商品点击次数 = parseNum('商品点击次数', '商品点击人数');
      const 种草成交订单数 = parseNum('种草成交订单数', '种草成交人数');
      const 种草成交金额 = parseNum('种草成交金额');

      const row = {
        name: (titleText || infoText.split('\n')[0].trim()).substring(0, 50),
        id: idMatch ? idMatch[1] : '',
        time: timeMatch ? timeMatch[1] : '',
        productId: productMatch ? productMatch[1].replace(/，/g, ',') : '',
        metrics: {
          raw_曝光次数: 曝光次数,
          raw_查看次数: 查看次数,
          raw_大点击: 商品引导点击次数 || null,
          raw_小点击: 商品点击次数 || null,
          raw_种草成交金额: 种草成交金额,
          曝光点击率: 曝光次数 > 0 ? 点击次数 / 曝光次数 : null,
          有效查看率: 查看次数 > 0 ? 有效查看次数 / 查看次数 : null,
          次均停留时长: 次均停留时长 || null,
          大点击率: 查看次数 > 0 ? 商品引导点击次数 / 查看次数 : null,
          小点击率: 查看次数 > 0 ? 商品点击次数 / 查看次数 : null,
          有效查看转化率: 有效查看次数 > 0 ? 种草成交订单数 / 有效查看次数 : null,
          千次查看成交金额: 查看次数 > 0 ? 种草成交金额 / 查看次数 * 1000 : null,
          千次有效查看金额: 有效查看次数 > 0 ? 种草成交金额 / 有效查看次数 * 1000 : null,
        }
      };
      if (Object.values(row.metrics).some(v => v !== null && v !== 0)) {
        results.push(row);
      }
    });
    return results;
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getPanelCSS() {
    return ':host{--gh-orange:#ff6600;--gh-orange-soft:#fff3ea;--gh-border:#e8edf3;--gh-border-strong:#d8e0ea;--gh-text:#1f2937;--gh-muted:#64748b;--gh-soft:#f8fafc;--gh-head:#f3f6fa;--gh-green:#16a34a;--gh-red:#e5484d;--gh-rowhead-w:54px;--gh-name-w:212px;--gh-product-w:146px;--gh-content-w:122px;--gh-time-w:98px}'
    +'.panel-overlay{position:fixed;inset:0;background:rgba(15,23,42,.52);z-index:99998;backdrop-filter:blur(3px)}'
    +'.panel-container{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:92vw;max-width:1240px;height:85vh;background:#fff;border:1px solid rgba(226,232,240,.95);border-radius:10px;box-shadow:0 34px 84px rgba(15,23,42,.28),0 1px 0 rgba(255,255,255,.9) inset;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:12px;color:var(--gh-text);display:flex;flex-direction:column;overflow:hidden}'
    +'.panel-container:before{content:"";display:block;height:4px;background:linear-gradient(90deg,#ff7a1a 0%,#ff6600 36%,#22c55e 100%);flex-shrink:0}'
    +'.panel-header{display:flex;align-items:center;gap:12px;padding:14px 18px;background:linear-gradient(180deg,#fffaf6 0%,#ffffff 72%);border-bottom:1px solid var(--gh-border);flex-shrink:0}'
    +'.panel-title{position:relative;font-weight:800;font-size:16px;color:#111827;white-space:nowrap;flex-shrink:0;letter-spacing:0;padding-left:11px}'
    +'.panel-title:before{content:"";position:absolute;left:0;top:3px;width:4px;height:16px;border-radius:999px;background:var(--gh-orange);box-shadow:0 0 0 3px rgba(255,102,0,.1)}'
    +'.panel-count{display:inline-block;min-width:4em;text-align:left;color:var(--gh-orange);font-variant-numeric:tabular-nums;font-weight:800}'
    +'.view-switch{display:inline-flex;flex-shrink:0;background:#f1f5f9;border:1px solid var(--gh-border-strong);border-radius:8px;padding:3px;gap:2px}'
    +'.view-tab{height:28px;padding:0 14px;border:none;background:transparent;color:#64748b;font-size:13px;font-weight:700;cursor:pointer;border-radius:6px;white-space:nowrap;transition:background .15s,color .15s,box-shadow .15s}'
    +'.view-tab:hover{color:#334155}'
    +'.view-tab.active{background:linear-gradient(180deg,#ff7a1a 0%,#ff6600 100%);color:#fff;box-shadow:0 3px 8px rgba(255,102,0,.28)}'
    +'.view-tab[data-view="product"].active{background:linear-gradient(180deg,#3b82f6 0%,#2563eb 100%);box-shadow:0 3px 8px rgba(37,99,235,.25)}'
    +'.panel-count-tag{flex-shrink:0;font-size:12px;color:var(--gh-orange);font-weight:800;font-variant-numeric:tabular-nums;padding:0 4px}'
    +'.panel-version{flex-shrink:0;font-size:11px;color:#94a3b8;font-weight:600;padding:2px 7px;background:#f1f5f9;border-radius:5px;letter-spacing:.3px}'
    +'.panel-controls{display:flex;align-items:center;gap:8px;flex:1;min-width:0}'
    +'.panel-filter-input,.panel-name-filter-input,.panel-id-filter-input{box-sizing:border-box;height:30px;padding:0 10px;border:1px solid var(--gh-border-strong);border-radius:6px;background:#fff;color:var(--gh-text);font-size:12px;width:150px;box-shadow:0 1px 1px rgba(15,23,42,.03);transition:border-color .15s,box-shadow .15s,background .15s}'
    +'.panel-filter-input::placeholder,.panel-name-filter-input::placeholder,.panel-id-filter-input::placeholder{color:#9aa6b2}'
    +'.panel-filter-input:focus,.panel-name-filter-input:focus,.panel-id-filter-input:focus{outline:none;border-color:var(--gh-orange);box-shadow:0 0 0 3px rgba(255,102,0,.12);background:#fff}'
    +'.panel-close{width:30px;height:30px;padding:0;border:1px solid var(--gh-border);border-radius:6px;background:#fff;cursor:pointer;font-size:18px;line-height:26px;color:#94a3b8;flex-shrink:0;transition:background .15s,color .15s,border-color .15s}'
    +'.panel-close:hover{background:#f8fafc;color:#334155;border-color:#cbd5e1}'
    +'.panel-search-btn{height:30px;padding:0 14px;border:1px solid #ff6600;border-radius:6px;background:#ff6600;color:#fff;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;box-shadow:0 2px 6px rgba(255,102,0,.2);transition:background .15s,box-shadow .15s}'
    +'.panel-search-btn:hover{background:#e95700;box-shadow:0 3px 9px rgba(255,102,0,.3)}'
    +'.panel-clear-btn{height:30px;padding:0 10px;border:1px solid #d8e0ea;border-radius:6px;background:#fff;color:#64748b;font-size:12px;cursor:pointer;white-space:nowrap}'
    +'.panel-clear-btn:hover:not(:disabled){border-color:#ff9b5c;color:#ff6600;background:#fff8f3}'
    +'.panel-clear-btn:disabled{opacity:.42;cursor:not-allowed}'
    +'.data-context{flex-shrink:0;background:#fff;border-bottom:1px solid var(--gh-border);font-size:12px}'
    +'.data-context summary{display:flex;align-items:center;gap:7px;width:max-content;margin:7px 18px;padding:5px 9px;border:1px solid #dce4ed;border-radius:6px;background:#f8fafc;color:#475569;font-weight:700;cursor:pointer;user-select:none;list-style:none}'
    +'.data-context summary::-webkit-details-marker{display:none}'
    +'.data-context summary:after{content:"▾";font-size:10px;color:#94a3b8;transition:transform .15s}'
    +'.data-context[open] summary:after{transform:rotate(180deg)}'
    +'.data-context summary em{font-style:normal;font-weight:600;color:#16a34a;background:#edf9f0;border-radius:4px;padding:1px 5px}'
    +'.context-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.12)}'
    +'.context-content{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 18px 12px;background:#fbfcfe;border-top:1px solid #edf2f7;color:#475569}'
    +'.context-card{min-width:0;padding:10px 11px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.03)}'
    +'.context-card.content{border-left:4px solid #ff6600;background:linear-gradient(90deg,#fff8f3 0,#fff 18%)}'
    +'.context-card.product{border-left:4px solid #2563eb;background:linear-gradient(90deg,#f4f8ff 0,#fff 18%)}'
    +'.context-card-title{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-weight:800;color:#334155}'
    +'.context-card-title span{display:inline-flex;align-items:center;height:24px;padding:0 8px;border-radius:5px;color:#fff;font-size:11px}'
    +'.context-card.content .context-card-title span{background:#ff6600}'
    +'.context-card.product .context-card-title span{background:#2563eb}'
    +'.context-chip{display:inline-flex;align-items:center;box-sizing:border-box;height:28px;padding:0 8px;border:1px solid #dce4ed;border-radius:6px;background:#fff;color:#64748b;white-space:nowrap}'
    +'.context-chip b{color:#334155;margin-right:3px}'
    +'.context-chip.muted{border-style:dashed;background:#f8fafc;color:#94a3b8}'
    +'.context-method-chips{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}'
    +'.goal-filter-group{display:flex;flex-wrap:wrap;gap:8px 10px;padding:10px 18px;background:linear-gradient(180deg,#f8fafc 0%,#f3f6fa 100%);border-bottom:1px solid var(--gh-border);font-size:11px;flex-shrink:0;align-items:center}'
    +'.goal-item{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 5px 0 9px;background:#fff;border:1px solid #dde5ee;border-radius:7px;color:#334155;white-space:nowrap;box-shadow:0 1px 3px rgba(15,23,42,.05)}'
    +'.goal-name{font-weight:700}'
    +'.goal-options{display:inline-flex;align-items:center;padding:2px;background:#f1f5f9;border-radius:5px}'
    +'.goal-option{height:22px;padding:0 7px;border:0;border-radius:4px;background:transparent;color:#7b8794;font-size:10px;cursor:pointer}'
    +'.goal-option.active{background:#fff;color:#334155;font-weight:700;box-shadow:0 1px 3px rgba(15,23,42,.13)}'
    +'.goal-option.met-option.active{color:#168a3a;background:#edf9f0}'
    +'.goal-option.unmet-option.active{color:#d6373c;background:#fff0f0}'
    +'.panel-body{overflow:auto;flex:1;background:#fff;scrollbar-color:#cbd5e1 transparent;scrollbar-width:thin}'
    +'.panel-body::-webkit-scrollbar{width:10px;height:10px}'
    +'.panel-body::-webkit-scrollbar-thumb{background:#cbd5e1;border:3px solid #fff;border-radius:999px}'
    +'.panel-body::-webkit-scrollbar-track{background:#fff}'
    +'.panel-notice{margin:16px;padding:16px 18px;color:#475569;line-height:1.8;background:#fbfcfe;border:1px solid var(--gh-border);border-radius:8px}'
    +'.panel-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:320px;gap:14px}'
    +'.gh-spinner{width:38px;height:38px;border:3px solid #ffe0c7;border-top-color:var(--gh-orange);border-radius:50%;animation:gh-spin .8s linear infinite}'
    +'@keyframes gh-spin{to{transform:rotate(360deg)}}'
    +'.panel-loading-text{font-size:15px;font-weight:700;color:#111827}'
    +'.panel-loading-sub{font-size:12px;color:#94a3b8}'
    +'table{width:100%;border-collapse:separate;border-spacing:0;white-space:nowrap}'
    +'th,td{padding:9px 10px;border-bottom:1px solid #edf2f7;text-align:center;box-sizing:border-box}'
    +'th{background:linear-gradient(180deg,#eef3f8 0%,#e8eef5 100%);font-weight:800;color:#263445;position:sticky;top:0;z-index:3;border-bottom:1px solid #d4dde8}'
    +'th small{display:block;margin-top:2px;color:#94a3b8;font-weight:500;font-size:10px;line-height:1.2}'
    +'td{color:#334155;font-variant-numeric:tabular-nums;background:#fff}'
    +'.col-sortable{cursor:pointer;user-select:none;transition:background .15s,color .15s}'
    +'.col-sortable:hover{background:#eaf0f7;color:#111827}'
    +'.sort-icon{display:inline-block;margin-left:4px;font-size:10px;color:#aab4c0;vertical-align:middle}'
    +'.sort-icon.active{color:var(--gh-orange);font-weight:700}'
    +'.expand-btn{width:22px;height:22px;padding:0;border:1px solid var(--gh-border-strong);border-radius:5px;background:#fff;color:var(--gh-orange);font-size:12px;line-height:1;cursor:pointer;transition:background .15s,border-color .15s}'
    +'.expand-btn:hover{background:var(--gh-orange-soft);border-color:var(--gh-orange)}'
    // 行号与展开按钮合并为一列，消除表格左侧的空白轨道。
    +'.col-rowhead{width:var(--gh-rowhead-w);min-width:var(--gh-rowhead-w);padding:0 5px;color:#94a3b8;position:sticky;left:0;z-index:2;text-align:center}'
    +'td.col-rowhead .expand-btn{margin-right:5px;vertical-align:middle}'
    +'th.col-rowhead{z-index:4;background:linear-gradient(180deg,#eef3f8 0%,#e8eef5 100%)}'
    +'.col-name{text-align:left;width:var(--gh-name-w);max-width:var(--gh-name-w);padding-left:8px;padding-right:8px;overflow:hidden;text-overflow:ellipsis;position:sticky;left:var(--gh-rowhead-w);z-index:2;font-weight:500}'
    +'th.col-name{z-index:4;background:linear-gradient(180deg,#eef3f8 0%,#e8eef5 100%)}'
    +'.col-product{text-align:left;width:var(--gh-product-w);max-width:var(--gh-product-w);padding-left:8px;padding-right:8px;overflow:hidden;text-overflow:ellipsis;position:sticky;left:calc(var(--gh-rowhead-w) + var(--gh-name-w));z-index:2}'
    +'th.col-product{z-index:4;background:linear-gradient(180deg,#eef3f8 0%,#e8eef5 100%)}'
    +'.col-content-id{text-align:left;width:var(--gh-content-w);max-width:var(--gh-content-w);padding-left:8px;padding-right:8px;overflow:hidden;text-overflow:ellipsis;position:sticky;left:calc(var(--gh-rowhead-w) + var(--gh-name-w) + var(--gh-product-w));z-index:2}'
    +'th.col-content-id{z-index:4;background:linear-gradient(180deg,#eef3f8 0%,#e8eef5 100%)}'
    +'.col-time{color:#64748b;font-size:11px;white-space:nowrap;width:var(--gh-time-w);min-width:var(--gh-time-w);padding-left:7px;padding-right:7px;position:sticky;left:calc(var(--gh-rowhead-w) + var(--gh-name-w) + var(--gh-product-w) + var(--gh-content-w));z-index:2;background:#fff}'
    +'th.col-time{z-index:4;color:#334155;font-size:12px;background:linear-gradient(180deg,#eef3f8 0%,#e8eef5 100%)}'
    +'.sticky-last{box-shadow:8px 0 14px -14px rgba(15,23,42,.38)}'
    +'.col-related{min-width:92px;text-align:center}'
    +'.related-count{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:24px;padding:0 7px;border-radius:999px;background:#eef4ff;color:#2563eb;font-weight:800}'
    +'.col-metric{min-width:92px}'
    // 行背景：普通行白、hover 橙、展开中主行浅橙、钻取子行浅灰。sticky 列 td 跟随所在行背景。
    +'.main-row>td{background:#fff}'
    +'.main-row:hover>td{background:#fff3e8}'
    +'.row-open>td{background:#fff7f0}'
    +'.drill-row>td{background:#fbfcfe;border-bottom:1px solid #eef2f7}'
    +'.drill-row:hover>td{background:#f4f7fb}'
    +'.view-content .drill-row .col-rowhead{border-left:3px solid #ffb37d}'
    +'.view-product .drill-row .col-rowhead{border-left:3px solid #8ab4ff}'
    +'.drill-row .col-name{padding-left:18px}'
    +'.drill-tag{color:#f0954e;font-weight:700}'
    +'.drill-name{font-weight:500}'
    // 实体标题采用固定语义色：视频橙、商品蓝；主行更重、关联行更轻。
    +'.entity-title{display:flex;align-items:center;gap:6px;min-width:0;max-width:100%}'
    +'.entity-title-link{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}'
    +'.main-title .entity-title-link{font-weight:750}'
    +'.drill-title .entity-title-link{font-weight:600}'
    +'.entity-type{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;height:18px;min-width:28px;padding:0 4px;border-radius:4px;font-size:9px;line-height:18px;font-weight:800;letter-spacing:.04em;box-sizing:border-box}'
    +'.content-type{color:#c2410c;background:#fff1e8;border:1px solid #ffd8bf}'
    +'.product-type{color:#1d4ed8;background:#eef4ff;border:1px solid #cddfff}'
    +'.content-title .entity-title-link{color:#d65313}'
    +'.product-title .entity-title-link{color:#2563eb}'
    +'.content-title .entity-title-link:hover{color:#b93808}'
    +'.product-title .entity-title-link:hover{color:#1d4ed8}'
    +'.drill-submeta{display:block;margin-top:3px;color:#94a3b8;font-size:10px;font-weight:500}'
    +'.drill-type{display:inline-flex;align-items:center;height:22px;padding:0 7px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:10px;font-weight:700}'
    +'.drill-missing{color:#e5484d;text-align:left;font-size:11px}'
    +'.drill-msg{padding:10px 14px;color:#94a3b8;font-size:12px;text-align:left}'
    +'.dash{color:#cbd5e1}'
    +'.met{color:var(--gh-green);font-weight:700}'
    +'.unmet{color:var(--gh-red);font-weight:700}'
    +'.col-content-id{font-size:11px;color:#64748b}'
    +'.copy-id{cursor:pointer;user-select:all}'
    +'.copy-id:hover{color:#ff6600;text-decoration:underline;text-underline-offset:2px}'
    +'.content-link,.product-link{color:var(--gh-orange);text-decoration:none;font-weight:600}'
    +'.content-link:hover,.product-link:hover{text-decoration:underline;text-underline-offset:2px}'
    +'.load-more-bar{display:flex;justify-content:center;padding:16px;border-top:1px solid var(--gh-border)}'
    +'.load-more-btn{height:34px;padding:0 24px;border-radius:7px;cursor:pointer;font-size:13px;font-weight:700;border:1px solid var(--gh-border-strong);background:#f8fafc;color:#334155;transition:all .15s}'
    +'.load-more-btn:hover:not(:disabled){background:#ff6600;color:#fff;border-color:#ff6600;box-shadow:0 4px 12px rgba(255,102,0,.2)}'
    +'.load-more-btn:disabled{opacity:.5;cursor:not-allowed}'
    +'.load-more-end{font-size:12px;color:#94a3b8;padding:16px;text-align:center;border-top:1px solid var(--gh-border)}'
    +'.view-product th{background:linear-gradient(180deg,#eff5ff 0%,#e7f0ff 100%)}'
    +'.view-product th.col-rowhead,.view-product th.col-name,.view-product th.col-product{background:linear-gradient(180deg,#eff5ff 0%,#e7f0ff 100%)}'
    +'.view-product .expand-btn{color:#2563eb}'
    +'.view-product .expand-btn:hover{background:#eef4ff;border-color:#2563eb}'
    +'.view-product .main-row:hover>td{background:#f3f7ff}'
    +'.view-product .row-open>td{background:#eef4ff}'
    +'.view-product .drill-tag{color:#5b8def}'
    +'@media (max-width:900px){.panel-container{width:96vw;height:88vh}.panel-header{align-items:flex-start;flex-wrap:wrap}.panel-controls{order:3;flex-basis:100%;flex-wrap:wrap}.panel-filter-input,.panel-name-filter-input{width:180px}.context-content{grid-template-columns:1fr}.goal-filter-group{max-height:132px;overflow:auto}.col-metric{min-width:86px}}';
  }

  console.log(TAG, 'content-script 已加载');
})();

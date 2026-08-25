// wxt-report-content.js - One-click Wanxiangtai report workbook export.
(function () {
  'use strict';

  if (location.hostname !== 'one.alimama.com' && location.hostname !== 'one.alimama.hk') return;
  if (window.__wxtReportContentV2283) return;
  window.__wxtReportContentV2283 = true;

  const BUTTON_ID = 'wxt-report-export-button';
  const DIALOG_ID = 'wxt-report-export-dialog';
  const REQUEST_TYPE = 'WXT_REPORT_EXPORT_REQUEST';
  const RESPONSE_TYPE = 'WXT_REPORT_EXPORT_RESPONSE';
  const PROGRESS_TYPE = 'WXT_REPORT_EXPORT_PROGRESS';
  const BUSINESS_DEFENSE_WXT_KEY = 'wxtBusinessDefenseReportV1';
  const CONTENT_DIAGNOSIS_WXT_KEY = 'taobaoContentDiagnosisWxtReportV1';
  const PERCENT_COLUMNS = new Set(['E', 'G', 'H', 'J', 'K', 'M', 'N']);
  const COUNT_COLUMNS = new Set(['C', 'D', 'F', 'I']);
  const REPORT_COLORS = [
    '#315efb',
    '#ff7a00',
    '#16a085',
    '#e5484d',
    '#8b5cf6',
    '#0ea5e9',
    '#f2b705',
    '#667085',
  ];
  let exporting = false;

  function isMarketingAccountPage() {
    return /#!\/report\/account(?:\?|$)/.test(location.hash) &&
      /(?:^|[?&])rptType=account(?:&|$)/.test(location.hash);
  }

  function isShortVideoDetailPage() {
    return /#!\/report\/short_video_migrate(?:\?|$)/.test(location.hash) &&
      (
        /(?:^|[?&])rptType=short_video_migrate(?:&|$)/.test(location.hash) ||
        /(?:^|[?&])bizCode=onebpShortVideo(?:&|$)/.test(location.hash)
      );
  }

  function ensureStyles() {
    if (document.getElementById('wxt-report-export-styles')) return;
    const style = document.createElement('style');
    style.id = 'wxt-report-export-styles';
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        z-index: 2147483000;
        top: 50%;
        right: 18px;
        transform: translateY(-50%);
        min-width: 142px;
        height: 40px;
        padding: 0 16px;
        border: 0;
        border-radius: 6px;
        background: #315efb;
        color: #fff;
        box-shadow: 0 5px 16px rgba(49, 94, 251, .28);
        font: 600 14px/40px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        cursor: pointer;
      }
      #${BUTTON_ID}:hover { background: #234ee7; }
      #${BUTTON_ID}:disabled { cursor: wait; opacity: .72; }
      #${DIALOG_ID} {
        position: fixed;
        z-index: 2147483001;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(17, 24, 39, .36);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "PingFang SC", sans-serif;
        box-sizing: border-box;
      }
      #${DIALOG_ID} .wxt-export-panel {
        width: min(560px, calc(100vw - 48px));
        background: #fff;
        border: 1px solid #d9dee8;
        border-radius: 8px;
        box-shadow: 0 16px 50px rgba(15, 23, 42, .2);
        box-sizing: border-box;
        overflow: hidden;
      }
      #${DIALOG_ID} .wxt-export-panel.is-report {
        width: min(1480px, calc(100vw - 48px));
        height: min(920px, calc(100vh - 48px));
        display: flex;
        flex-direction: column;
      }
      #${DIALOG_ID} .wxt-export-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 54px;
        padding: 0 20px;
        border-bottom: 1px solid #edf0f5;
        color: #20242c;
        font-size: 18px;
        font-weight: 650;
      }
      #${DIALOG_ID} .wxt-export-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #${DIALOG_ID} .wxt-export-action {
        height: 34px;
        padding: 0 12px;
        border: 1px solid #d9dee8;
        border-radius: 5px;
        background: #fff;
        color: #344054;
        font-size: 13px;
        font-weight: 650;
        letter-spacing: 0;
        cursor: pointer;
      }
      #${DIALOG_ID} .wxt-export-action.primary {
        border-color: #315efb;
        background: #315efb;
        color: #fff;
      }
      #${DIALOG_ID} .wxt-export-action:hover { border-color: #315efb; }
      #${DIALOG_ID} .wxt-export-close {
        width: 32px;
        height: 32px;
        border: 0;
        background: transparent;
        color: #667085;
        font-size: 25px;
        line-height: 30px;
        cursor: pointer;
      }
      #${DIALOG_ID} .wxt-export-body {
        min-height: 76px;
        padding: 20px;
        color: #344054;
        font-size: 15px;
        line-height: 1.65;
      }
      #${DIALOG_ID} .wxt-export-report-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        background: #f4f6f9;
      }
      #${DIALOG_ID} .wxt-export-error {
        border-left: 4px solid #f79009;
        padding: 10px 14px;
        background: #fffaeb;
        color: #854a0e;
      }
      @media (max-width: 760px) {
        #${DIALOG_ID} { padding: 10px; }
        #${DIALOG_ID} .wxt-export-panel.is-report {
          width: calc(100vw - 20px);
          height: calc(100vh - 20px);
        }
        #${DIALOG_ID} .wxt-export-title {
          height: auto;
          min-height: 54px;
          padding: 10px 12px;
          align-items: flex-start;
        }
        #${DIALOG_ID} .wxt-export-actions {
          flex-wrap: wrap;
          justify-content: flex-end;
        }
      }
    ` + reportStyles();
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureButton() {
    ensureStyles();
    let button = document.getElementById(BUTTON_ID);
    const isMarketing = isMarketingAccountPage();
    const isShortVideo = isShortVideoDetailPage();
    if (!isMarketing && !isShortVideo) {
      if (button) button.remove();
      return;
    }
    if (button) {
      button.dataset.pluginVersion = chrome.runtime.getManifest().version;
      button.textContent = isShortVideo ? '生成诊断报告' : '导出万相台报告';
      button.title = isShortVideo
        ? '生成短视频计划、视频主体和商品付费诊断报告'
        : '导出最近30个完整自然日的万相台数据报告';
      return;
    }
    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.dataset.pluginVersion = chrome.runtime.getManifest().version;
    button.type = 'button';
    button.textContent = isShortVideo ? '生成诊断报告' : '导出万相台报告';
    button.title = isShortVideo
      ? '生成短视频计划、视频主体和商品付费诊断报告'
      : '导出最近30个完整自然日的万相台数据报告';
    button.addEventListener('click', () => {
      if (isShortVideoDetailPage()) {
        exportShortVideoDetail();
      } else {
        exportReport();
      }
    });
    document.documentElement.appendChild(button);
  }

  function showDialog(message, isError) {
    ensureStyles();
    let dialog = document.getElementById(DIALOG_ID);
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = DIALOG_ID;
      dialog.innerHTML = `
        <div class="wxt-export-panel" role="dialog" aria-modal="true" aria-label="万相台报告导出">
          <div class="wxt-export-title">
            <span>万相台报告导出</span>
            <button class="wxt-export-close" type="button" title="关闭">×</button>
          </div>
          <div class="wxt-export-body"></div>
        </div>
      `;
      dialog.querySelector('.wxt-export-close').addEventListener('click', () => dialog.remove());
      document.documentElement.appendChild(dialog);
    }
    const panel = dialog.querySelector('.wxt-export-panel');
    panel.className = 'wxt-export-panel is-status';
    const body = dialog.querySelector('.wxt-export-body');
    body.textContent = String(message || '');
    body.className = 'wxt-export-body' + (isError ? ' wxt-export-error' : '');
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function lastThirtyFullDays() {
    const end = new Date();
    end.setHours(12, 0, 0, 0);
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    return {
      startTime: formatDate(start),
      endTime: formatDate(end),
    };
  }

  function currentShortVideoDateRange() {
    return lastThirtyFullDays();
  }

  function requestReportData(dateRange, reportKind, options) {
    const silent = Boolean(options && options.silent);
    const requestId = 'wxt-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 12);
    return new Promise((resolve, reject) => {
      const timeoutMs = reportKind === 'shortVideoDetail'
        ? 180000
        : (['businessDefense', 'marketingScene'].includes(reportKind) ? 180000 : 45000);
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('报表读取超时，请确认报表数据明细已加载完成后重试。'));
      }, timeoutMs);

      function onMessage(event) {
        if (event.source !== window || event.origin !== location.origin) return;
        const message = event.data;
        if (
          !message ||
          message.source !== 'wxt-report-page-hook' ||
          message.requestId !== requestId
        ) {
          return;
        }
        if (message.type === PROGRESS_TYPE) {
          if (!silent) showDialog(message.message || '正在读取万相台数据…', false);
          return;
        }
        if (message.type !== RESPONSE_TYPE) return;
        window.clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        if (message.ok) {
          resolve(message.data);
        } else {
          reject(new Error(message.message || '万相台报表读取失败。'));
        }
      }

      window.addEventListener('message', onMessage);
      window.postMessage({
        source: 'wxt-report-content',
        type: REQUEST_TYPE,
        requestId,
        reportKind,
        ...dateRange,
      }, location.origin);
    });
  }

  function requestAutomaticGuangheSync(targetVideoGroups) {
    return new Promise((resolve, reject) => {
      // Includes waiting for an existing Guanghe workflow, permission recovery and page collection.
      const timeout = window.setTimeout(() => {
        reject(new Error('光合作品自动同步超时，请检查已复用的光合页面。'));
      }, 16 * 60 * 1000);
      try {
        chrome.runtime.sendMessage({
          type: 'WXT_SYNC_GUANGHE_CONTENT',
          targetVideoGroups,
        }, (response) => {
          window.clearTimeout(timeout);
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message || '无法连接插件后台。'));
            return;
          }
          if (!response || !response.ok) {
            const syncError = new Error(response && response.message
              ? response.message
              : '光合作品自动同步失败。');
            if (response && response.code) syncError.code = response.code;
            reject(syncError);
            return;
          }
          resolve(response);
        });
      } catch (error) {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  }

  async function saveBusinessDefenseWxtSnapshot(data, reportKind) {
    try {
      await chrome.storage.local.set({
        [BUSINESS_DEFENSE_WXT_KEY]: {
          savedAt: Date.now(),
          reportKind: reportKind || 'marketingScene',
          url: location.href,
          data,
        },
      });
    } catch (error) {
      console.warn('[万相台报告]', '经营攻防快照保存失败:', error);
      throw new Error('万相台数据表快照保存失败。');
    }
  }

  function normalizeMappingTitle(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，。！？、,.!?;；:："'“”‘’（）()\[\]【】《》<>·|/\\_-]+/g, '');
  }

  function targetIdentityEntries(row) {
    const entries = [];
    const seen = new Set();
    const append = (field, value) => {
      const id = normalizeLinkedId(value);
      if (!id || !/^[a-z0-9_-]{3,100}$/i.test(id)) return;
      const signature = String(field || '') + '\u0000' + id;
      if (seen.has(signature)) return;
      seen.add(signature);
      entries.push({ field: String(field || 'unknown'), value: id });
    };
    const rawEntries = Array.isArray(row && row.__identityEntries)
      ? row.__identityEntries
      : [];
    rawEntries.forEach((entry) => append(entry && entry.field, entry && entry.value));
    [
      'subjectId',
      'entityId',
      'videoId',
      'contentId',
      'feedId',
      'resourceId',
      'materialId',
      'creativeId',
      'promotionId',
    ].forEach((key) => append(key, row && row[key]));
    return entries;
  }

  function targetTitleEntries(row) {
    const entries = [];
    const seen = new Set();
    const append = (field, value) => {
      if (value && typeof value === 'object') return;
      const title = String(value == null ? '' : value).trim();
      const normalized = normalizeMappingTitle(title);
      if (!title || normalized.length < 4 || /^\d+$/.test(normalized)) return;
      const signature = String(field || '') + '\u0000' + normalized;
      if (seen.has(signature)) return;
      seen.add(signature);
      entries.push({ field: String(field || 'unknown'), value: title, normalized });
    };
    const rawEntries = Array.isArray(row && row.__titleEntries)
      ? row.__titleEntries
      : [];
    rawEntries.forEach((entry) => append(entry && entry.field, entry && entry.value));
    [
      'videoInfo',
      'videoName',
      'videoTitle',
      'materialName',
      'creativeName',
      'contentName',
      'feedName',
      'resourceName',
      'subjectName',
      'entityName',
      'promotionName',
      'promotionTitle',
    ].forEach((key) => append(key, row && row[key]));
    return entries;
  }

  function targetGroupKey(identityEntries, titleEntries) {
    const ids = Array.from(new Set((identityEntries || [])
      .map((entry) => entry.value)
      .filter(Boolean)))
      .sort();
    if (ids.length) return ids.join('|');
    const titles = Array.from(new Set((titleEntries || [])
      .map((entry) => entry.normalized)
      .filter(Boolean)))
      .sort();
    return titles.length ? 'title:' + titles.join('|') : '';
  }

  function collectGuangheTargetGroups(data) {
    const targetGroups = new Map();
    ['click', 'display'].forEach((attribution) => {
      const block = data && data.video && data.video[attribution];
      const rows = block && Array.isArray(block.rows) ? block.rows : [];
      rows.forEach((row) => {
        const identityEntries = targetIdentityEntries(row);
        const titleEntries = targetTitleEntries(row);
        const ids = Array.from(new Set(identityEntries.map((entry) => entry.value)));
        const key = targetGroupKey(identityEntries, titleEntries);
        if (!key) return;
        const spend = numberOrNull(row && row.charge) || 0;
        const current = targetGroups.get(key);
        if (!current) {
          targetGroups.set(key, {
            groupKey: key,
            ids,
            identityEntries,
            titles: titleEntries,
            rawSample: row && row.__rawSample && typeof row.__rawSample === 'object'
              ? row.__rawSample
              : null,
            spend,
          });
        } else {
          current.spend = Math.max(current.spend, spend);
          const identitySeen = new Set(current.identityEntries.map((entry) => entry.field + '\u0000' + entry.value));
          identityEntries.forEach((entry) => {
            const signature = entry.field + '\u0000' + entry.value;
            if (!identitySeen.has(signature)) {
              identitySeen.add(signature);
              current.identityEntries.push(entry);
            }
          });
          const titleSeen = new Set(current.titles.map((entry) => entry.field + '\u0000' + entry.normalized));
          titleEntries.forEach((entry) => {
            const signature = entry.field + '\u0000' + entry.normalized;
            if (!titleSeen.has(signature)) {
              titleSeen.add(signature);
              current.titles.push(entry);
            }
          });
          if (!current.rawSample && row && row.__rawSample && typeof row.__rawSample === 'object') {
            current.rawSample = row.__rawSample;
          }
        }
      });
    });
    return Array.from(targetGroups.values())
      .sort((left, right) => right.spend - left.spend)
      .slice(0, 5000);
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function ratio(numerator, denominator) {
    const top = numberOrNull(numerator);
    const bottom = numberOrNull(denominator);
    if (top === null || bottom === null || bottom === 0) return null;
    return top / bottom;
  }

  function normalizedRate(value) {
    const number = numberOrNull(value);
    if (number === null) return null;
    return Math.abs(number) > 1 ? number / 100 : number;
  }

  function firstRatio(primaryNumerator, primaryDenominator, fallback) {
    const calculated = ratio(primaryNumerator, primaryDenominator);
    return calculated === null ? normalizedRate(fallback) : calculated;
  }

  function detailRow(name, metrics) {
    const source = metrics || {};
    return [
      name,
      numberOrNull(source.charge),
      numberOrNull(source.adPv),
      numberOrNull(source.click),
      ratio(source.click, source.adPv),
      numberOrNull(source.cartInshopNum),
      firstRatio(source.cartInshopNum, source.click, source.cartRate),
      ratio(source.cartDirNum, source.cartInshopNum),
      numberOrNull(source.alipayInshopNum),
      firstRatio(source.alipayInshopNum, source.click, source.cvr),
      ratio(source.alipayDirNum, source.cartInshopNum),
      numberOrNull(source.roi),
      firstRatio(source.inshopPotentialUv, source.inshopUv, source.inshopPotentialUvRate),
      firstRatio(source.newAlipayInshopUv, source.alipayInshopUv, source.newAlipayInshopUvRate),
    ];
  }

  function buildSpendSheet(data) {
    const spend = data.spendSummary || {};
    const total = numberOrNull(spend.totalCharge) || 0;
    const sitewide = numberOrNull(spend.onebpSiteCharge);
    const rows = [
      ['万相台花费占比'],
      ['数据范围：' + data.startTime + ' 至 ' + data.endTime + '（最近30个完整自然日）'],
      [],
      ['场景', '花费（元）', '占比'],
      ['账户总花费', total, total ? 1 : null],
      ['关键词推广', numberOrNull(spend.searchCharge), ratio(spend.searchCharge, total)],
      ['人群推广', numberOrNull(spend.displayCharge), ratio(spend.displayCharge, total)],
      ['内容场景', numberOrNull(spend.contentSceneCharge), ratio(spend.contentSceneCharge, total)],
      [
        '货品全站推广',
        sitewide === null ? numberOrNull(spend.siteSceneCharge) : sitewide,
        ratio(sitewide === null ? spend.siteSceneCharge : sitewide, total),
      ],
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    ];
    sheet['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 14 }];
    sheet['!rows'] = [{ hpt: 30 }, { hpt: 22 }, { hpt: 8 }, { hpt: 26 }];
    sheet['!autofilter'] = { ref: 'A4:C9' };
    return sheet;
  }

  function detailHeaders() {
    return [
      '营销场景',
      '花费',
      '展现量',
      '点击量',
      '点击率',
      '总购物车数',
      '加购率',
      '直接加购占比',
      '总成交笔数',
      '点击转化率',
      '直接成交占比',
      '投入产出比',
      '引导访问潜客占比',
      '成交新客占比',
    ];
  }

  function buildDetailRows(data) {
    const marketingRows = Array.isArray(data.marketingRows) ? data.marketingRows : [];
    const tableRows = [];
    let insertedShortVideo = false;
    marketingRows.forEach((row) => {
      const sceneName = String(row.scene1Name || '未命名场景').trim();
      tableRows.push(detailRow(sceneName, row));
      if (!insertedShortVideo && sceneName.includes('超级短视频')) {
        tableRows.push(detailRow('短视频展现数据', data.shortVideo));
        insertedShortVideo = true;
      }
    });
    if (!insertedShortVideo) {
      tableRows.unshift(detailRow('短视频展现数据', data.shortVideo));
    }
    return tableRows;
  }

  function buildDetailSheet(data) {
    const tableRows = buildDetailRows(data);
    const headers = detailHeaders();
    const rows = [
      ['万相台营销场景数据明细'],
      [
        '数据范围：' + data.startTime + ' 至 ' + data.endTime +
        '；营销场景：末次点击归因；短视频展现数据：展现效果口径；归因周期均为15天',
      ],
      [],
      headers,
      ...tableRows,
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
    ];
    sheet['!cols'] = [
      { wch: 22 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 16 },
      { wch: 12 },
      { wch: 16 },
      { wch: 16 },
      { wch: 15 },
      { wch: 17 },
      { wch: 15 },
      { wch: 20 },
      { wch: 16 },
    ];
    sheet['!rows'] = [{ hpt: 30 }, { hpt: 22 }, { hpt: 8 }, { hpt: 34 }];
    sheet['!autofilter'] = { ref: 'A4:N' + (rows.length || 4) };
    return {
      sheet,
      tableRows,
      totalRowNumber: null,
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatMoney(value) {
    const number = numberOrNull(value);
    if (number === null) return '-';
    return number.toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatInteger(value) {
    const number = numberOrNull(value);
    return number === null ? '-' : Math.round(number).toLocaleString('zh-CN');
  }

  function formatPercent(value) {
    const number = numberOrNull(value);
    return number === null
      ? '-'
      : (number * 100).toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + '%';
  }

  function formatDecimal(value) {
    const number = numberOrNull(value);
    return number === null
      ? '-'
      : number.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  }

  function spendChartEntries(data) {
    const spend = data.spendSummary || {};
    const total = numberOrNull(spend.totalCharge) || 0;
    const sitewide = numberOrNull(spend.onebpSiteCharge);
    const rows = [
      { name: '关键词推广', value: numberOrNull(spend.searchCharge) || 0 },
      { name: '人群推广', value: numberOrNull(spend.displayCharge) || 0 },
      { name: '内容场景', value: numberOrNull(spend.contentSceneCharge) || 0, featured: true },
      {
        name: '货品全站推广',
        value: (sitewide === null ? numberOrNull(spend.siteSceneCharge) : sitewide) || 0,
      },
    ];
    const known = rows.reduce((sum, row) => sum + row.value, 0);
    if (total - known > 0.01) rows.push({ name: '其他', value: total - known });
    return rows.filter((row) => row.value > 0);
  }

  function marketingChartEntries(data) {
    return (Array.isArray(data.marketingRows) ? data.marketingRows : [])
      .map((row) => {
        const name = String(row.scene1Name || '未命名场景').trim();
        return {
          name,
          value: numberOrNull(row.charge) || 0,
          featured: name.includes('超级短视频'),
        };
      })
      .filter((row) => row.value > 0)
      .sort((left, right) => right.value - left.value);
  }

  function pieGradient(entries) {
    const total = entries.reduce((sum, entry) => sum + entry.value, 0);
    if (!total) return '#e5e7eb';
    let cursor = 0;
    return 'conic-gradient(' + entries.map((entry, index) => {
      const start = cursor / total * 100;
      cursor += entry.value;
      const end = cursor / total * 100;
      return REPORT_COLORS[index % REPORT_COLORS.length] + ' ' +
        start.toFixed(4) + '% ' + end.toFixed(4) + '%';
    }).join(',') + ')';
  }

  function pieChartMarkup(title, subtitle, entries) {
    const total = entries.reduce((sum, entry) => sum + entry.value, 0);
    return '<section class="wxt-chart-section">' +
      '<div class="wxt-section-heading"><div><h2>' + escapeHtml(title) + '</h2>' +
      '<p>' + escapeHtml(subtitle) + '</p></div><strong>¥' + escapeHtml(formatMoney(total)) + '</strong></div>' +
      '<div class="wxt-pie-layout">' +
      '<div class="wxt-pie" role="img" aria-label="' + escapeHtml(title) + '" style="background:' +
        escapeHtml(pieGradient(entries)) + '"></div>' +
      '<div class="wxt-pie-legend">' + entries.map((entry, index) => {
        const share = total ? entry.value / total : null;
        return '<div class="wxt-legend-row' + (entry.featured ? ' is-featured' : '') + '">' +
          '<i style="background:' + REPORT_COLORS[index % REPORT_COLORS.length] + '"></i>' +
          '<span>' + escapeHtml(entry.name) + '</span>' +
          '<b>¥' + escapeHtml(formatMoney(entry.value)) + '</b>' +
          '<em>' + escapeHtml(formatPercent(share)) + '</em>' +
        '</div>';
      }).join('') + '</div></div></section>';
  }

  function metricValue(row, columnIndex) {
    const value = row[columnIndex];
    if (columnIndex === 1) return '¥' + formatMoney(value);
    if ([2, 3, 5, 8].includes(columnIndex)) return formatInteger(value);
    if ([4, 6, 7, 9, 10, 12, 13].includes(columnIndex)) return formatPercent(value);
    if (columnIndex === 11) return formatDecimal(value);
    return String(value == null ? '-' : value);
  }

  const SHORT_VIDEO_MONEY_FIELDS = new Set([
    'charge',
    'ecpc',
    'makeCharge',
    'alipayInshopCost',
    'cartCost',
    'alipayInshopAmt',
    'liveVideoNewCost',
    'displayNewCharge',
    'displayNewInshopAmt',
    'firstNewCustomerCost',
  ]);
  const SHORT_VIDEO_PERCENT_FIELDS = new Set([
    'ctr',
    'cartRate',
    'cvr',
    'inshopPotentialUvRate',
    'newAlipayInshopUvRate',
    'displayNewChargeRate',
  ]);
  const SHORT_VIDEO_DECIMAL_FIELDS = new Set(['roi', 'displayNewRoi']);
  const SHORT_VIDEO_COUNT_FIELDS = new Set([
    'adPv',
    'click',
    'feedViewNum',
    'cartInshopNum',
    'alipayInshopNum',
    'inshopPv',
    'inshopUv',
    'inshopPotentialUv',
    'alipayInshopUv',
    'newAlipayInshopUv',
    'liveVideoNewUv',
    'newInshopUv',
    'firstPurchaseUv',
  ]);

  function shortVideoDetailColumns(level, includeLevel) {
    const columns = [
      ...(includeLevel ? [{ key: 'levelName', label: '数据层级', type: 'text' }] : []),
      { key: 'attributionName', label: '归因口径', type: 'text' },
      { key: 'campaignId', label: '计划ID', type: 'text' },
      { key: 'campaignName', label: '计划名称', type: 'text' },
      { key: 'solutionName', label: '解决方案', type: 'text' },
      { key: 'optimizationTarget', label: '优化目标', type: 'text' },
      { key: 'bidMode', label: '出价方式', type: 'text' },
      ...(level === 'video' || includeLevel ? [
        { key: 'videoInfo', label: '视频信息', type: 'text' },
        { key: 'videoId', label: '视频ID', type: 'text' },
        { key: 'productIdText', label: '商品ID', type: 'text' },
        { key: 'guangheMatchName', label: '光合匹配', type: 'text' },
      ] : []),
      { key: 'charge', label: '花费', type: 'money' },
      { key: 'adPv', label: '展现量', type: 'count' },
      { key: 'click', label: '点击量', type: 'count' },
      { key: 'ctr', label: '点击率', type: 'percent' },
      { key: 'feedViewNum', label: '观看量', type: 'count' },
      { key: 'ecpc', label: '平均点击花费', type: 'money' },
      { key: 'makeCharge', label: '内容花费', type: 'money' },
      { key: 'cartInshopNum', label: '总购物车数', type: 'count' },
      { key: 'cartRate', label: '加购率', type: 'percent' },
      { key: 'cartCost', label: '加购成本', type: 'money' },
      { key: 'alipayInshopNum', label: '总成交笔数', type: 'count' },
      { key: 'alipayInshopAmt', label: '总成交金额', type: 'money' },
      { key: 'cvr', label: '点击转化率', type: 'percent' },
      { key: 'alipayInshopCost', label: '总成交成本', type: 'money' },
      { key: 'roi', label: '投入产出比', type: 'decimal' },
      { key: 'inshopPv', label: '引导访问量', type: 'count' },
      { key: 'inshopUv', label: '引导访问人数', type: 'count' },
      { key: 'inshopPotentialUv', label: '引导访问潜客数', type: 'count' },
      { key: 'inshopPotentialUvRate', label: '引导访问潜客占比', type: 'percent' },
      { key: 'newAlipayInshopUv', label: '成交新客人数', type: 'count' },
      { key: 'newAlipayInshopUvRate', label: '成交新客占比', type: 'percent' },
      { key: 'liveVideoNewUv', label: '新客触达数', type: 'count' },
      { key: 'liveVideoNewCost', label: '新客触达成本', type: 'money' },
      { key: 'newInshopUv', label: '进店新客人数', type: 'count' },
      { key: 'displayNewRoi', label: '新客投产比', type: 'decimal' },
      { key: 'displayNewCharge', label: '新客花费', type: 'money' },
      { key: 'displayNewChargeRate', label: '新客花费占比', type: 'percent' },
      { key: 'displayNewInshopAmt', label: '新客成交金额', type: 'money' },
      { key: 'firstPurchaseUv', label: '首购新客增量', type: 'count' },
      { key: 'firstNewCustomerCost', label: '首购新客成本', type: 'money' },
    ];
    return columns;
  }

  function deriveShortVideoMetrics(row) {
    const source = row || {};
    return {
      ...source,
      ecpm: numberOrNull(source.ecpm) === null
        ? ratio(numberOrNull(source.charge) * 1000, source.adPv)
        : numberOrNull(source.ecpm),
      cartRate: firstRatio(source.cartInshopNum, source.click, source.cartRate || source.itemColCartRate),
      directAlipayAmtRate: firstRatio(source.alipayDirAmt, source.alipayInshopAmt, source.directAlipayAmtRate),
    };
  }

  function shortVideoBlock(data, level, attributionKey) {
    if (data && data[level] && data[level][attributionKey]) return data[level][attributionKey];
    if (level === 'video' && data && data[attributionKey]) return data[attributionKey];
    return {};
  }

  function shortVideoDetailRows(data, level, attributionKey, attributionName) {
    const block = shortVideoBlock(data, level, attributionKey);
    return (Array.isArray(block.rows) ? block.rows : []).map((row) => ({
      levelName: level === 'plan' ? '计划维度' : '视频维度',
      attributionName,
      ...deriveShortVideoMetrics(row),
    }));
  }

  function allShortVideoDetailRows(data) {
    return [
      ...shortVideoDetailRows(data, 'plan', 'click', '点击效果归因'),
      ...shortVideoDetailRows(data, 'plan', 'display', '展现效果归因'),
      ...shortVideoDetailRows(data, 'video', 'click', '点击效果归因'),
      ...shortVideoDetailRows(data, 'video', 'display', '展现效果归因'),
    ];
  }

  function normalizeLinkedId(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return '';
    return /^\d+\.0+$/.test(text) ? text.replace(/\.0+$/, '') : text;
  }

  function splitLinkedIds(value) {
    const values = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[,，、\s]+/);
    return Array.from(new Set(values.map(normalizeLinkedId).filter(Boolean)));
  }

  function readGuangheStorage(syncResult) {
    return new Promise((resolve) => {
      try {
        const storageKey = String(syncResult && syncResult.storageKey || '');
        const keys = [
          'gh_wxt_results',
          'gh_wxt_snapshot_meta',
          'gh_wxt_data_context',
          'gh_product_results',
        ];
        if (/^gh_wxt_sync_v1:gh-sync-[a-z0-9-]{8,80}$/i.test(storageKey)) {
          keys.push(storageKey);
        }
        chrome.storage.local.get(
          keys,
          (stored) => {
            try { void chrome.runtime.lastError; } catch (error) {}
            const values = stored || {};
            const scoped = storageKey && values[storageKey];
            if (scoped && typeof scoped === 'object') {
              values.gh_wxt_results = Array.isArray(scoped.results) ? scoped.results : [];
              values.gh_wxt_snapshot_meta = scoped.snapshotMeta || {};
              values.gh_wxt_data_context = scoped.dataContext || {};
              try {
                const removal = chrome.storage.local.remove(storageKey);
                if (removal && typeof removal.catch === 'function') removal.catch(() => {});
              } catch (error) {}
            }
            resolve(values);
          }
        );
      } catch (error) {
        resolve({});
      }
    });
  }

  function guangheOrganicMetrics(record) {
    const metrics = record && record.metrics || {};
    const expoPv = numberOrNull(metrics.raw_曝光次数) || 0;
    const consumePv = numberOrNull(metrics.raw_查看次数) || 0;
    const bigClick = numberOrNull(metrics.raw_大点击) || 0;
    const smallClick = numberOrNull(metrics.raw_小点击) || 0;
    const seedAmount = numberOrNull(metrics.raw_种草成交金额) || 0;
    const baseValue = (rawValue, estimatedValue) => {
      const raw = numberOrNull(rawValue);
      if (raw !== null) return raw;
      return numberOrNull(estimatedValue) || 0;
    };
    const validViewRate = numberOrNull(metrics.有效查看率);
    const exposureCtr = numberOrNull(metrics.曝光点击率);
    const avgDwellSeconds = numberOrNull(metrics.次均停留时长);
    const validOrderRate = numberOrNull(metrics.有效查看转化率);
    const validConsumePv = baseValue(
      metrics.raw_有效查看次数,
      validViewRate === null ? null : consumePv * validViewRate
    );
    return finalizeOrganicMetrics({
      organicExpoPv: expoPv,
      organicConsumePv: consumePv,
      organicBigClick: bigClick,
      organicSmallClick: smallClick,
      organicSeedAmount: seedAmount,
      organicClickPv: baseValue(
        metrics.raw_点击次数,
        exposureCtr === null ? null : expoPv * exposureCtr
      ),
      organicValidConsumePv: validConsumePv,
      organicDwellTime: baseValue(
        metrics.raw_总停留时长,
        avgDwellSeconds === null ? null : consumePv * avgDwellSeconds
      ),
      organicSeedOrderCount: baseValue(
        metrics.raw_种草成交订单数,
        validOrderRate === null ? null : validConsumePv * validOrderRate
      ),
    });
  }

  async function enrichShortVideoWithGuanghe(data, syncResult) {
    const stored = await readGuangheStorage(syncResult);
    const context = stored.gh_wxt_data_context || {};
    const snapshot = stored.gh_wxt_snapshot_meta || {};
    const expectedRequestId = String(syncResult && syncResult.requestId || '');
    const contextRequestId = String(context.requestId || '');
    const isCurrentSync = Boolean(expectedRequestId && expectedRequestId === contextRequestId);
    const currentContext = isCurrentSync ? context : {};
    const currentSnapshot = isCurrentSync ? snapshot : {};
    const contentRows = isCurrentSync && Array.isArray(stored.gh_wxt_results)
      ? stored.gh_wxt_results
      : [];
    const productRows = Array.isArray(stored.gh_product_results) ? stored.gh_product_results : [];
    const productNameById = new Map();
    productRows.forEach((row) => {
      const id = normalizeLinkedId(row && (row.id || row.productId));
      const name = String(row && row.name || '').trim();
      if (id && name) productNameById.set(id, name);
    });

    const contentById = new Map();
    const contentByTargetGroup = new Map();
    const contentAliasConflicts = new Set();
    const registerContentAlias = (alias, linked) => {
      const normalized = normalizeLinkedId(alias);
      if (!normalized || contentAliasConflicts.has(normalized)) return;
      const existing = contentById.get(normalized);
      if (existing && existing.contentId !== linked.contentId) {
        contentById.delete(normalized);
        contentAliasConflicts.add(normalized);
        return;
      }
      contentById.set(normalized, linked);
    };
    contentRows.forEach((record) => {
      const contentId = normalizeLinkedId(record && record.id);
      if (!contentId) return;
      const itemNames = {};
      const productIds = [];
      const items = Array.isArray(record.items) ? record.items : [];
      items.forEach((item) => {
        const itemId = normalizeLinkedId(item && (item.itemId || item.id));
        if (!itemId) return;
        productIds.push(itemId);
        const itemName = String(item && (item.name || item.itemName || item.title) || '').trim();
        if (itemName) itemNames[itemId] = itemName;
      });
      splitLinkedIds(record.productId).forEach((itemId) => productIds.push(itemId));
      const uniqueProductIds = Array.from(new Set(productIds));
      uniqueProductIds.forEach((itemId) => {
        if (!itemNames[itemId] && productNameById.has(itemId)) {
          itemNames[itemId] = productNameById.get(itemId);
        }
      });
      const matchGroups = record && record.match && Array.isArray(record.match.targetGroups)
        ? record.match.targetGroups
        : [];
      const linked = {
        contentId,
        title: String(record.name || '').trim(),
        productIds: uniqueProductIds,
        productNames: itemNames,
        metrics: guangheOrganicMetrics(record),
        matchGroups,
      };
      registerContentAlias(contentId, linked);
      matchGroups.forEach((group) => {
        if (group && group.groupKey) contentByTargetGroup.set(group.groupKey, linked);
        (Array.isArray(group.targetIds) ? group.targetIds : [])
          .forEach((targetId) => registerContentAlias(targetId, linked));
      });
    });

    const uniqueVideoIds = new Set();
    const matchedVideoIds = new Set();
    const linkedProductIds = new Set();
    const matchMethodVideoIds = { id: new Set(), title: new Set() };
    const blocks = [];
    ['click', 'display'].forEach((attribution) => {
      const block = data && data.video && data.video[attribution];
      if (block && Array.isArray(block.rows)) blocks.push(block.rows);
    });

    blocks.forEach((rows) => {
      rows.forEach((row) => {
        const videoId = normalizeLinkedId(row.videoId);
        const identityEntries = targetIdentityEntries(row);
        const titleEntries = targetTitleEntries(row);
        const rowGroupKey = targetGroupKey(identityEntries, titleEntries);
        const candidates = Array.from(new Set(identityEntries.map((entry) => entry.value)));
        const matchedAlias = candidates.find((id) => contentById.has(id)) || '';
        const linked = matchedAlias
          ? contentById.get(matchedAlias)
          : (contentByTargetGroup.get(rowGroupKey) || null);
        const matchedGroup = linked && linked.matchGroups.find((group) => (
          (rowGroupKey && group.groupKey === rowGroupKey) ||
          (Array.isArray(group.targetIds) && group.targetIds.includes(matchedAlias))
        ));
        const matchMethod = matchedGroup && matchedGroup.method === 'title' ? 'title' : 'id';
        const videoIdentityKey = matchedAlias || videoId || rowGroupKey;
        if (videoIdentityKey) uniqueVideoIds.add(videoIdentityKey);
        const productIds = linked ? linked.productIds : [];
        productIds.forEach((id) => linkedProductIds.add(id));
        if (videoIdentityKey && linked) {
          matchedVideoIds.add(videoIdentityKey);
          matchMethodVideoIds[matchMethod].add(videoIdentityKey);
        }
        row.wanxiangVideoId = videoId;
        if (matchedAlias || videoId) row.videoId = matchedAlias || videoId;
        row.guangheMatched = !!linked;
        row.guangheMatchName = linked ? '已匹配' : '未匹配';
        row.guangheMatchMethod = linked ? matchMethod : '';
        row.guangheMatchEvidence = matchedGroup && Array.isArray(matchedGroup.evidence)
          ? matchedGroup.evidence.slice()
          : [];
        row.guangheContentId = linked ? linked.contentId : '';
        row.guangheTitle = linked ? linked.title : '';
        row.productIds = productIds.slice();
        row.productIdText = productIds.length ? productIds.join('、') : '未匹配商品';
        row.productNames = linked ? { ...linked.productNames } : {};
        row.guangheMetrics = linked ? { ...linked.metrics } : guangheOrganicMetrics(null);
      });
    });

    data.guangheLink = {
      available: contentRows.length > 0,
      contentCount: contentRows.length,
      totalVideoIds: uniqueVideoIds.size,
      matchedVideoIds: matchedVideoIds.size,
      unmatchedVideoIds: Math.max(0, uniqueVideoIds.size - matchedVideoIds.size),
      productCount: linkedProductIds.size,
      matchedRate: uniqueVideoIds.size ? matchedVideoIds.size / uniqueVideoIds.size : null,
      fetchedAt: numberOrNull(currentContext.fetchedAt) || numberOrNull(currentSnapshot.ts),
      visibleFilters: currentContext.visibleFilters || {},
      scannedCount: numberOrNull(currentContext.scannedCount) || 0,
      pagesFetched: numberOrNull(currentContext.pagesFetched) || 0,
      complete: currentContext.complete !== false,
      timedOut: currentContext.timedOut === true,
      fallbackUsed: currentContext.fallbackUsed === true,
      directLookupUsed: currentContext.directLookupUsed === true,
      directLookupMatched: numberOrNull(currentContext.directLookupMatched) || 0,
      mappingPairs: Array.isArray(currentContext.mappingPairs)
        ? currentContext.mappingPairs
        : (Array.isArray(syncResult && syncResult.mappingPairs) ? syncResult.mappingPairs : []),
      mappingDebugSamples: currentContext.mappingDebugSamples &&
        typeof currentContext.mappingDebugSamples === 'object'
        ? currentContext.mappingDebugSamples
        : null,
      matchMethodCounts: {
        id: matchMethodVideoIds.id.size,
        title: matchMethodVideoIds.title.size,
      },
      identityCheckRequired: syncResult && (
        syncResult.identityCheckRequired === true ||
        syncResult.accountCheckRequired === true
      ),
      accountCheckRequired: syncResult && syncResult.accountCheckRequired === true,
      excludedOtherUserContent: Array.isArray(currentContext.excludedAssetCodes) &&
        currentContext.excludedAssetCodes.includes('ugc'),
      syncError: String(syncResult && syncResult.message || ''),
    };
    return data;
  }

  function median(values) {
    const numbers = values
      .map((value) => numberOrNull(value))
      .filter((value) => value !== null && value > 0)
      .sort((left, right) => left - right);
    if (!numbers.length) return 0;
    const middle = Math.floor(numbers.length / 2);
    return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
  }

  function benchmark(rows) {
    return {
      charge: median(rows.map((row) => row.charge)),
      click: median(rows.map((row) => row.click)),
      feedViewNum: median(rows.map((row) => row.feedViewNum)),
      ctr: median(rows.map((row) => row.ctr)),
      cvr: median(rows.map((row) => row.cvr)),
      roi: median(rows.map((row) => row.roi)),
      alipayInshopCost: median(rows.map((row) => row.alipayInshopCost)),
      liveVideoNewCost: median(rows.map((row) => row.liveVideoNewCost)),
      displayNewRoi: median(rows.map((row) => row.displayNewRoi)),
    };
  }

  function scoreEfficiency(row, base) {
    const charge = numberOrNull(row.charge) || 0;
    const click = numberOrNull(row.click) || 0;
    const view = numberOrNull(row.feedViewNum) || 0;
    const roi = numberOrNull(row.roi) || 0;
    const cvrValue = normalizedRate(row.cvr) || 0;
    const ctrValue = normalizedRate(row.ctr) || 0;
    const cost = numberOrNull(row.alipayInshopCost);
    const newCost = numberOrNull(row.liveVideoNewCost);
    const newRoi = numberOrNull(row.displayNewRoi) || 0;
    let score = 0;
    if (base.charge && charge >= base.charge) score += 10;
    if (base.click && click >= base.click) score += 8;
    if (base.feedViewNum && view >= base.feedViewNum) score += 6;
    if (base.roi && roi >= base.roi) score += 24;
    if (base.roi && roi >= base.roi * 1.5) score += 8;
    if (base.cvr && cvrValue >= base.cvr) score += 16;
    if (base.ctr && ctrValue >= base.ctr) score += 10;
    if (base.alipayInshopCost && cost !== null && cost <= base.alipayInshopCost) score += 14;
    if (base.liveVideoNewCost && newCost !== null && newCost <= base.liveVideoNewCost) score += 8;
    if (base.displayNewRoi && newRoi >= base.displayNewRoi) score += 8;
    return Math.max(0, Math.min(100, score));
  }

  function grade(score) {
    if (score >= 76) return 'S';
    if (score >= 62) return 'A';
    if (score >= 46) return 'B';
    if (score >= 30) return 'C';
    return 'D';
  }

  function actionForGrade(gradeValue, row) {
    const roi = numberOrNull(row.roi) || 0;
    const charge = numberOrNull(row.charge) || 0;
    const click = numberOrNull(row.click) || 0;
    if (gradeValue === 'S') return '放量，优先增加预算和复制打法';
    if (gradeValue === 'A') return '保持投放，小幅加码观察边际成本';
    if (gradeValue === 'B') return click < 20 ? '继续拿量，样本不足先观察' : '优化素材和承接，控制成本';
    if (gradeValue === 'C') return charge > 0 && roi <= 0 ? '降预算，优先排查素材与承接' : '收缩预算，保留测试';
    return '暂停或重建，避免继续消耗';
  }

  function identityKey(row, fields) {
    return fields.map((field) => String(row[field] || '')).join('||');
  }

  function rowsByKey(rows, fields) {
    const map = new Map();
    rows.forEach((row) => {
      const key = identityKey(row, fields);
      if (!map.has(key)) map.set(key, row);
    });
    return map;
  }

  function attributionTag(clickRow, displayRow) {
    const clickRoi = numberOrNull(clickRow && clickRow.roi) || 0;
    const displayRoi = numberOrNull(displayRow && displayRow.roi) || 0;
    const clickCvr = normalizedRate(clickRow && clickRow.cvr) || 0;
    const displayCvr = normalizedRate(displayRow && displayRow.cvr) || 0;
    if (clickRoi > 0 && displayRoi > 0 && Math.abs(clickRoi - displayRoi) / Math.max(clickRoi, displayRoi) < 0.25) {
      return '点击和展现都稳定';
    }
    if (displayRoi > clickRoi * 1.35 || displayCvr > clickCvr * 1.35) return '偏种草影响';
    if (clickRoi > displayRoi * 1.35 || clickCvr > displayCvr * 1.35) return '偏直接转化';
    if (!clickRoi && !displayRoi) return '归因效果弱';
    return '归因差异不明显';
  }

  function roleHigher(left, right, ratioValue) {
    const leftValue = numberOrNull(left);
    const rightValue = numberOrNull(right);
    if (leftValue === null || leftValue <= 0) return false;
    if (rightValue === null || rightValue <= 0) return true;
    return leftValue >= rightValue * (ratioValue || 1.2);
  }

  function roleHigherRate(left, right, ratioValue) {
    return roleHigher(normalizedRate(left), normalizedRate(right), ratioValue || 1.2);
  }

  function deliveryRoleTag(clickRow, displayRow) {
    const click = clickRow || {};
    const display = displayRow || {};
    let trafficScore = 0;
    let conversionScore = 0;

    if (roleHigher(display.roi, click.roi, 1.25)) trafficScore += 1;
    if (roleHigherRate(display.ctr, click.ctr, 1.12)) trafficScore += 1;
    if (roleHigherRate(display.cartRate, click.cartRate, 1.15)) trafficScore += 1;
    if (roleHigherRate(display.inshopPotentialUvRate, click.inshopPotentialUvRate, 1.15)) trafficScore += 2;
    if ((numberOrNull(display.feedViewNum) || 0) > 0 && (numberOrNull(display.click) || 0) > 0) trafficScore += 1;

    if (roleHigher(click.roi, display.roi, 1.15)) conversionScore += 2;
    if (roleHigherRate(click.cvr, display.cvr, 1.15)) conversionScore += 1;
    if (roleHigherRate(click.directAlipayAmtRate, display.directAlipayAmtRate, 1.15)) conversionScore += 1;
    if ((numberOrNull(click.alipayInshopAmt) || 0) > 0 || (numberOrNull(click.alipayInshopNum) || 0) > 0) conversionScore += 1;

    if (trafficScore >= 3 && conversionScore >= 3) return '引流转化兼顾';
    if (trafficScore >= 3) return '适合引流';
    if (conversionScore >= 3) return '适合转化';
    if (trafficScore >= 2) return '偏引流观察';
    if (conversionScore >= 2) return '偏转化观察';
    return '暂不明确';
  }

  function selectedAttributionRows(data, level, attributionKey) {
    const requested = shortVideoDetailRows(
      data,
      level,
      attributionKey,
      attributionKey === 'display' ? '展现效果归因' : '点击效果归因'
    );
    if (requested.length) return requested;
    const fallbackKey = attributionKey === 'display' ? 'click' : 'display';
    return shortVideoDetailRows(
      data,
      level,
      fallbackKey,
      fallbackKey === 'display' ? '展现效果归因' : '点击效果归因'
    );
  }

  function meetsDiagnosisSpend(metrics) {
    return (numberOrNull(metrics && metrics.charge) || 0) >= DIAGNOSIS_MIN_SPEND;
  }

  function diagnoseRows(data, level, attributionKey) {
    const clickRows = shortVideoDetailRows(data, level, 'click', '点击效果归因');
    const displayRows = shortVideoDetailRows(data, level, 'display', '展现效果归因');
    const keyFields = level === 'plan'
      ? ['campaignId', 'campaignName']
      : ['campaignId', 'promotionName', 'videoId', 'videoInfo'];
    const clickMap = rowsByKey(clickRows, keyFields);
    const displayMap = rowsByKey(displayRows, keyFields);
    const primaryRows = selectedAttributionRows(data, level, attributionKey)
      .filter((row) => meetsDiagnosisSpend(row));
    const base = benchmark(primaryRows);
    return primaryRows.map((primaryRow) => {
      const key = identityKey(primaryRow, keyFields);
      const clickRow = clickMap.get(key) || primaryRow;
      const displayRow = displayMap.get(key) || primaryRow;
      const scoreRow = attributionKey === 'display'
        ? (displayMap.get(key) || primaryRow)
        : (clickMap.get(key) || primaryRow);
      const score = scoreEfficiency(scoreRow, base);
      const gradeValue = grade(score);
      return {
        level,
        score,
        grade: gradeValue,
        action: actionForGrade(gradeValue, scoreRow),
        attribution: attributionTag(clickRow, displayRow),
        role: deliveryRoleTag(clickRow, displayRow),
        click: scoreRow,
        display: displayRow,
      };
    }).sort((left, right) => right.score - left.score);
  }

  function diagnoseShortVideo(data, attributionKey) {
    const plans = diagnoseRows(data, 'plan', attributionKey);
    const videos = diagnoseRows(data, 'video', attributionKey);
    const planById = new Map(plans.map((item) => [String(item.click.campaignId || item.click.campaignName || ''), item]));
    videos.forEach((item) => {
      const key = String(item.click.campaignId || item.click.campaignName || '');
      const plan = planById.get(key);
      if (!plan) return;
      ['campaignName', 'solutionName', 'optimizationTarget', 'bidMode'].forEach((field) => {
        if (!item.click[field] && plan.click && plan.click[field]) item.click[field] = plan.click[field];
        if (!item.display[field] && plan.display && plan.display[field]) item.display[field] = plan.display[field];
      });
    });
    const videosByPlan = new Map();
    videos.forEach((item) => {
      const key = String(item.click.campaignId || item.click.campaignName || '');
      if (!videosByPlan.has(key)) videosByPlan.set(key, []);
      videosByPlan.get(key).push(item);
    });
    const weakPlans = plans.filter((item) => ['C', 'D'].includes(item.grade)).slice(0, 5);
    const strongPlans = plans.filter((item) => ['S', 'A'].includes(item.grade)).slice(0, 5);
    const strongVideos = videos.filter((item) => ['S', 'A'].includes(item.grade)).slice(0, 8);
    const weakVideos = videos.filter((item) => ['C', 'D'].includes(item.grade)).slice(-8).reverse();
    const trafficPlans = plans.filter((item) => /引流/.test(item.role) && !['C', 'D'].includes(item.grade)).slice(0, 5);
    const conversionPlans = plans.filter((item) => /转化/.test(item.role) && !['C', 'D'].includes(item.grade)).slice(0, 5);
    const trafficVideos = videos.filter((item) => /引流/.test(item.role) && !['C', 'D'].includes(item.grade)).slice(0, 8);
    const conversionVideos = videos.filter((item) => /转化/.test(item.role) && !['C', 'D'].includes(item.grade)).slice(0, 8);
    return {
      plans,
      videos,
      planById,
      videosByPlan,
      strongPlans,
      weakPlans,
      strongVideos,
      weakVideos,
      trafficPlans,
      conversionPlans,
      trafficVideos,
      conversionVideos,
    };
  }

  function diagnosisKpis(data, diagnosis, attributionKey, attributionName) {
    const planCount = diagnosis.plans.length;
    const works = gradedPaidSummaries(data, attributionKey, 'video');
    const products = gradedPaidSummaries(data, attributionKey, 'product')
      .filter((item) => actionableEntityId(item.id));
    const videoCount = works.length;
    const planSpend = diagnosis.plans.reduce((sum, item) => sum + (numberOrNull(item.click.charge) || 0), 0);
    const matchedWorks = works.filter((item) => item.matched).length;
    return [
      ['参与诊断计划', formatInteger(planCount)],
      ['参与诊断作品', formatInteger(videoCount)],
      [attributionName + '诊断花费', '¥' + formatMoney(planSpend)],
      ['建议放量计划', formatInteger(diagnosis.strongPlans.length)],
      ['光合匹配作品', formatInteger(matchedWorks) + '/' + formatInteger(videoCount)],
      ['参与诊断商品', formatInteger(products.length)],
    ];
  }

  function rowName(item) {
    const row = item.click || {};
    if (item.level === 'plan') return String(row.campaignName || row.campaignId || '未命名计划');
    return videoSubjectName(row);
  }

  function videoSubjectName(row) {
    const candidates = [
      row && row.guangheTitle,
      row && row.videoInfo,
      row && row.videoName,
      row && row.videoTitle,
      row && row.materialName,
      row && row.creativeName,
      row && row.contentName,
      row && row.feedName,
      row && row.resourceName,
      row && row.subjectName,
      row && row.entityName,
      row && row.promotionName,
      row && row.videoId,
    ];
    for (const value of candidates) {
      const text = String(value == null ? '' : value).trim();
      if (text) return text;
    }
    return '未命名视频';
  }

  function itemIdLabel(item) {
    const row = item.click || {};
    if (item.level === 'plan') return '计划ID ' + textOrDash(row.campaignId);
    return '视频ID ' + textOrDash(row.videoId);
  }

  function shortName(value, maxLength) {
    const text = String(value || '');
    return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
  }

  function textOrDash(value) {
    return value === null || value === undefined || value === '' ? '-' : String(value);
  }

  function sumMetric(rows, key) {
    return rows.reduce((sum, row) => sum + (numberOrNull(row[key]) || 0), 0);
  }

  function aggregateRows(rows) {
    const charge = sumMetric(rows, 'charge');
    const adPv = sumMetric(rows, 'adPv');
    const click = sumMetric(rows, 'click');
    const feedViewNum = sumMetric(rows, 'feedViewNum');
    const alipayInshopNum = sumMetric(rows, 'alipayInshopNum');
    const alipayInshopAmt = sumMetric(rows, 'alipayInshopAmt');
    const alipayDirAmt = sumMetric(rows, 'alipayDirAmt');
    const cartInshopNum = sumMetric(rows, 'cartInshopNum');
    const inshopUv = sumMetric(rows, 'inshopUv');
    const inshopPotentialUv = sumMetric(rows, 'inshopPotentialUv');
    const liveVideoNewUv = sumMetric(rows, 'liveVideoNewUv');
    const firstPurchaseUv = sumMetric(rows, 'firstPurchaseUv');
    const displayNewCharge = sumMetric(rows, 'displayNewCharge');
    const displayNewInshopAmt = sumMetric(rows, 'displayNewInshopAmt');
    const dealCost = ratio(charge, alipayInshopNum);
    const newCost = ratio(charge, liveVideoNewUv);
    return {
      charge,
      adPv,
      click,
      feedViewNum,
      alipayInshopNum,
      alipayInshopAmt,
      alipayDirAmt,
      cartInshopNum,
      inshopUv,
      inshopPotentialUv,
      liveVideoNewUv,
      firstPurchaseUv,
      displayNewCharge,
      displayNewInshopAmt,
      ctr: ratio(click, adPv),
      ecpm: ratio(charge * 1000, adPv),
      cvr: ratio(alipayInshopNum, click),
      roi: ratio(alipayInshopAmt, charge),
      dealCost,
      alipayInshopCost: dealCost,
      newCost,
      liveVideoNewCost: newCost,
      displayNewRoi: ratio(displayNewInshopAmt, displayNewCharge),
      firstPurchaseCost: ratio(charge, firstPurchaseUv),
      directAlipayAmtRate: ratio(alipayDirAmt, alipayInshopAmt),
      cartRate: ratio(cartInshopNum, click),
      inshopPotentialUvRate: ratio(inshopPotentialUv, inshopUv),
    };
  }

  const PAID_ALLOCATION_FIELDS = [
    'charge',
    'adPv',
    'click',
    'feedViewNum',
    'alipayInshopNum',
    'alipayInshopAmt',
    'alipayDirAmt',
    'cartInshopNum',
    'inshopPv',
    'inshopUv',
    'inshopPotentialUv',
    'liveVideoNewUv',
    'firstPurchaseUv',
    'displayNewCharge',
    'displayNewInshopAmt',
  ];

  const ORGANIC_SUM_FIELDS = [
    'organicExpoPv',
    'organicConsumePv',
    'organicBigClick',
    'organicSmallClick',
    'organicSeedAmount',
    'organicClickPv',
    'organicValidConsumePv',
    'organicDwellTime',
    'organicSeedOrderCount',
  ];

  function finalizeOrganicMetrics(base) {
    const metrics = { ...(base || {}) };
    ORGANIC_SUM_FIELDS.forEach((field) => {
      metrics[field] = numberOrNull(metrics[field]) || 0;
    });
    metrics.organicExposureCtr = ratio(metrics.organicClickPv, metrics.organicExpoPv);
    metrics.organicValidViewRate = ratio(metrics.organicValidConsumePv, metrics.organicConsumePv);
    metrics.organicAvgDwellSeconds = ratio(metrics.organicDwellTime, metrics.organicConsumePv);
    metrics.organicBigClickRate = ratio(metrics.organicBigClick, metrics.organicConsumePv);
    metrics.organicSmallClickRate = ratio(metrics.organicSmallClick, metrics.organicConsumePv);
    metrics.organicValidViewConversionRate = ratio(
      metrics.organicSeedOrderCount,
      metrics.organicValidConsumePv
    );
    metrics.organicSeedAmountPerKView = ratio(
      metrics.organicSeedAmount * 1000,
      metrics.organicConsumePv
    );
    metrics.organicSeedAmountPerKValidView = ratio(
      metrics.organicSeedAmount * 1000,
      metrics.organicValidConsumePv
    );
    return metrics;
  }

  function attributionVideoRows(data, attributionKey) {
    const requested = shortVideoDetailRows(
      data,
      'video',
      attributionKey,
      attributionKey === 'display' ? '展现效果归因' : '点击效果归因'
    );
    if (requested.length) return requested;
    const fallbackKey = attributionKey === 'display' ? 'click' : 'display';
    return shortVideoDetailRows(
      data,
      'video',
      fallbackKey,
      fallbackKey === 'display' ? '展现效果归因' : '点击效果归因'
    );
  }

  function allocatedPaidRow(row, factor) {
    const result = { ...row };
    PAID_ALLOCATION_FIELDS.forEach((field) => {
      const value = numberOrNull(row[field]);
      result[field] = value === null ? null : value * factor;
    });
    return result;
  }

  function emptyOrganicMetrics() {
    const base = ORGANIC_SUM_FIELDS.reduce((result, field) => {
      result[field] = 0;
      return result;
    }, {});
    return finalizeOrganicMetrics(base);
  }

  function addOrganicMetrics(target, source, factor) {
    ORGANIC_SUM_FIELDS.forEach((field) => {
      target[field] += (numberOrNull(source && source[field]) || 0) * factor;
    });
  }

  function buildVideoAggregateMap(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      const videoId = normalizeLinkedId(row.videoId) || '未识别视频';
      if (!groups.has(videoId)) groups.set(videoId, []);
      groups.get(videoId).push(row);
    });
    const result = new Map();
    groups.forEach((groupRows, videoId) => {
      const productIds = Array.from(new Set(groupRows.flatMap((row) => splitLinkedIds(row.productIds))));
      const campaignIds = new Set(groupRows.map((row) => normalizeLinkedId(row.campaignId)).filter(Boolean));
      const firstMatched = groupRows.find((row) => row.guangheMatched) || groupRows[0] || {};
      result.set(videoId, {
        id: videoId,
        name: videoSubjectName(firstMatched),
        productIds,
        productIdText: productIds.length ? productIds.join('、') : '未匹配商品',
        matched: groupRows.some((row) => row.guangheMatched),
        matchName: groupRows.some((row) => row.guangheMatched) ? '已匹配' : '未匹配',
        planCount: campaignIds.size,
        videoCount: 1,
        metrics: aggregateRows(groupRows),
        organic: finalizeOrganicMetrics(
          firstMatched.guangheMetrics || emptyOrganicMetrics()
        ),
      });
    });
    return result;
  }

  function buildProductAggregateMap(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      const productIds = splitLinkedIds(row.productIds);
      const allocationIds = productIds.length ? productIds : ['未匹配商品'];
      const factor = 1 / allocationIds.length;
      allocationIds.forEach((productId) => {
        if (!groups.has(productId)) groups.set(productId, []);
        groups.get(productId).push({
          row,
          allocated: allocatedPaidRow(row, factor),
          organicFactor: factor,
        });
      });
    });

    const result = new Map();
    groups.forEach((entries, productId) => {
      const sourceRows = entries.map((entry) => entry.row);
      const allocatedRows = entries.map((entry) => entry.allocated);
      const campaignIds = new Set(sourceRows.map((row) => normalizeLinkedId(row.campaignId)).filter(Boolean));
      const videoIds = new Set(sourceRows.map((row) => normalizeLinkedId(row.videoId)).filter(Boolean));
      const organic = emptyOrganicMetrics();
      const organicSeen = new Set();
      entries.forEach((entry) => {
        const videoId = normalizeLinkedId(entry.row.videoId);
        if (!videoId || organicSeen.has(videoId)) return;
        organicSeen.add(videoId);
        addOrganicMetrics(organic, entry.row.guangheMetrics, entry.organicFactor);
      });
      let productName = '';
      for (const row of sourceRows) {
        const names = row.productNames || {};
        if (names[productId]) {
          productName = String(names[productId]);
          break;
        }
      }
      result.set(productId, {
        id: productId,
        name: productId,
        productName,
        matched: productId !== '未匹配商品',
        matchName: productId === '未匹配商品' ? '未匹配' : '已匹配',
        planCount: campaignIds.size,
        videoCount: videoIds.size,
        metrics: aggregateRows(allocatedRows),
        organic: finalizeOrganicMetrics(organic),
      });
    });
    return result;
  }

  function paidSummaryCandidates(data, attributionKey, entityType) {
    const builder = entityType === 'product' ? buildProductAggregateMap : buildVideoAggregateMap;
    return Array.from(builder(attributionVideoRows(data, attributionKey)).values());
  }

  function gradedPaidSummaries(data, attributionKey, entityType) {
    const builder = entityType === 'product' ? buildProductAggregateMap : buildVideoAggregateMap;
    const primaryMap = builder(attributionVideoRows(data, attributionKey));
    const clickMap = buildProductAggregateMap === builder
      ? buildProductAggregateMap(attributionVideoRows(data, 'click'))
      : buildVideoAggregateMap(attributionVideoRows(data, 'click'));
    const displayMap = buildProductAggregateMap === builder
      ? buildProductAggregateMap(attributionVideoRows(data, 'display'))
      : buildVideoAggregateMap(attributionVideoRows(data, 'display'));
    const graded = gradeAggregates(
      Array.from(primaryMap.values()).filter((item) => meetsDiagnosisSpend(item.metrics))
    );
    return graded.map((item) => {
      const clickMetrics = clickMap.get(item.id) && clickMap.get(item.id).metrics || item.metrics;
      const displayMetrics = displayMap.get(item.id) && displayMap.get(item.id).metrics || item.metrics;
      return {
        ...item,
        role: deliveryRoleTag(clickMetrics, displayMetrics),
        attribution: attributionTag(clickMetrics, displayMetrics),
      };
    }).sort((left, right) => {
      const scoreDiff = (numberOrNull(right.score) || 0) - (numberOrNull(left.score) || 0);
      if (scoreDiff) return scoreDiff;
      return (numberOrNull(right.metrics.charge) || 0) - (numberOrNull(left.metrics.charge) || 0);
    });
  }

  function groupPlanRows(rows, keyGetter, labelName) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = textOrDash(keyGetter(row));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return Array.from(groups.entries()).map(([name, groupRows]) => ({
      name,
      labelName,
      planCount: groupRows.length,
      metrics: aggregateRows(groupRows),
    })).sort((left, right) => {
      const roiDiff = (numberOrNull(right.metrics.roi) || 0) - (numberOrNull(left.metrics.roi) || 0);
      if (Math.abs(roiDiff) > 0.001) return roiDiff;
      return (numberOrNull(right.metrics.charge) || 0) - (numberOrNull(left.metrics.charge) || 0);
    });
  }

  function deliveryDiagnostics(diagnosis) {
    const rows = diagnosis.plans.map((item) => item.click || {}).filter((row) => meetsDiagnosisSpend(row));
    const bySolution = groupPlanRows(rows, (row) => row.solutionName, '解决方案');
    const byTarget = groupPlanRows(rows, (row) => row.optimizationTarget, '优化目标');
    const byBid = groupPlanRows(rows, (row) => row.bidMode, '出价方式');
    const byCombo = groupPlanRows(
      rows,
      (row) => [textOrDash(row.solutionName), textOrDash(row.optimizationTarget), textOrDash(row.bidMode)].join(' / '),
      '投放组合'
    );
    return { rows, bySolution, byTarget, byBid, byCombo };
  }

  function aggregateScore(item, base) {
    const metrics = item.metrics || {};
    let score = 0;
    if ((numberOrNull(metrics.charge) || 0) >= (base.charge || 0)) score += 8;
    if ((numberOrNull(metrics.click) || 0) >= (base.click || 0)) score += 8;
    if ((numberOrNull(metrics.roi) || 0) >= (base.roi || 0)) score += 28;
    if ((numberOrNull(metrics.cvr) || 0) >= (base.cvr || 0)) score += 16;
    if ((numberOrNull(metrics.ctr) || 0) >= (base.ctr || 0)) score += 10;
    const dealCost = numberOrNull(metrics.dealCost);
    const newCost = numberOrNull(metrics.newCost);
    if (base.dealCost && dealCost !== null && dealCost <= base.dealCost) score += 18;
    if (base.newCost && newCost !== null && newCost <= base.newCost) score += 12;
    return Math.max(0, Math.min(100, score));
  }

  function gradeAggregates(items) {
    const base = {
      charge: median(items.map((item) => item.metrics.charge)),
      click: median(items.map((item) => item.metrics.click)),
      roi: median(items.map((item) => item.metrics.roi)),
      cvr: median(items.map((item) => item.metrics.cvr)),
      ctr: median(items.map((item) => item.metrics.ctr)),
      dealCost: median(items.map((item) => item.metrics.dealCost)),
      newCost: median(items.map((item) => item.metrics.newCost)),
    };
    return items.map((item) => {
      const score = aggregateScore(item, base);
      return {
        ...item,
        score,
        grade: grade(score),
        action: score >= 76
          ? '优先加码'
          : score >= 62
            ? '保持观察'
            : score >= 46
              ? '优化承接'
              : '收缩测试',
      };
    });
  }

  function bestBy(items, getter, direction) {
    return items
      .filter((item) => numberOrNull(getter(item)) !== null && (numberOrNull(item.metrics.charge) || 0) > 0)
      .sort((left, right) => {
        const leftValue = numberOrNull(getter(left)) || 0;
        const rightValue = numberOrNull(getter(right)) || 0;
        return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
      })[0] || null;
  }

  function aggregateInsightCards(diagnostics) {
    const combos = gradeAggregates(diagnostics.byCombo);
    const bestRoi = bestBy(combos, (item) => item.metrics.roi, 'desc');
    const bestCost = bestBy(combos, (item) => item.metrics.dealCost, 'asc');
    const bestNewCost = bestBy(combos, (item) => item.metrics.newCost, 'asc');
    const highestSpend = bestBy(combos, (item) => item.metrics.charge, 'desc');
    const cards = [
      ['最高 ROI 组合', bestRoi, (item) => 'ROI ' + formatDecimal(item.metrics.roi)],
      ['最低成交成本组合', bestCost, (item) => '¥' + formatMoney(item.metrics.dealCost)],
      ['最低新客成本组合', bestNewCost, (item) => '¥' + formatMoney(item.metrics.newCost)],
      ['最大消耗组合', highestSpend, (item) => '¥' + formatMoney(item.metrics.charge)],
    ];
    return '<section class="wxt-delivery-cards">' + cards.map(([title, item, valueText]) => (
      '<div><span>' + escapeHtml(title) + '</span><strong>' + escapeHtml(item ? valueText(item) : '-') +
      '</strong><p>' + escapeHtml(item ? item.name : '暂无数据') + '</p></div>'
    )).join('') + '</section>';
  }

  function filterSlug(title) {
    return 'tbl-' + String(title || '')
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 8);
  }

  const DIAGNOSIS_MIN_SPEND = 200;
  const DIAGNOSIS_TABLE_LIMIT = 20;
  const WXT_VISUAL_METRICS = {
    ecpm: { direction: 'lower' },
    ctr: { direction: 'higher', rate: true },
    cvr: { direction: 'higher', rate: true },
    alipayInshopAmt: { direction: 'higher' },
    roi: { direction: 'higher' },
    inshopPotentialUvRate: { direction: 'higher', rate: true },
  };
  const GUANGHE_METRIC_GOALS = {
    organicExposureCtr: { goal: 0.03, label: '3%' },
    organicValidViewRate: { goal: 0.40, label: '40%' },
    organicAvgDwellSeconds: { goal: 6, label: '6秒' },
    organicBigClickRate: { goal: 0.05, label: '5%' },
    organicSmallClickRate: { goal: 0.01, label: '1%' },
  };

  function tableSpend(item, metricsGetter) {
    const metrics = metricsGetter(item) || {};
    return numberOrNull(metrics.charge) || 0;
  }

  function topSpendItems(items, metricsGetter, limit) {
    const maxRows = Number.isFinite(limit)
      ? Math.min(Math.max(0, limit), DIAGNOSIS_TABLE_LIMIT)
      : DIAGNOSIS_TABLE_LIMIT;
    return (Array.isArray(items) ? items : [])
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const spendDiff = tableSpend(right.item, metricsGetter) - tableSpend(left.item, metricsGetter);
        return spendDiff || left.index - right.index;
      })
      .slice(0, maxRows)
      .map((entry) => entry.item);
  }

  function percentile(values, position) {
    const numbers = values
      .map((value) => numberOrNull(value))
      .filter((value) => value !== null)
      .sort((left, right) => left - right);
    if (!numbers.length) return null;
    if (numbers.length === 1) return numbers[0];
    const index = (numbers.length - 1) * position;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return numbers[lower];
    return numbers[lower] + (numbers[upper] - numbers[lower]) * (index - lower);
  }

  function visualMetricValue(metrics, key) {
    const definition = WXT_VISUAL_METRICS[key] || {};
    const raw = metrics && metrics[key];
    return definition.rate ? normalizedRate(raw) : numberOrNull(raw);
  }

  function buildVisualMetricScales(items, metricsGetter) {
    const scales = {};
    Object.keys(WXT_VISUAL_METRICS).forEach((key) => {
      const values = items.map((item) => visualMetricValue(metricsGetter(item) || {}, key));
      scales[key] = {
        low: percentile(values, 0.33),
        high: percentile(values, 0.67),
        direction: WXT_VISUAL_METRICS[key].direction,
      };
    });
    return scales;
  }

  function visualMetricTone(value, scale) {
    const numeric = numberOrNull(value);
    if (numeric === null || !scale || scale.low === null || scale.high === null) return '';
    if (Math.abs(scale.high - scale.low) < 1e-12) return '';
    if (scale.direction === 'lower') {
      if (numeric <= scale.low) return 'good';
      if (numeric >= scale.high) return 'bad';
      return 'watch';
    }
    if (numeric >= scale.high) return 'good';
    if (numeric <= scale.low) return 'bad';
    return 'watch';
  }

  function tableHeader(label, kind, sortDirection) {
    if (kind === 'metric') {
      const direction = sortDirection === 'asc' || sortDirection === 'desc'
        ? ' data-sort-direction="' + sortDirection + '"'
        : '';
      return '<th data-sort-type="number"' + direction + '>' + escapeHtml(label) +
        '<span class="wxt-sort-mark">↕</span></th>';
    }
    if (kind === 'filter') {
      return '<th data-filter-type="text">' + escapeHtml(label) + '</th>';
    }
    return '<th>' + escapeHtml(label) + '</th>';
  }

  function tableCell(value, className, sortValue, title) {
    const numeric = numberOrNull(sortValue);
    const attrs = numeric === null ? '' : ' data-sort-value="' + String(numeric) + '"';
    const titleAttr = title ? ' title="' + escapeHtml(title) + '"' : '';
    return '<td class="' + escapeHtml(className || '') + '"' + attrs + titleAttr +
      '><div class="wxt-cell-scroll">' +
      escapeHtml(value) + '</div></td>';
  }

  function gradeCell(gradeValue, score) {
    return '<td data-sort-value="' + String(numberOrNull(score) || 0) + '" data-filter-value="' +
      escapeHtml(gradeValue) + '"><strong>' + escapeHtml(gradeValue) + '</strong><br><span>' +
      escapeHtml(Math.round(numberOrNull(score) || 0)) + '</span></td>';
  }

  function metricCell(value, displayValue) {
    return tableCell(displayValue, '', value);
  }

  function visualMetricCell(metrics, key, displayValue, scales) {
    const value = visualMetricValue(metrics || {}, key);
    const scale = scales && scales[key];
    const tone = visualMetricTone(value, scale);
    const className = tone ? 'wxt-metric-cell wxt-metric-' + tone : 'wxt-metric-cell';
    const title = tone === 'good'
      ? (scale.direction === 'lower' ? '本表相对低成本' : '本表相对高位')
      : tone === 'bad'
        ? (scale.direction === 'lower' ? '本表相对高成本' : '本表相对低位')
        : tone === 'watch'
          ? '本表中间水平'
          : '';
    return tableCell(displayValue, className, value, title);
  }

  function guangheGoalMetricCell(key, value, displayValue) {
    const numeric = numberOrNull(value);
    const definition = GUANGHE_METRIC_GOALS[key];
    if (numeric === null || !definition) return metricCell(value, displayValue);
    const met = numeric >= definition.goal;
    return tableCell(
      displayValue,
      'wxt-metric-cell wxt-metric-' + (met ? 'good' : 'bad'),
      numeric,
      (met ? '达到' : '未达到') + '光合目标（≥' + definition.label + '）'
    );
  }

  function guangheGoalHeader(label, key) {
    const definition = GUANGHE_METRIC_GOALS[key];
    return '<th data-sort-type="number" data-guanghe-goal="' + escapeHtml(key) + '">' +
      escapeHtml(label) + '<small class="wxt-goal-reference">参考值 ≥ ' +
      escapeHtml(definition ? definition.label : '-') + '</small>' +
      '<span class="wxt-sort-mark">↕</span></th>';
  }

  function guangheLinkSummaryMarkup(data) {
    const link = data.guangheLink || {};
    const total = numberOrNull(link.totalVideoIds) || 0;
    const matched = numberOrNull(link.matchedVideoIds) || 0;
    const snapshotTime = numberOrNull(link.fetchedAt);
    const timeText = snapshotTime
      ? new Date(snapshotTime).toLocaleString('zh-CN', { hour12: false })
      : '未读取到光合缓存时间';
    const statusClass = link.available && matched > 0 ? 'is-linked' : 'is-unlinked';
    let guidance = link.available
      ? '优先按两端原始身份字段精确匹配，ID无交集时仅使用两端都唯一的标题兜底，并兼容安全的标题截断；已跳过无数据的“其他用户内容”。'
      : '本次未取得可匹配的自制或达人合作作品，未匹配部分单独归入“未匹配商品”。';
    if (link.syncError) {
      guidance = '光合自动匹配失败，本报告仍使用万相台付费数据生成：' + link.syncError;
    } else if (link.identityCheckRequired || link.accountCheckRequired) {
      guidance = '未命中任何视频，账号或ID口径需核验；请检查万相台视频ID与光合作品ID字段。已保留光合页面供检查。';
    } else if (link.timedOut || link.complete === false) {
      guidance = '已跳过“其他用户内容”并返回当前匹配结果；扫描达到安全上限，未匹配部分归入“未匹配商品”。';
    } else if (link.fallbackUsed) {
      guidance = '当前账号的作品来源筛选接口不兼容，已回退到全部作品做定向ID匹配，并跳过可识别的“其他用户内容”。';
    }
    if (link.directLookupUsed && link.directLookupMatched > 0) {
      guidance += ' 其中 ' + formatInteger(link.directLookupMatched) +
        ' 个视频由光合内容ID定向查询直接命中。';
    }
    const mappingPairs = Array.isArray(link.mappingPairs) ? link.mappingPairs : [];
    if (mappingPairs.length) {
      const pairText = mappingPairs.slice(0, 3).map((pair) => (
        String(pair.wxtField || '万相台候选ID') + ' ↔ ' +
        String(pair.guangheField || '光合候选ID') +
        '（' + formatInteger(pair.count || 0) + '）'
      )).join('；');
      guidance += ' 本次确认的字段映射：' + pairText + '。';
    }
    const debugSamples = link.mappingDebugSamples && typeof link.mappingDebugSamples === 'object'
      ? link.mappingDebugSamples
      : null;
    let debugMarkup = '';
    if (debugSamples) {
      const matchedPair = Array.isArray(debugSamples.matchedPairs) && debugSamples.matchedPairs.length
        ? debugSamples.matchedPairs[0]
        : null;
      const firstTarget = Array.isArray(debugSamples.wxtTargets) && debugSamples.wxtTargets.length
        ? debugSamples.wxtTargets[0]
        : null;
      const firstGuanghe = Array.isArray(debugSamples.guangheRows) && debugSamples.guangheRows.length
        ? debugSamples.guangheRows[0]
        : null;
      const payload = matchedPair || (
        firstTarget || firstGuanghe
          ? {
              note: '当前没有同视频命中记录，以下分别为万相台目标样本与光合扫描样本。',
              wxtRaw: firstTarget && firstTarget.rawSample || null,
              wxtIdentityEntries: firstTarget && firstTarget.identityEntries || [],
              guangheRaw: firstGuanghe || null,
            }
          : null
      );
      if (payload) {
        let debugText = '';
        try {
          debugText = JSON.stringify(payload, null, 2);
        } catch (error) {
          debugText = '原始字段样本序列化失败。';
        }
        debugMarkup = '<details class="wxt-mapping-debug"><summary>查看原始字段对照样本</summary>' +
          '<pre>' + escapeHtml(debugText.slice(0, 50000)) + '</pre></details>';
      }
    }
    return '<section class="wxt-guanghe-link ' + statusClass + '">' +
      '<div><span>光合商品关联</span><strong>' + formatInteger(matched) + '/' + formatInteger(total) +
      ' 个视频已匹配</strong><p>' + escapeHtml(guidance) + '</p></div>' +
      '<div><span>关联商品</span><strong>' + formatInteger(link.productCount || 0) +
      ' 个</strong><p>光合数据更新时间：' + escapeHtml(timeText) + '</p></div>' +
      '<div><span>多商品分摊</span><strong>等额分摊</strong><p>保证商品汇总花费不重复；商品级结果属于估算口径。</p></div>' +
    '</section>' + debugMarkup;
  }

  function paidSummaryTableMarkup(data, attributionKey, entityType) {
    const isProduct = entityType === 'product';
    const allItems = gradedPaidSummaries(data, attributionKey, entityType);
    const metricsGetter = (item) => item.metrics || {};
    const items = topSpendItems(allItems, metricsGetter);
    const visualScales = buildVisualMetricScales(allItems, metricsGetter);
    const title = isProduct ? '商品短视频付费效果' : '视频ID付费效果';
    const subtitle = isProduct
      ? '仅诊断分摊后累计花费 ≥ ¥' + DIAGNOSIS_MIN_SPEND +
        ' 的商品；按光合商品ID汇总，多商品等额分摊后再计算率值、成本和 ROI。'
      : '仅诊断跨计划累计花费 ≥ ¥' + DIAGNOSIS_MIN_SPEND +
        ' 的作品；按视频ID汇总后重新计算率值、成本和 ROI，光合自然数据只计一次。';
    const tableId = filterSlug(title + attributionKey);
    const headers = [
      tableHeader('评级', 'filter'),
      tableHeader(isProduct ? '商品ID' : '视频ID', 'filter'),
      tableHeader(isProduct ? '商品名称' : '视频标题', 'filter'),
      ...(!isProduct ? [tableHeader('商品ID', 'filter')] : []),
      tableHeader('光合匹配', 'filter'),
      tableHeader('关联视频数', 'metric'),
      tableHeader('计划数', 'metric'),
      tableHeader('付费花费', 'metric', 'desc'),
      tableHeader('展现量', 'metric'),
      tableHeader('千次展现花费', 'metric'),
      tableHeader('点击率', 'metric'),
      tableHeader('点击转化率', 'metric'),
      tableHeader('成交金额', 'metric'),
      tableHeader('ROI', 'metric'),
      tableHeader('成交成本', 'metric'),
      tableHeader('直接成交金额占比', 'metric'),
      tableHeader('加购率', 'metric'),
      tableHeader('引导访问潜客占比', 'metric'),
      tableHeader('光合自然曝光', 'metric'),
      tableHeader('光合自然查看', 'metric'),
      tableHeader('光合大点击', 'metric'),
      tableHeader('光合小点击', 'metric'),
      tableHeader('光合种草成交金额', 'metric'),
      guangheGoalHeader('光合曝光点击率', 'organicExposureCtr'),
      guangheGoalHeader('光合有效查看率', 'organicValidViewRate'),
      guangheGoalHeader('光合次均停留时长', 'organicAvgDwellSeconds'),
      guangheGoalHeader('光合大点击率', 'organicBigClickRate'),
      guangheGoalHeader('光合小点击率', 'organicSmallClickRate'),
      tableHeader('光合有效查看转化率', 'metric'),
      tableHeader('光合千次查看成交金额', 'metric'),
      tableHeader('光合千次有效查看金额', 'metric'),
      tableHeader('适配角色', 'filter'),
      tableHeader('建议', 'filter'),
    ];
    return '<section class="wxt-detail-section wxt-diagnosis-section"><div class="wxt-section-heading"><div><h2>' +
      escapeHtml(title) + '</h2><p>' + escapeHtml(subtitle) + '</p></div><span class="wxt-row-count">' +
      items.length + '/' + allItems.length + ' 条</span></div>' +
      '<div class="wxt-table-scroll"><table class="wxt-report-table wxt-linked-table" data-filter-table-id="' +
      escapeHtml(tableId) + '"><thead><tr>' + headers.join('') + '</tr></thead><tbody>' +
      items.map((item) => {
        const metrics = item.metrics || {};
        const organic = item.organic || emptyOrganicMetrics();
        return '<tr class="is-grade-' + escapeHtml(item.grade) + '" data-grade="' + escapeHtml(item.grade) + '">' +
          gradeCell(item.grade, item.score) +
          tableCell(textOrDash(item.id), 'is-identity') +
          tableCell(textOrDash(isProduct ? item.productName : item.name), 'is-identity') +
          (!isProduct ? tableCell(textOrDash(item.productIdText), 'is-identity') : '') +
          tableCell(item.matchName) +
          metricCell(item.videoCount, formatInteger(item.videoCount)) +
          metricCell(item.planCount, formatInteger(item.planCount)) +
          metricCell(metrics.charge, '¥' + formatMoney(metrics.charge)) +
          metricCell(metrics.adPv, formatInteger(metrics.adPv)) +
          visualMetricCell(metrics, 'ecpm', '¥' + formatMoney(metrics.ecpm), visualScales) +
          visualMetricCell(metrics, 'ctr', formatPercent(metrics.ctr), visualScales) +
          visualMetricCell(metrics, 'cvr', formatPercent(metrics.cvr), visualScales) +
          visualMetricCell(
            metrics,
            'alipayInshopAmt',
            '¥' + formatMoney(metrics.alipayInshopAmt),
            visualScales
          ) +
          visualMetricCell(metrics, 'roi', formatDecimal(metrics.roi), visualScales) +
          metricCell(metrics.dealCost, '¥' + formatMoney(metrics.dealCost)) +
          metricCell(metrics.directAlipayAmtRate, formatPercent(metrics.directAlipayAmtRate)) +
          metricCell(metrics.cartRate, formatPercent(metrics.cartRate)) +
          visualMetricCell(
            metrics,
            'inshopPotentialUvRate',
            formatPercent(metrics.inshopPotentialUvRate),
            visualScales
          ) +
          metricCell(organic.organicExpoPv, formatInteger(organic.organicExpoPv)) +
          metricCell(organic.organicConsumePv, formatInteger(organic.organicConsumePv)) +
          metricCell(organic.organicBigClick, formatInteger(organic.organicBigClick)) +
          metricCell(organic.organicSmallClick, formatInteger(organic.organicSmallClick)) +
          metricCell(organic.organicSeedAmount, '¥' + formatMoney(organic.organicSeedAmount)) +
          guangheGoalMetricCell(
            'organicExposureCtr',
            organic.organicExposureCtr,
            formatPercent(organic.organicExposureCtr)
          ) +
          guangheGoalMetricCell(
            'organicValidViewRate',
            organic.organicValidViewRate,
            formatPercent(organic.organicValidViewRate)
          ) +
          guangheGoalMetricCell(
            'organicAvgDwellSeconds',
            organic.organicAvgDwellSeconds,
            numberOrNull(organic.organicAvgDwellSeconds) === null
              ? '-'
              : formatDecimal(organic.organicAvgDwellSeconds) + '秒'
          ) +
          guangheGoalMetricCell(
            'organicBigClickRate',
            organic.organicBigClickRate,
            formatPercent(organic.organicBigClickRate)
          ) +
          guangheGoalMetricCell(
            'organicSmallClickRate',
            organic.organicSmallClickRate,
            formatPercent(organic.organicSmallClickRate)
          ) +
          metricCell(
            organic.organicValidViewConversionRate,
            formatPercent(organic.organicValidViewConversionRate)
          ) +
          metricCell(
            organic.organicSeedAmountPerKView,
            '¥' + formatMoney(organic.organicSeedAmountPerKView)
          ) +
          metricCell(
            organic.organicSeedAmountPerKValidView,
            '¥' + formatMoney(organic.organicSeedAmountPerKValidView)
          ) +
          tableCell(item.role) +
          tableCell(item.action, 'is-identity') +
        '</tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  function diagnosisTableMarkup(title, subtitle, items, level, limit) {
    const metricsGetter = (item) => item.click || {};
    const rows = topSpendItems(items, metricsGetter, limit);
    const visualScales = buildVisualMetricScales(items, metricsGetter);
    const tableId = filterSlug(title);
    const headers = [
      tableHeader('评级', 'filter'),
      tableHeader(level === 'plan' ? '计划' : '视频主体', 'filter'),
      tableHeader('计划ID', 'filter'),
      ...(level === 'video' ? [tableHeader('计划名称', 'filter')] : []),
      tableHeader('解决方案', 'filter'),
      tableHeader('优化目标', 'filter'),
      tableHeader('出价方式', 'filter'),
      ...(level === 'video' ? [tableHeader('视频ID', 'filter')] : []),
      ...(level === 'video' ? [tableHeader('商品ID', 'filter'), tableHeader('光合匹配', 'filter')] : []),
      tableHeader('花费', 'metric', 'desc'),
      tableHeader('展现量', 'metric'),
      tableHeader('千次展现花费', 'metric'),
      tableHeader('点击率', 'metric'),
      tableHeader('点击转化率', 'metric'),
      tableHeader('成交金额', 'metric'),
      tableHeader('直接成交金额占比', 'metric'),
      tableHeader('加购率', 'metric'),
      tableHeader('引导访问潜客占比', 'metric'),
      tableHeader('ROI', 'metric'),
      tableHeader('新客成本', 'metric'),
      tableHeader('适配角色', 'filter'),
      tableHeader('归因判断', 'filter'),
      tableHeader('建议动作', 'filter'),
    ];
    return '<section class="wxt-detail-section wxt-diagnosis-section"><div class="wxt-section-heading"><div><h2>' +
      escapeHtml(title) + '</h2><p>' + escapeHtml(subtitle) + '</p></div><span class="wxt-row-count">' +
      rows.length + '/' + items.length + ' 条</span></div>' +
      '<div class="wxt-table-scroll"><table class="wxt-report-table wxt-diagnosis-table" data-filter-table-id="' + escapeHtml(tableId) + '"><thead><tr>' +
      headers.join('') + '</tr></thead><tbody>' + rows.map((item) => {
        const row = item.click || {};
        return '<tr class="is-grade-' + escapeHtml(item.grade) + '" data-grade="' + escapeHtml(item.grade) + '">' +
          gradeCell(item.grade, item.score) +
          tableCell(rowName(item), 'is-identity') +
          tableCell(textOrDash(row.campaignId)) +
          (level === 'video' ? tableCell(textOrDash(row.campaignName), 'is-identity') : '') +
          tableCell(textOrDash(row.solutionName)) +
          tableCell(textOrDash(row.optimizationTarget)) +
          tableCell(textOrDash(row.bidMode)) +
          (level === 'video' ? tableCell(textOrDash(row.videoId)) : '') +
          (level === 'video' ? tableCell(textOrDash(row.productIdText), 'is-identity') : '') +
          (level === 'video' ? tableCell(textOrDash(row.guangheMatchName)) : '') +
          metricCell(row.charge, '¥' + formatMoney(row.charge)) +
          metricCell(row.adPv, formatInteger(row.adPv)) +
          visualMetricCell(row, 'ecpm', '¥' + formatMoney(row.ecpm), visualScales) +
          visualMetricCell(row, 'ctr', formatPercent(normalizedRate(row.ctr)), visualScales) +
          visualMetricCell(row, 'cvr', formatPercent(normalizedRate(row.cvr)), visualScales) +
          visualMetricCell(
            row,
            'alipayInshopAmt',
            '¥' + formatMoney(row.alipayInshopAmt),
            visualScales
          ) +
          metricCell(row.directAlipayAmtRate, formatPercent(row.directAlipayAmtRate)) +
          metricCell(row.cartRate, formatPercent(row.cartRate)) +
          visualMetricCell(
            row,
            'inshopPotentialUvRate',
            formatPercent(normalizedRate(row.inshopPotentialUvRate)),
            visualScales
          ) +
          visualMetricCell(row, 'roi', formatDecimal(row.roi), visualScales) +
          metricCell(row.liveVideoNewCost, '¥' + formatMoney(row.liveVideoNewCost)) +
          tableCell(item.role) +
          tableCell(item.attribution) +
          tableCell(item.action, 'is-identity') +
        '</tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  function aggregateTableMarkup(title, subtitle, rawItems, nameHeader) {
    const allItems = gradeAggregates(rawItems);
    const metricsGetter = (item) => item.metrics || {};
    const items = topSpendItems(allItems, metricsGetter);
    const visualScales = buildVisualMetricScales(allItems, metricsGetter);
    const tableId = filterSlug(title);
    const totalCharge = sumMetric(allItems.map((entry) => entry.metrics), 'charge');
    const headers = [
      tableHeader('评级', 'filter'),
      tableHeader(nameHeader, 'filter'),
      tableHeader('计划数', 'metric'),
      tableHeader('花费', 'metric', 'desc'),
      tableHeader('花费占比', 'metric'),
      tableHeader('展现量', 'metric'),
      tableHeader('千次展现花费', 'metric'),
      tableHeader('点击率', 'metric'),
      tableHeader('点击转化率', 'metric'),
      tableHeader('成交金额', 'metric'),
      tableHeader('ROI', 'metric'),
      tableHeader('成交成本', 'metric'),
      tableHeader('直接成交金额占比', 'metric'),
      tableHeader('加购率', 'metric'),
      tableHeader('引导访问潜客占比', 'metric'),
      tableHeader('新客成本', 'metric'),
      tableHeader('建议', 'filter'),
    ];
    return '<section class="wxt-detail-section wxt-diagnosis-section"><div class="wxt-section-heading"><div><h2>' +
      escapeHtml(title) + '</h2><p>' + escapeHtml(subtitle) + '</p></div><span class="wxt-row-count">' +
      items.length + '/' + allItems.length + ' 类</span></div>' +
      '<div class="wxt-table-scroll"><table class="wxt-report-table wxt-aggregate-table" data-filter-table-id="' + escapeHtml(tableId) + '"><thead><tr>' +
      headers.join('') + '</tr></thead><tbody>' + items.map((item) => {
        const metrics = item.metrics;
        return '<tr class="is-grade-' + escapeHtml(item.grade) + '" data-grade="' + escapeHtml(item.grade) + '">' +
          gradeCell(item.grade, item.score) +
          tableCell(item.name, 'is-identity') +
          metricCell(item.planCount, formatInteger(item.planCount)) +
          metricCell(metrics.charge, '¥' + formatMoney(metrics.charge)) +
          metricCell(ratio(metrics.charge, totalCharge), formatPercent(ratio(metrics.charge, totalCharge))) +
          metricCell(metrics.adPv, formatInteger(metrics.adPv)) +
          visualMetricCell(metrics, 'ecpm', '¥' + formatMoney(metrics.ecpm), visualScales) +
          visualMetricCell(metrics, 'ctr', formatPercent(metrics.ctr), visualScales) +
          visualMetricCell(metrics, 'cvr', formatPercent(metrics.cvr), visualScales) +
          visualMetricCell(
            metrics,
            'alipayInshopAmt',
            '¥' + formatMoney(metrics.alipayInshopAmt),
            visualScales
          ) +
          visualMetricCell(metrics, 'roi', formatDecimal(metrics.roi), visualScales) +
          metricCell(metrics.dealCost, '¥' + formatMoney(metrics.dealCost)) +
          metricCell(metrics.directAlipayAmtRate, formatPercent(metrics.directAlipayAmtRate)) +
          metricCell(metrics.cartRate, formatPercent(metrics.cartRate)) +
          visualMetricCell(
            metrics,
            'inshopPotentialUvRate',
            formatPercent(metrics.inshopPotentialUvRate),
            visualScales
          ) +
          metricCell(metrics.newCost, '¥' + formatMoney(metrics.newCost)) +
          tableCell(item.action, 'is-identity') +
        '</tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  function deliveryDiagnosisMarkup(diagnosis) {
    const diagnostics = deliveryDiagnostics(diagnosis);
    return '<section class="wxt-delivery-diagnosis">' +
      '<div class="wxt-section-heading"><div><h2>投放方式诊断</h2>' +
      '<p>仅使用花费 ≥ ¥' + DIAGNOSIS_MIN_SPEND +
      ' 的计划，按投放组合汇总后计算率值、占比、成本和 ROI。</p></div></div>' +
      aggregateInsightCards(diagnostics) +
      aggregateTableMarkup('按投放组合汇总', '解决方案 / 优化目标 / 出价方式的组合效率排行。', diagnostics.byCombo, '投放组合') +
    '</section>';
  }

  function organicPerformance(item) {
    const organic = item && item.organic || emptyOrganicMetrics();
    const active = ORGANIC_SUM_FIELDS.some((field) => (numberOrNull(organic[field]) || 0) > 0);
    const met = active ? Object.entries(GUANGHE_METRIC_GOALS).reduce((count, [key, definition]) => (
      count + ((numberOrNull(organic[key]) || 0) >= definition.goal ? 1 : 0)
    ), 0) : 0;
    return { active, met, strong: active && met >= 3, weak: !active || met <= 1 };
  }

  function actionableEntityId(value) {
    const text = String(value == null ? '' : value).trim();
    return text && text !== '-' && !/^未(?:识别|匹配)/.test(text);
  }

  function paidSampleConfidence(metrics) {
    const source = metrics || {};
    const clicks = numberOrNull(source.click) || 0;
    const deals = numberOrNull(source.alipayInshopNum) || 0;
    if (clicks >= 100 || deals >= 10) return 'high';
    if (clicks >= 20 || deals >= 3) return 'medium';
    return 'low';
  }

  function organicSampleConfidence(metrics, sampleField) {
    const source = metrics || {};
    const field = sampleField === 'organicExpoPv' ? 'organicExpoPv' : 'organicConsumePv';
    const sample = numberOrNull(source[field]) || 0;
    const highLine = field === 'organicExpoPv' ? 5000 : 1000;
    const mediumLine = field === 'organicExpoPv' ? 500 : 200;
    if (sample >= highLine) return 'high';
    if (sample >= mediumLine) return 'medium';
    return 'low';
  }

  function confidenceRank(level) {
    return level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  }

  function lowerConfidence(left, right) {
    return confidenceRank(left) <= confidenceRank(right) ? left : right;
  }

  function confidenceLabel(level) {
    return level === 'high' ? '高' : level === 'medium' ? '中' : '低';
  }

  function diagnosisStatusLabel(tone) {
    if (tone === 'good') return '表现健康';
    if (tone === 'bad') return '优先优化';
    if (tone === 'watch') return '持续观察';
    return '样本不足';
  }

  function aggregateOrganicSummaries(items) {
    const organic = emptyOrganicMetrics();
    (Array.isArray(items) ? items : []).forEach((item) => {
      addOrganicMetrics(organic, item && item.organic, 1);
    });
    return finalizeOrganicMetrics(organic);
  }

  function organicGoalCount(metrics, keys) {
    return keys.reduce((count, key) => {
      const definition = GUANGHE_METRIC_GOALS[key];
      const value = numberOrNull(metrics && metrics[key]);
      return count + (definition && value !== null && value >= definition.goal ? 1 : 0);
    }, 0);
  }

  function goalDimensionTone(metrics, keys, active) {
    if (!active) return 'neutral';
    const met = organicGoalCount(metrics, keys);
    if (met === keys.length) return 'good';
    if (met === 0) return 'bad';
    return 'watch';
  }

  function countByGrade(items, grades) {
    return (Array.isArray(items) ? items : []).filter((item) => grades.includes(item.grade)).length;
  }

  function paidMetricRoi(metrics) {
    const source = metrics || {};
    const original = numberOrNull(source.roi);
    return original === null ? ratio(source.alipayInshopAmt, source.charge) : original;
  }

  function roiBenchmarkStats(items, metricsGetter, overallRoi) {
    const active = (Array.isArray(items) ? items : []).filter((item) => {
      const metrics = metricsGetter(item) || {};
      return (numberOrNull(metrics.charge) || 0) > 0;
    });
    const canBenchmark = numberOrNull(overallRoi) !== null && overallRoi > 0;
    const qualified = canBenchmark ? active.filter((item) => {
      const metrics = metricsGetter(item) || {};
      const roi = paidMetricRoi(metrics);
      return roi !== null && roi >= overallRoi;
    }) : [];
    const totalSpend = active.reduce((sum, item) => (
      sum + (numberOrNull((metricsGetter(item) || {}).charge) || 0)
    ), 0);
    const qualifiedSpend = qualified.reduce((sum, item) => (
      sum + (numberOrNull((metricsGetter(item) || {}).charge) || 0)
    ), 0);
    return {
      active,
      qualified,
      qualifiedRate: ratio(qualified.length, active.length),
      qualifiedSpend,
      qualifiedSpendRate: ratio(qualifiedSpend, totalSpend),
      totalSpend,
      canBenchmark,
    };
  }

  function rateText(value) {
    return formatPercent(normalizedRate(value));
  }

  function lowSpendSampleItems(allPlans, allProducts, allWorks) {
    const typeOrder = { '计划': 0, '商品': 1, '作品': 2 };
    return [
      ...(Array.isArray(allPlans) ? allPlans : [])
        .filter((row) => !meetsDiagnosisSpend(row))
        .map((row) => ({
          type: '计划',
          id: normalizeLinkedId(row && row.campaignId) || '未识别',
          charge: numberOrNull(row && row.charge) || 0,
        })),
      ...(Array.isArray(allProducts) ? allProducts : [])
        .filter((item) => !meetsDiagnosisSpend(item && item.metrics))
        .map((item) => ({
          type: '商品',
          id: normalizeLinkedId(item && item.id) || '未识别',
          charge: numberOrNull(item && item.metrics && item.metrics.charge) || 0,
        })),
      ...(Array.isArray(allWorks) ? allWorks : [])
        .filter((item) => !meetsDiagnosisSpend(item && item.metrics))
        .map((item) => ({
          type: '作品',
          id: normalizeLinkedId(item && item.id) || '未识别',
          charge: numberOrNull(item && item.metrics && item.metrics.charge) || 0,
        })),
    ].sort((left, right) => (
      typeOrder[left.type] - typeOrder[right.type] || right.charge - left.charge
    ));
  }

  function buildShortVideoDiagnosticModel(data, diagnosis, attributionKey) {
    const allProducts = paidSummaryCandidates(data, attributionKey, 'product');
    const allWorks = paidSummaryCandidates(data, attributionKey, 'video');
    const allPlans = selectedAttributionRows(data, 'plan', attributionKey);
    const products = gradedPaidSummaries(data, attributionKey, 'product');
    const works = gradedPaidSummaries(data, attributionKey, 'video');
    const lowSpendItems = lowSpendSampleItems(allPlans, allProducts, allWorks);
    const sampleScope = {
      excludedPlans: allPlans.filter((row) => !meetsDiagnosisSpend(row)).length,
      excludedProducts: allProducts.filter((item) => !meetsDiagnosisSpend(item.metrics)).length,
      excludedWorks: allWorks.filter((item) => !meetsDiagnosisSpend(item.metrics)).length,
      lowSpendItems,
    };
    const validProducts = products.filter((item) => actionableEntityId(item.id));
    const organicWorks = works.filter((item) => organicPerformance(item).active);
    const organic = aggregateOrganicSummaries(organicWorks);
    const accountPaid = aggregateRows(allPlans);
    const diagnosticPaid = aggregateRows(diagnosis.plans.map((item) => item.click || {}));
    const hasAccountPaid = accountPaid.charge > 0 || accountPaid.click > 0 || accountPaid.alipayInshopNum > 0;
    const hasPaid = diagnosticPaid.charge > 0 || diagnosticPaid.click > 0 || diagnosticPaid.alipayInshopNum > 0;
    const hasOrganic = organicWorks.length > 0 && (
      organic.organicExpoPv > 0 || organic.organicConsumePv > 0
    );

    const strongProducts = validProducts.filter((item) => ['S', 'A'].includes(item.grade));
    const weakProducts = validProducts.filter((item) => ['C', 'D'].includes(item.grade));
    const organicProducts = validProducts.filter((item) => organicPerformance(item).strong);
    const strongWorks = works.filter((item) => ['S', 'A'].includes(item.grade));
    const weakWorks = works.filter((item) => ['C', 'D'].includes(item.grade));
    const strongPlans = diagnosis.plans.filter((item) => ['S', 'A'].includes(item.grade));
    const weakPlans = diagnosis.plans.filter((item) => ['C', 'D'].includes(item.grade));
    const doubleStrongWorks = works.filter((item) => (
      ['S', 'A'].includes(item.grade) && organicPerformance(item).strong
    ));
    const organicOpportunities = works.filter((item) => (
      !['S', 'A'].includes(item.grade) && organicPerformance(item).strong
    ));
    const paidDependentWorks = works.filter((item) => (
      ['S', 'A'].includes(item.grade) && organicPerformance(item).weak
    ));

    const paidConfidence = paidSampleConfidence(diagnosticPaid);
    const planRoiStats = roiBenchmarkStats(diagnosis.plans, (item) => item.click, accountPaid.roi);
    const workRoiStats = roiBenchmarkStats(works, (item) => item.metrics, accountPaid.roi);
    const roiSpendShares = [planRoiStats.qualifiedSpendRate, workRoiStats.qualifiedSpendRate]
      .map((value) => numberOrNull(value))
      .filter((value) => value !== null);
    const accountQualifiedSpendRate = roiSpendShares.length
      ? roiSpendShares.reduce((sum, value) => sum + value, 0) / roiSpendShares.length
      : null;
    const accountTone = !hasAccountPaid || !planRoiStats.canBenchmark || !planRoiStats.active.length
      ? 'neutral'
      : accountQualifiedSpendRate >= 0.65
        ? 'good'
        : accountQualifiedSpendRate < 0.45
          ? 'bad'
          : 'watch';
    const accountConclusion = accountTone === 'neutral'
      ? '账户尚未形成可用的整体投产基准，暂不能判断付费效率结构。'
      : accountTone === 'good'
        ? '预算主要集中在不低于账户整体 ROI 的计划和作品，账户付费结构相对健康。'
        : accountTone === 'bad'
          ? '较多预算落在低于账户整体 ROI 的单元，整体投产可能依赖少数高效率计划或作品拉动。'
          : '账户内高低效率单元并存，预算仍需逐步向不低于整体 ROI 的单元集中。';
    const organicAcquisitionConfidence = organicSampleConfidence(organic, 'organicExpoPv');
    const organicContentConfidence = organicSampleConfidence(organic, 'organicConsumePv');
    const matchedTotal = works.length;
    const matchedCount = works.filter((item) => item.matched).length;
    const matchRate = ratio(matchedCount, matchedTotal);
    const synergyConfidence = hasPaid && hasOrganic
      ? lowerConfidence(paidConfidence, organicContentConfidence)
      : 'low';

    const acquisitionKeys = ['organicExposureCtr'];
    const retentionKeys = ['organicValidViewRate', 'organicAvgDwellSeconds'];
    const interestKeys = ['organicBigClickRate', 'organicSmallClickRate'];
    const acquisitionTone = goalDimensionTone(organic, acquisitionKeys, hasOrganic);
    const retentionTone = goalDimensionTone(organic, retentionKeys, hasOrganic);
    const interestTone = goalDimensionTone(organic, interestKeys, hasOrganic);

    const strongWorkRate = ratio(strongWorks.length, works.length) || 0;
    const weakWorkRate = ratio(weakWorks.length, works.length) || 0;
    const paidTone = !hasPaid
      ? 'neutral'
      : strongWorkRate >= 0.3 && strongWorks.length > weakWorks.length
        ? 'good'
        : weakWorkRate >= 0.45 && weakWorks.length > strongWorks.length
          ? 'bad'
          : 'watch';
    const productTone = !validProducts.length
      ? 'neutral'
      : strongProducts.length > weakProducts.length && strongProducts.length >= Math.ceil(validProducts.length * 0.3)
        ? 'good'
        : weakProducts.length >= Math.ceil(validProducts.length * 0.45) && weakProducts.length > strongProducts.length
          ? 'bad'
          : 'watch';
    const planTone = !diagnosis.plans.length
      ? 'neutral'
      : strongPlans.length > weakPlans.length && strongPlans.length >= Math.ceil(diagnosis.plans.length * 0.3)
        ? 'good'
        : weakPlans.length >= Math.ceil(diagnosis.plans.length * 0.45) && weakPlans.length >= strongPlans.length
          ? 'bad'
          : 'watch';
    const synergyTone = !hasPaid || !hasOrganic
      ? 'neutral'
      : doubleStrongWorks.length >= Math.max(1, Math.ceil(organicWorks.length * 0.2)) &&
        doubleStrongWorks.length >= paidDependentWorks.length
        ? 'good'
        : paidDependentWorks.length >= Math.max(2, Math.ceil(works.length * 0.25)) &&
          paidDependentWorks.length > doubleStrongWorks.length
          ? 'bad'
          : 'watch';

    const clickPlanRows = shortVideoDetailRows(data, 'plan', 'click', '点击效果归因')
      .filter((row) => meetsDiagnosisSpend(row));
    const displayPlanRows = shortVideoDetailRows(data, 'plan', 'display', '展现效果归因')
      .filter((row) => meetsDiagnosisSpend(row));
    const roleCounts = diagnosis.plans.reduce((counts, item) => {
      if (/引流转化兼顾/.test(item.role)) counts.balanced += 1;
      else if (/引流/.test(item.role)) counts.traffic += 1;
      else if (/转化/.test(item.role)) counts.conversion += 1;
      else counts.unclear += 1;
      return counts;
    }, { traffic: 0, conversion: 0, balanced: 0, unclear: 0 });
    const attributionConfidence = clickPlanRows.length && displayPlanRows.length
      ? (Math.min(clickPlanRows.length, displayPlanRows.length) >= 5 ? 'high' : 'medium')
      : 'low';
    const attributionTone = attributionConfidence === 'low'
      ? 'neutral'
      : roleCounts.unclear > diagnosis.plans.length / 2
        ? 'watch'
        : 'good';
    let attributionConclusion = '点击与展现两种归因数据不足，暂不能可靠判断计划角色。';
    if (attributionConfidence !== 'low') {
      const leading = [
        ['引流型计划', roleCounts.traffic],
        ['转化型计划', roleCounts.conversion],
        ['引流转化兼顾计划', roleCounts.balanced],
      ].sort((left, right) => right[1] - left[1])[0];
      attributionConclusion = leading[1] > 0
        ? '当前计划结构以' + leading[0] + '为主，预算分工已有可识别倾向。'
        : '当前计划的点击与展现差异不明显，角色仍需继续观察。';
    }

    const dimensions = [
      {
        title: '内容获取',
        tone: acquisitionTone,
        confidence: organicAcquisitionConfidence,
        conclusion: acquisitionTone === 'neutral'
          ? '自然曝光样本不足，暂不能判断封面与首屏吸引力。'
          : acquisitionTone === 'good'
            ? '曝光点击率达到光合参考值，内容具备进入播放链路的能力。'
            : '曝光点击率低于光合参考值，前链路获客是当前短板。',
        evidence: '曝光 ' + formatInteger(organic.organicExpoPv) + '，曝光点击率 ' +
          rateText(organic.organicExposureCtr) + '（参考值 ≥ 3%）。',
        cause: acquisitionTone === 'good'
          ? '封面、标题与首屏卖点暂未见明显短板，后续重点观察留存和商品兴趣。'
          : '可能与封面辨识度、标题利益点、首屏卖点或人群匹配不足有关。',
      },
      {
        title: '内容留存',
        tone: retentionTone,
        confidence: organicContentConfidence,
        conclusion: retentionTone === 'neutral'
          ? '有效查看样本不足，暂不能判断前3秒与内容节奏。'
          : retentionTone === 'good'
            ? '有效查看率和停留时长均达标，内容承接较稳定。'
            : retentionTone === 'bad'
              ? '有效查看率和停留时长均未达标，播放后的流失较明显。'
              : '留存指标一项达标、一项偏弱，内容承接存在局部短板。',
        evidence: '有效查看率 ' + rateText(organic.organicValidViewRate) + '（参考值 ≥ 40%），平均停留 ' +
          formatDecimal(organic.organicAvgDwellSeconds) + ' 秒（参考值 ≥ 6 秒）。',
        cause: retentionTone === 'good'
          ? '前3秒与内容节奏能够承接点击，下一步应检查商品兴趣与成交效率。'
          : '可能与前3秒进入主题慢、信息密度不足、演示节奏或卖点展开顺序有关。',
      },
      {
        title: '商品兴趣',
        tone: interestTone,
        confidence: organicContentConfidence,
        conclusion: interestTone === 'neutral'
          ? '自然查看样本不足，暂不能判断内容对商品兴趣的带动。'
          : interestTone === 'good'
            ? '大点击率和小点击率均达标，内容到商品的兴趣承接较好。'
            : interestTone === 'bad'
              ? '两类商品点击率均未达标，内容看完后商品兴趣不足。'
              : '商品兴趣指标部分达标，承接链路仍有优化空间。',
        evidence: '大点击率 ' + rateText(organic.organicBigClickRate) + '（参考值 ≥ 5%），小点击率 ' +
          rateText(organic.organicSmallClickRate) + '（参考值 ≥ 1%）。',
        cause: interestTone === 'good'
          ? '内容卖点与商品承接基本一致，可继续验证价格力和详情页转化。'
          : '可能与商品露出过晚、利益点不清晰、价格权益或内容与详情页预期不一致有关。',
      },
      {
        title: '付费转化效率',
        tone: paidTone,
        confidence: paidConfidence,
        conclusion: paidTone === 'neutral'
          ? '付费点击与成交样本不足，暂不能判断投放效率。'
          : paidTone === 'good'
            ? '相对本账号同期同层级数据，高效作品占比更高。'
            : paidTone === 'bad'
              ? '相对低效作品占比较高，付费效率存在结构性压力。'
              : '作品付费效率分化，需要把预算从低效单元向已验证单元集中。',
        evidence: '作品 S/A ' + formatInteger(strongWorks.length) + '，C/D ' + formatInteger(weakWorks.length) +
          '；合格样本 ROI ' + formatDecimal(diagnosticPaid.roi) + '，CTR ' + rateText(diagnosticPaid.ctr) +
          '，CVR ' + rateText(diagnosticPaid.cvr) + '。',
        cause: paidTone === 'good'
          ? '当前相对高效作品已形成一定规模，但是否盈利仍需结合毛利与目标 ROI。'
          : '可能由素材效率、定向、人群、出价和商品承接差异共同造成，应在明细表中按 ID 排查。',
      },
      {
        title: '免费付费协同',
        tone: synergyTone,
        confidence: synergyConfidence,
        conclusion: synergyTone === 'neutral'
          ? '免费或付费一侧样本不足，暂不能形成完整协同判断。'
          : synergyTone === 'good'
            ? '已有免费与付费双强作品，内容资产具备复制价值。'
            : synergyTone === 'bad'
              ? '增长偏付费驱动，自然内容竞争力尚未同步建立。'
              : '免费与付费表现尚未形成稳定对应关系，仍处于筛选期。',
        evidence: '双强作品 ' + formatInteger(doubleStrongWorks.length) + '，自然强待投 ' +
          formatInteger(organicOpportunities.length) + '，付费强自然弱 ' +
          formatInteger(paidDependentWorks.length) + '；光合匹配 ' + formatInteger(matchedCount) + '/' +
          formatInteger(matchedTotal) + '。',
        cause: synergyTone === 'good'
          ? '内容本身与付费放大同时有效，可优先复制同类脚本与商品组合。'
          : '可能存在自然内容基础弱、付费选择未优先使用自然优质作品，或两端 ID 匹配覆盖不足。',
      },
      {
        title: '商品结构',
        tone: productTone,
        confidence: paidConfidence,
        conclusion: productTone === 'neutral'
          ? '可识别商品不足，暂不能判断商品投放结构。'
          : productTone === 'good'
            ? '高效商品数量高于低效商品，商品投放结构相对健康。'
            : productTone === 'bad'
              ? '低效商品占比较高，商品池需要收敛和分层验证。'
              : '商品效率分化，适合按商品 ID 分层配置预算和素材。',
        evidence: '已识别商品 ' + formatInteger(validProducts.length) + '，S/A ' +
          formatInteger(strongProducts.length) + '，C/D ' + formatInteger(weakProducts.length) +
          '，自然表现达标 ' + formatInteger(organicProducts.length) + '。',
        cause: productTone === 'good'
          ? '高效商品可继续扩充作品供给，同时监控边际成本。'
          : '可能与商品价格力、详情页承接、素材供给数量或投放人群适配度有关。',
      },
      {
        title: '计划与归因角色',
        tone: planTone === 'bad' ? 'bad' : attributionTone === 'neutral' ? 'neutral' : planTone,
        confidence: lowerConfidence(paidConfidence, attributionConfidence),
        conclusion: planTone === 'neutral'
          ? '计划样本不足，暂不能判断预算结构。'
          : (weakPlans.length >= strongPlans.length
              ? '低效计划不低于高效计划，预算结构需要收敛。'
              : '高效计划多于低效计划，预算结构具备继续优化基础。') + ' ' + attributionConclusion,
        evidence: '计划 S/A ' + formatInteger(strongPlans.length) + '，C/D ' + formatInteger(weakPlans.length) +
          '；引流 ' + formatInteger(roleCounts.traffic) + '，转化 ' + formatInteger(roleCounts.conversion) +
          '，兼顾 ' + formatInteger(roleCounts.balanced) + '，暂不明确 ' + formatInteger(roleCounts.unclear) + '。',
        cause: attributionConfidence === 'low'
          ? '点击或展现归因口径缺失，角色结论仅供参考，需补齐两种归因数据。'
          : '展现归因更强通常对应种草辅助，点击归因更强通常对应直接转化；应按角色分配预算而非混用同一目标。',
      },
    ];

    let coreTone = 'watch';
    let coreConclusion = '当前处于结构优化阶段，免费内容与付费投放均有可继续验证的单元。';
    if (!hasPaid && !hasOrganic) {
      coreTone = 'neutral';
      coreConclusion = '免费与付费样本均不足，本次只能核对数据完整性，暂不输出经营结论。';
    } else if (!hasOrganic) {
      coreTone = 'neutral';
      coreConclusion = '付费数据已形成样本，但自然内容未匹配或查看样本不足，当前不能判断内容自身竞争力。';
    } else if (!hasPaid) {
      coreTone = 'neutral';
      coreConclusion = '自然内容可以评估，但付费消耗与成交样本不足，当前不能判断投放放大效率。';
    } else if (synergyTone === 'bad') {
      coreTone = 'bad';
      coreConclusion = '当前增长偏付费驱动：高效付费作品尚未同步形成自然内容竞争力。';
    } else if (organicOpportunities.length >= Math.max(2, doubleStrongWorks.length + 1)) {
      coreTone = 'watch';
      coreConclusion = '自然内容中已有待放大资产，但付费选择与预算承接尚未充分跟上。';
    } else if (synergyTone === 'good') {
      coreTone = 'good';
      coreConclusion = '免费与付费已形成有效协同，可围绕双强作品复制商品与计划组合。';
    } else if (planTone === 'bad' || productTone === 'bad') {
      coreTone = 'bad';
      coreConclusion = '投放效率分化明显，预算和商品池需要先收敛，再扩大已验证单元。';
    }
    const overallConfidence = hasPaid && hasOrganic
      ? lowerConfidence(paidConfidence, lowerConfidence(organicContentConfidence, synergyConfidence))
      : 'low';

    return {
      products,
      works,
      validProducts,
      strongProducts,
      weakProducts,
      organicProducts,
      strongWorks,
      weakWorks,
      strongPlans,
      weakPlans,
      doubleStrongWorks,
      organicOpportunities,
      paidDependentWorks,
      dimensions,
      account: {
        tone: accountTone,
        conclusion: accountConclusion,
        confidence: paidConfidence,
        paid: accountPaid,
        diagnosticPaid,
        planRoiStats,
        workRoiStats,
        qualifiedSpendRate: accountQualifiedSpendRate,
      },
      sampleScope,
      coreTone,
      coreConclusion,
      overallConfidence,
      evidence: [
        '作品 ' + formatInteger(works.length) + ' 个，其中付费 S/A ' + formatInteger(strongWorks.length) +
          '、C/D ' + formatInteger(weakWorks.length) + '。',
        '自然有效样本作品 ' + formatInteger(organicWorks.length) + '/' + formatInteger(works.length) +
          '，五率聚合达标 ' + formatInteger(organicGoalCount(organic, Object.keys(GUANGHE_METRIC_GOALS))) + '/5。',
        '免费付费双强 ' + formatInteger(doubleStrongWorks.length) + '，付费强自然弱 ' +
          formatInteger(paidDependentWorks.length) + '，自然强待投 ' + formatInteger(organicOpportunities.length) + '。',
        '已排除花费低于 ¥' + DIAGNOSIS_MIN_SPEND + ' 的低样本：计划 ' +
          formatInteger(sampleScope.excludedPlans) + '、商品 ' + formatInteger(sampleScope.excludedProducts) +
          '、作品 ' + formatInteger(sampleScope.excludedWorks) + '。',
      ],
      methodology: '账户花费、成交金额和整体 ROI 使用全量数据；花费低于 ¥' + DIAGNOSIS_MIN_SPEND +
        ' 的计划、商品和作品单列为样本不足，不参与评分、排名、ROI 达标统计与操作建议。光合五率使用固定参考值，万相台按合格样本的本账号同期同层级中位数做相对诊断。未接入毛利、目标 ROI 与目标获客成本，因此不直接判断盈利或给出强制停投结论。',
      matchRate,
    };
  }

  function overallDiagnosisMarkup(data, diagnosis, attributionKey) {
    const model = buildShortVideoDiagnosticModel(data, diagnosis, attributionKey);
    return '<div class="wxt-overall-diagnosis"><div class="wxt-overall-heading"><h3>整体诊断</h3>' +
      '<span>光合免费流量 + 万相台付费效果</span></div>' +
      '<section class="wxt-account-diagnosis is-' + escapeHtml(model.account.tone) + '">' +
      '<header><div><span>账户级付费诊断</span><strong>' + escapeHtml(model.account.conclusion) + '</strong></div>' +
      '<b>置信度：' + escapeHtml(confidenceLabel(model.account.confidence)) + '</b></header>' +
      '<div class="wxt-account-kpis">' +
      '<div><span>账户总花费</span><strong>¥' + escapeHtml(formatMoney(model.account.paid.charge)) + '</strong></div>' +
      '<div><span>账户总成交金额</span><strong>¥' + escapeHtml(formatMoney(model.account.paid.alipayInshopAmt)) + '</strong></div>' +
      '<div><span>账户整体 ROI</span><strong>' + escapeHtml(formatDecimal(model.account.paid.roi)) + '</strong></div>' +
      '<div><span>ROI 达标计划</span><strong>' + escapeHtml(formatInteger(model.account.planRoiStats.qualified.length)) + '/' +
      escapeHtml(formatInteger(model.account.planRoiStats.active.length)) + '</strong></div>' +
      '<div><span>ROI 达标作品</span><strong>' + escapeHtml(formatInteger(model.account.workRoiStats.qualified.length)) + '/' +
      escapeHtml(formatInteger(model.account.workRoiStats.active.length)) + '</strong></div></div>' +
      '<p><b>数据证据</b>达标计划消耗占比 ' + escapeHtml(rateText(model.account.planRoiStats.qualifiedSpendRate)) +
      '，达标作品消耗占比 ' + escapeHtml(rateText(model.account.workRoiStats.qualifiedSpendRate)) +
      '。账户汇总使用全量数据；计划与作品达标统计仅纳入花费 ≥ ¥' + DIAGNOSIS_MIN_SPEND +
      ' 的对象，达标线参考账户整体 ROI（' + escapeHtml(formatDecimal(model.account.paid.roi)) +
      '）。这是账户内相对标准，不等同于利润达标。</p></section>' +
      '<section class="wxt-core-diagnosis is-' + escapeHtml(model.coreTone) + '"><div class="wxt-core-heading">' +
      '<span>核心诊断</span><b>综合置信度：' + escapeHtml(confidenceLabel(model.overallConfidence)) + '</b></div>' +
      '<strong>' + escapeHtml(model.coreConclusion) + '</strong><ul>' +
      model.evidence.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') +
      '</ul><p>' + escapeHtml(model.methodology) + '</p></section>' +
      '<div class="wxt-diagnosis-matrix">' + model.dimensions.map((item) => (
        '<article class="is-' + escapeHtml(item.tone) + '"><header><h4>' + escapeHtml(item.title) +
        '</h4><span>' + escapeHtml(diagnosisStatusLabel(item.tone)) + '</span></header>' +
        '<strong>' + escapeHtml(item.conclusion) + '</strong>' +
        '<p><b>数据证据</b>' + escapeHtml(item.evidence) + '</p>' +
        '<p><b>可能原因</b>' + escapeHtml(item.cause) + '</p>' +
        '<footer>置信度：' + escapeHtml(confidenceLabel(item.confidence)) + '</footer></article>'
      )).join('') + '</div></div>';
  }

  function lowSpendAdviceMarkup(sampleScope) {
    const items = sampleScope && Array.isArray(sampleScope.lowSpendItems)
      ? sampleScope.lowSpendItems
      : [];
    if (!items.length) return '';
    return '<section class="wxt-low-sample-actions"><div class="wxt-low-sample-heading"><div><h3>样本不足，暂不诊断</h3>' +
      '<p>以下对象保留在账户全量汇总和原始数据中，但累计花费低于 ¥' + DIAGNOSIS_MIN_SPEND +
      '，不进入评分、排名及放量/收缩建议。</p></div><span>' + formatInteger(items.length) + ' 项</span></div>' +
      '<div class="wxt-table-scroll"><table class="wxt-report-table wxt-low-sample-table"><thead><tr>' +
      '<th>维度</th><th>ID</th><th>累计花费</th><th>诊断状态</th></tr></thead><tbody>' +
      items.map((item) => '<tr>' +
        tableCell(item.type) +
        tableCell(item.id, 'is-identity') +
        metricCell(item.charge, '¥' + formatMoney(item.charge)) +
        tableCell('样本不足，暂不诊断', 'is-identity') +
      '</tr>').join('') + '</tbody></table></div></section>';
  }

  function actionListMarkup(data, diagnosis, attributionKey) {
    const model = buildShortVideoDiagnosticModel(data, diagnosis, attributionKey);
    const products = model.validProducts;
    const works = model.works.filter((item) => actionableEntityId(item.id));
    const actions = [];
    const seenActions = new Set();
    function addAction(text) {
      if (!text || seenActions.has(text)) return;
      seenActions.add(text);
      actions.push(text);
    }
    function confidenceSuffix(metrics) {
      return '（样本置信度：' + confidenceLabel(paidSampleConfidence(metrics)) + '）';
    }
    works.filter((item) => ['S', 'A'].includes(item.grade) && organicPerformance(item).strong)
      .slice(0, 3).forEach((item) => {
        addAction('双强作品：作品ID ' + textOrDash(item.id) + '，自然与付费均达标，优先复制到同类商品和计划。' +
          confidenceSuffix(item.metrics));
      });
    works.filter((item) => !['S', 'A'].includes(item.grade) && organicPerformance(item).strong)
      .slice(0, 2).forEach((item) => {
        addAction('自然强作品：作品ID ' + textOrDash(item.id) + '，先优化定向、出价或商品承接，再扩大付费量。' +
          confidenceSuffix(item.metrics));
      });
    works.filter((item) => ['S', 'A'].includes(item.grade) && organicPerformance(item).weak)
      .slice(0, 2).forEach((item) => {
        addAction('付费驱动作品：作品ID ' + textOrDash(item.id) + '，付费效率高但自然信号弱，同步优化封面、前3秒和卖点表达。' +
          confidenceSuffix(item.metrics));
      });
    products.filter((item) => ['S', 'A'].includes(item.grade)).slice(0, 2).forEach((item) => {
      const confidence = paidSampleConfidence(item.metrics);
      addAction((confidence === 'low' ? '验证商品：商品ID ' : '放量商品：商品ID ') + textOrDash(item.id) +
        (confidence === 'low'
          ? '，相对评分较高但样本偏少，先补量验证后再扩大预算。'
          : '，优先增加高效作品，并在毛利和目标 ROI 允许时逐步追加预算。') + confidenceSuffix(item.metrics));
    });
    products.filter((item) => ['C', 'D'].includes(item.grade)).slice(0, 2).forEach((item) => {
      addAction('优化商品：商品ID ' + textOrDash(item.id) + '，检查价格力、详情页和人群匹配，暂不盲目放量。' +
        confidenceSuffix(item.metrics));
    });
    diagnosis.strongPlans.filter((item) => actionableEntityId(item.click && item.click.campaignId)).slice(0, 3).forEach((item) => {
      const confidence = paidSampleConfidence(item.click);
      addAction((confidence === 'low' ? '观察计划：' : '放量计划：') + itemIdLabel(item) + '，ROI ' +
        formatDecimal(item.click.roi) + (confidence === 'low'
          ? '，样本偏少，先小预算补量验证。'
          : '，在目标 ROI 与边际成本允许时小幅追加预算。') + confidenceSuffix(item.click));
    });
    diagnosis.weakPlans.filter((item) => actionableEntityId(item.click && item.click.campaignId)).slice(0, 3).forEach((item) => {
      const confidence = paidSampleConfidence(item.click);
      addAction((confidence === 'low' ? '验证计划：' : '收缩计划：') + itemIdLabel(item) + '，当前评级 ' + item.grade +
        (confidence === 'low' ? '，样本偏少，先补量排除偶然波动。' : '，建议降预算或重建。') +
        confidenceSuffix(item.click));
    });
    diagnosis.trafficPlans.filter((item) => actionableEntityId(item.click && item.click.campaignId)).slice(0, 3).forEach((item) => {
      addAction('引流计划：' + itemIdLabel(item) + '，' + item.role + '，优先承担拉新、种草和访问任务。' +
        confidenceSuffix(item.click));
    });
    diagnosis.conversionPlans.filter((item) => actionableEntityId(item.click && item.click.campaignId)).slice(0, 3).forEach((item) => {
      addAction('转化计划：' + itemIdLabel(item) + '，' + item.role + '，优先承接成交预算。' +
        confidenceSuffix(item.click));
    });
    if (!actions.length) actions.push('当前样本不足，建议先提高消耗或延长日期范围后再判断。');
    return '<section class="wxt-chart-section wxt-action-section"><div class="wxt-section-heading"><div><h2>操作建议</h2>' +
      '<p>同时对比免费内容表现与付费投放效率</p></div></div>' +
      overallDiagnosisMarkup(data, diagnosis, attributionKey) +
      '<div class="wxt-priority-actions"><h3>优先动作</h3><ol>' +
      actions.slice(0, 12).map((item) => '<li>' + escapeHtml(item) + '</li>').join('') +
      '</ol></div>' + lowSpendAdviceMarkup(model.sampleScope) + '</section>';
  }

  function shortVideoDiagnosisContent(data, attributionKey, attributionName) {
    const diagnosis = diagnoseShortVideo(data, attributionKey);
    const kpis = diagnosisKpis(data, diagnosis, attributionKey, attributionName);
    return '<section class="wxt-attribution-report" data-attribution-report="' + escapeHtml(attributionKey) + '"' +
      (attributionKey === 'display' ? ' hidden' : '') + '>' +
      '<section class="wxt-kpi-strip">' + kpis.map((item) => (
        '<div><span>' + escapeHtml(item[0]) + '</span><strong>' + escapeHtml(item[1]) + '</strong></div>'
      )).join('') + '</section>' +
      actionListMarkup(data, diagnosis, attributionKey) +
      guangheLinkSummaryMarkup(data) +
      deliveryDiagnosisMarkup(diagnosis) +
      diagnosisTableMarkup('计划诊断', '仅诊断花费 ≥ ¥' + DIAGNOSIS_MIN_SPEND +
        ' 的计划；用于判断预算是否值得继续投入，避免低花费偶发成交干扰。', diagnosis.plans, 'plan') +
      paidSummaryTableMarkup(data, attributionKey, 'product') +
      paidSummaryTableMarkup(data, attributionKey, 'video') +
      '</section>';
  }

  function requestWarningsMarkup(data) {
    const warnings = Array.isArray(data.requestWarnings)
      ? data.requestWarnings.filter(Boolean)
      : [];
    if (!warnings.length) return '';
    return '<section class="wxt-request-warning"><strong>部分接口已降级处理</strong><p>' +
      escapeHtml(warnings.join('；')) +
      '。报告仅使用成功返回的数据块，避免失败口径污染计算。</p></section>';
  }

  function shortVideoDiagnosisMarkup(data) {
    return '<main class="wxt-report wxt-short-video-report wxt-diagnosis-report">' +
      '<header class="wxt-report-head"><div><span>WANXIANGTAI DIAGNOSIS</span>' +
      '<h1>短视频投放诊断报告</h1><p>' + escapeHtml(data.startTime) + ' 至 ' + escapeHtml(data.endTime) +
      ' · 计划 / 视频 / 商品维度 · 可切换归因口径</p></div><b>自动诊断</b></header>' +
      '<section class="wxt-attribution-control"><label>归因口径<select data-attribution-select>' +
      '<option value="click">点击效果归因</option><option value="display">展现效果归因</option>' +
      '</select></label></section>' +
      requestWarningsMarkup(data) +
      shortVideoDiagnosisContent(data, 'click', '点击归因') +
      shortVideoDiagnosisContent(data, 'display', '展现归因') +
      '<footer class="wxt-report-foot">账户级汇总使用全量数据。诊断样本门槛为累计花费 ≥ ¥' + DIAGNOSIS_MIN_SPEND +
      '：低于门槛的计划、商品和作品会单列展示，但不参与评分、排名、ROI 达标统计与建议。评分以当前归因口径下合格样本的同层级中位数为基准；适配角色和归因判断均对比点击与展现两种口径。商品维度优先按两端原始身份字段映射，必要时使用唯一完整标题兜底；一视频多商品按商品数等额分摊付费量值。</footer>' +
    '</main>';
  }

  function diagnosisTableScript() {
    return `
      (function () {
        function cellText(row, index) {
          var cell = row.children[index];
          return cell ? (cell.getAttribute('data-filter-value') || cell.textContent || '').trim() : '';
        }
        function buildFilters(root) {
          Array.prototype.forEach.call(root.querySelectorAll('table[data-filter-table-id]'), function (table) {
            if (table.getAttribute('data-controls-ready') === '1') return;
            table.setAttribute('data-controls-ready', '1');
            var headers = table.tHead && table.tHead.rows[0] ? Array.prototype.slice.call(table.tHead.rows[0].cells) : [];
            headers.forEach(function (header, index) {
              if (header.getAttribute('data-filter-type') === 'text') {
                var values = [];
                Array.prototype.forEach.call(table.tBodies[0].rows, function (row) {
                  var value = cellText(row, index);
                  if (value && values.indexOf(value) === -1) values.push(value);
                });
                values.sort();
                var select = document.createElement('select');
                select.setAttribute('data-col-filter', String(index));
                select.innerHTML = '<option value="">全部</option>' + values.map(function (value) {
                  return '<option value="' + value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '">' +
                    value.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</option>';
                }).join('');
                header.appendChild(select);
              }
              if (header.getAttribute('data-sort-type') === 'number') {
                header.setAttribute('role', 'button');
                header.setAttribute('tabindex', '0');
              }
            });
          });
        }
        function applyFilters(table) {
          if (!table) return;
          var filters = Array.prototype.slice.call(table.querySelectorAll('thead select[data-col-filter]'))
            .map(function (select) {
              return { index: Number(select.getAttribute('data-col-filter')), value: select.value };
            })
            .filter(function (filter) { return filter.value; });
          Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (row) {
            row.style.display = filters.every(function (filter) {
              return cellText(row, filter.index) === filter.value;
            }) ? '' : 'none';
          });
        }
        function sortTable(table, index, direction) {
          var body = table.tBodies[0];
          var rows = Array.prototype.slice.call(body.rows);
          rows.sort(function (a, b) {
            var av = Number(a.children[index] && a.children[index].getAttribute('data-sort-value'));
            var bv = Number(b.children[index] && b.children[index].getAttribute('data-sort-value'));
            if (!isFinite(av)) av = -Infinity;
            if (!isFinite(bv)) bv = -Infinity;
            return direction === 'asc' ? av - bv : bv - av;
          });
          rows.forEach(function (row) { body.appendChild(row); });
        }
        buildFilters(document);
        document.addEventListener('change', function (event) {
          var select = event.target && event.target.closest && event.target.closest('[data-attribution-select]');
          if (!select) return;
          Array.prototype.forEach.call(document.querySelectorAll('[data-attribution-report]'), function (section) {
            section.hidden = section.getAttribute('data-attribution-report') !== select.value;
          });
          buildFilters(document);
        });
        document.addEventListener('change', function (event) {
          var select = event.target && event.target.closest && event.target.closest('thead select[data-col-filter]');
          if (!select) return;
          applyFilters(select.closest('table'));
        });
        document.addEventListener('click', function (event) {
          var header = event.target && event.target.closest && event.target.closest('th[data-sort-type="number"]');
          if (!header || event.target.tagName === 'SELECT') return;
          var table = header.closest('table');
          var index = Array.prototype.indexOf.call(header.parentNode.children, header);
          var direction = header.getAttribute('data-sort-direction') === 'desc' ? 'asc' : 'desc';
          Array.prototype.forEach.call(header.parentNode.children, function (th) { th.removeAttribute('data-sort-direction'); });
          header.setAttribute('data-sort-direction', direction);
          sortTable(table, index, direction);
        });
      })();
    `;
  }

  function bindDiagnosisTables(root) {
    if (!root || root.__wxtDiagnosisTablesBound) return;
    root.__wxtDiagnosisTablesBound = true;
    initializeDiagnosisTables(root);
    root.addEventListener('change', (event) => {
      const attributionSelect = event.target && event.target.closest && event.target.closest('[data-attribution-select]');
      if (attributionSelect) {
        root.querySelectorAll('[data-attribution-report]').forEach((section) => {
          section.hidden = section.getAttribute('data-attribution-report') !== attributionSelect.value;
        });
        initializeDiagnosisTables(root);
        return;
      }
      const select = event.target && event.target.closest && event.target.closest('thead select[data-col-filter]');
      if (!select) return;
      applyTableColumnFilters(select.closest('table'));
    });
    root.addEventListener('click', (event) => {
      const header = event.target && event.target.closest && event.target.closest('th[data-sort-type="number"]');
      if (!header || event.target.tagName === 'SELECT') return;
      const table = header.closest('table');
      const index = Array.prototype.indexOf.call(header.parentNode.children, header);
      const direction = header.getAttribute('data-sort-direction') === 'desc' ? 'asc' : 'desc';
      Array.from(header.parentNode.children).forEach((cell) => cell.removeAttribute('data-sort-direction'));
      header.setAttribute('data-sort-direction', direction);
      sortDiagnosisTable(table, index, direction);
    });
  }

  function initializeDiagnosisTables(root) {
    root.querySelectorAll('table[data-filter-table-id]').forEach((table) => {
      if (table.getAttribute('data-controls-ready') === '1') return;
      table.setAttribute('data-controls-ready', '1');
      const headers = Array.from(table.tHead && table.tHead.rows[0] ? table.tHead.rows[0].cells : []);
      headers.forEach((header, index) => {
        if (header.getAttribute('data-filter-type') === 'text') appendColumnFilter(table, header, index);
        if (header.getAttribute('data-sort-type') === 'number') {
          header.setAttribute('role', 'button');
          header.setAttribute('tabindex', '0');
        }
      });
    });
  }

  function appendColumnFilter(table, header, index) {
    const values = Array.from(table.tBodies[0].rows)
      .map((row) => {
        const cell = row.children[index];
        return String(cell && (cell.getAttribute('data-filter-value') || cell.textContent) || '').trim();
      })
      .filter(Boolean);
    const unique = Array.from(new Set(values)).sort((left, right) => left.localeCompare(right, 'zh-CN'));
    const select = document.createElement('select');
    select.setAttribute('data-col-filter', String(index));
    select.innerHTML = '<option value="">全部</option>' + unique.map((value) => (
      '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>'
    )).join('');
    header.appendChild(select);
  }

  function applyTableColumnFilters(table) {
    if (!table) return;
    const filters = Array.from(table.querySelectorAll('thead select[data-col-filter]'))
      .map((select) => ({
        index: Number(select.getAttribute('data-col-filter')),
        value: select.value,
      }))
      .filter((filter) => filter.value);
    Array.from(table.tBodies[0].rows).forEach((row) => {
      row.style.display = filters.every((filter) => {
        const cell = row.children[filter.index];
        const value = String(cell && (cell.getAttribute('data-filter-value') || cell.textContent) || '').trim();
        return value === filter.value;
      }) ? '' : 'none';
    });
  }

  function sortDiagnosisTable(table, index, direction) {
    if (!table || !table.tBodies[0]) return;
    const rows = Array.from(table.tBodies[0].rows);
    rows.sort((left, right) => {
      let leftValue = Number(left.children[index] && left.children[index].getAttribute('data-sort-value'));
      let rightValue = Number(right.children[index] && right.children[index].getAttribute('data-sort-value'));
      if (!Number.isFinite(leftValue)) leftValue = -Infinity;
      if (!Number.isFinite(rightValue)) rightValue = -Infinity;
      return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
    });
    rows.forEach((row) => table.tBodies[0].appendChild(row));
  }

  function downloadShortVideoDiagnosisReport(data) {
    const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>短视频投放诊断报告</title><style>body{margin:0;background:#f4f6f9}' +
      reportStyles() + '</style></head><body>' + shortVideoDiagnosisMarkup(data) +
      '<script>' + diagnosisTableScript() + '</script></body></html>';
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '短视频投放诊断报告_' + data.startTime + '_' + data.endTime + '.html';
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function renderShortVideoDiagnosis(data) {
    ensureStyles();
    let dialog = document.getElementById(DIALOG_ID);
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = DIALOG_ID;
      document.documentElement.appendChild(dialog);
    }
    dialog.innerHTML = '<div class="wxt-export-panel is-report" role="dialog" aria-modal="true" aria-label="短视频投放诊断报告">' +
      '<div class="wxt-export-title"><span>短视频投放诊断报告</span>' +
      '<div class="wxt-export-actions">' +
      '<button class="wxt-export-action primary" type="button" data-action="download-diagnosis">↓ 导出报告</button>' +
      '<button class="wxt-export-close" type="button" title="关闭">×</button>' +
      '</div></div><div class="wxt-export-report-body">' + shortVideoDiagnosisMarkup(data) + '</div></div>';
    dialog.querySelector('.wxt-export-close').addEventListener('click', () => dialog.remove());
    dialog.querySelector('[data-action="download-diagnosis"]').addEventListener('click', () => {
      downloadShortVideoDiagnosisReport(data);
    });
    bindDiagnosisTables(dialog);
  }

  function detailTableMarkup(data) {
    const headers = detailHeaders();
    const rows = buildDetailRows(data);
    const maxima = headers.map((header, columnIndex) => (
      columnIndex === 0
        ? 0
        : Math.max(0, ...rows.map((row) => Math.abs(numberOrNull(row[columnIndex]) || 0)))
    ));
    return '<section class="wxt-detail-section">' +
      '<div class="wxt-section-heading"><div><h2>营销场景数据明细</h2>' +
      '<p>每列数据条按该列最大值缩放；短视频展现数据采用展现效果口径</p></div>' +
      '<span class="wxt-row-count">' + rows.length + ' 个场景</span></div>' +
      '<div class="wxt-table-scroll"><table class="wxt-report-table"><thead><tr>' +
      headers.map((header, index) => {
        const emphasis = index === 11 ? ' is-roi' : index === 12 ? ' is-potential' : '';
        return '<th class="' + emphasis + '">' + escapeHtml(header) + '</th>';
      }).join('') + '</tr></thead><tbody>' +
      rows.map((row) => {
        const name = String(row[0] || '');
        const highlighted = name.includes('超级短视频') || name === '短视频展现数据';
        return '<tr class="' + (highlighted ? 'is-short-video' : '') + '">' +
          '<td><strong>' + escapeHtml(name) + '</strong></td>' +
          row.slice(1).map((value, offset) => {
            const columnIndex = offset + 1;
            const numeric = Math.abs(numberOrNull(value) || 0);
            const width = maxima[columnIndex] ? Math.min(100, numeric / maxima[columnIndex] * 100) : 0;
            const emphasis = columnIndex === 11
              ? ' is-roi'
              : columnIndex === 12
                ? ' is-potential'
                : '';
            return '<td class="wxt-metric-cell' + emphasis + '">' +
              '<i class="wxt-data-bar" style="width:' + width.toFixed(2) + '%"></i>' +
              '<span>' + escapeHtml(metricValue(row, columnIndex)) + '</span></td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  function reportMarkup(data) {
    const total = data.marketingTotal || {};
    const spend = data.spendSummary || {};
    const kpis = [
      ['账户总花费', '¥' + formatMoney(spend.totalCharge)],
      ['展现量', formatInteger(total.adPv)],
      ['点击量', formatInteger(total.click)],
      ['总成交笔数', formatInteger(total.alipayInshopNum)],
      ['投入产出比', formatDecimal(total.roi), 'is-roi'],
    ];
    return '<main class="wxt-report">' +
      '<header class="wxt-report-head"><div><span>WANXIANGTAI REPORT</span>' +
      '<h1>万相台 30 天数据报告</h1><p>' + escapeHtml(data.startTime) + ' 至 ' +
      escapeHtml(data.endTime) + ' · 15天累计归因</p></div>' +
      '<b>最近30个完整自然日</b></header>' +
      '<section class="wxt-kpi-strip">' + kpis.map((item) => (
        '<div class="' + (item[2] || '') + '"><span>' + escapeHtml(item[0]) +
        '</span><strong title="' + escapeHtml(item[1]) + '">' + escapeHtml(item[1]) + '</strong></div>'
      )).join('') + '</section>' +
      '<div class="wxt-chart-grid">' +
        pieChartMarkup('一级场景花费构成', '内容场景已重点标识', spendChartEntries(data)) +
        pieChartMarkup('二级场景花费汇总', '超级短视频已重点标识', marketingChartEntries(data)) +
      '</div>' +
      detailTableMarkup(data) +
      '<footer class="wxt-report-foot">营销场景使用末次点击归因；短视频展现数据使用展现效果口径。</footer>' +
    '</main>';
  }

  function reportStyles() {
    return `
      .wxt-report, .wxt-report * { box-sizing: border-box; }
      .wxt-report {
        width: 100%;
        max-width: 1280px;
        min-width: 0;
        margin: 0 auto;
        padding: 0 28px 34px;
        color: #172033;
        background: #f4f6f9;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, "PingFang SC", sans-serif;
        letter-spacing: 0;
      }
      .wxt-report-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 24px;
        margin: 0 -28px;
        padding: 28px 30px 26px;
        background: #243b72;
        color: #fff;
      }
      .wxt-report-head span { font-size: 11px; font-weight: 750; color: #9ec5ff; }
      .wxt-report-head h1 { margin: 5px 0 7px; font-size: 28px; line-height: 1.2; }
      .wxt-report-head p { margin: 0; color: #dbe7ff; font-size: 13px; }
      .wxt-report-head > b {
        padding: 7px 10px;
        border: 1px solid #6f8dcc;
        border-radius: 5px;
        color: #fff;
        font-size: 12px;
      }
      .wxt-kpi-strip {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        margin: 20px 0;
        border: 1px solid #e2e7ef;
        background: #fff;
      }
      .wxt-kpi-strip > div {
        min-width: 0;
        padding: 18px 20px;
        border-right: 1px solid #e2e7ef;
        container-type: inline-size;
      }
      .wxt-kpi-strip > div:last-child { border-right: 0; }
      .wxt-kpi-strip span { display: block; margin-bottom: 8px; color: #667085; font-size: 12px; }
      .wxt-kpi-strip strong {
        display: block;
        min-width: 0;
        overflow: visible;
        color: #172033;
        font-size: 18px;
        font-size: clamp(16px, 10.5cqw, 22px);
        line-height: 1.2;
        letter-spacing: -.02em;
        font-variant-numeric: tabular-nums;
        white-space: normal;
        overflow-wrap: anywhere;
        text-overflow: clip;
      }
      .wxt-kpi-strip .is-roi { border-top: 3px solid #ff7a00; }
      .wxt-diagnosis-report .wxt-kpi-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .wxt-diagnosis-report .wxt-kpi-strip strong {
        overflow: visible;
        font-size: 20px;
        line-height: 1.25;
        overflow-wrap: anywhere;
        text-overflow: clip;
      }
      .wxt-guanghe-link {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin: 0 0 20px;
        border: 1px solid #d5dde9;
        background: #fff;
      }
      .wxt-guanghe-link > div { min-width: 0; padding: 15px 18px; border-right: 1px solid #e2e7ef; }
      .wxt-guanghe-link > div:last-child { border-right: 0; }
      .wxt-guanghe-link span { display: block; color: #667085; font-size: 11px; font-weight: 700; }
      .wxt-guanghe-link strong { display: block; margin: 5px 0; color: #172033; font-size: 18px; }
      .wxt-guanghe-link p { margin: 0; color: #7b8495; font-size: 11px; line-height: 1.45; }
      .wxt-guanghe-link.is-linked { border-left: 4px solid #16a085; }
      .wxt-guanghe-link.is-unlinked { border-left: 4px solid #f79009; background: #fffcf5; }
      .wxt-request-warning {
        margin: 0 0 20px;
        padding: 12px 16px;
        border: 1px solid #f4c278;
        border-left: 4px solid #f79009;
        background: #fffcf5;
        color: #7a4300;
      }
      .wxt-request-warning strong { display: block; margin-bottom: 4px; font-size: 13px; }
      .wxt-request-warning p { margin: 0; font-size: 12px; line-height: 1.5; }
      .wxt-mapping-debug {
        margin: -10px 0 20px;
        border: 1px solid #d5dde9;
        background: #fff;
      }
      .wxt-mapping-debug summary {
        padding: 10px 14px;
        color: #344054;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .wxt-mapping-debug pre {
        max-height: 360px;
        margin: 0;
        padding: 14px;
        overflow: auto;
        border-top: 1px solid #e2e7ef;
        background: #f8fafc;
        color: #344054;
        font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        white-space: pre;
      }
      .wxt-attribution-control {
        display: flex;
        justify-content: flex-end;
        margin: 16px 0 0;
      }
      .wxt-attribution-control label {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid #d9dee8;
        background: #fff;
        color: #344054;
        font-size: 13px;
        font-weight: 650;
      }
      .wxt-attribution-control select {
        height: 32px;
        border: 1px solid #d9dee8;
        border-radius: 5px;
        background: #fff;
        color: #172033;
        font-size: 13px;
      }
      .wxt-chart-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-bottom: 20px;
      }
      .wxt-chart-section, .wxt-detail-section { border: 1px solid #e2e7ef; background: #fff; }
      .wxt-chart-section { min-width: 0; padding: 20px; overflow: hidden; }
      .wxt-section-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }
      .wxt-section-heading h2 { margin: 0 0 5px; color: #172033; font-size: 17px; }
      .wxt-section-heading p { margin: 0; color: #7b8495; font-size: 12px; }
      .wxt-section-heading > strong { color: #172033; font-size: 17px; white-space: nowrap; }
      .wxt-pie-layout {
        display: grid;
        grid-template-columns: minmax(120px, 148px) minmax(0, 1fr);
        gap: 14px;
        align-items: center;
      }
      .wxt-pie {
        width: min(100%, 148px);
        aspect-ratio: 1;
        justify-self: center;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1px rgba(17,32,51,.06);
      }
      .wxt-pie-legend { width: 100%; min-width: 0; overflow: hidden; }
      .wxt-legend-row {
        display: grid;
        grid-template-columns: 9px minmax(0, 1fr) minmax(76px, max-content) minmax(44px, max-content);
        align-items: center;
        gap: 7px;
        min-height: 32px;
        padding: 5px 4px;
        border-bottom: 1px solid #f0f2f6;
        font-size: 12px;
      }
      .wxt-legend-row:last-child { border-bottom: 0; }
      .wxt-legend-row.is-featured { background: #fff8dd; }
      .wxt-legend-row i { width: 9px; height: 9px; }
      .wxt-legend-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .wxt-legend-row b { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .wxt-legend-row em { color: #667085; font-style: normal; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .wxt-detail-section { margin-bottom: 20px; padding-top: 20px; }
      .wxt-detail-section > .wxt-section-heading { padding: 0 20px; }
      .wxt-row-count { color: #667085; font-size: 12px; white-space: nowrap; }
      .wxt-table-scroll { width: 100%; overflow: auto; border-top: 1px solid #dce5f2; }
      .wxt-report-table {
        width: 100%;
        min-width: 1840px;
        border-collapse: separate;
        border-spacing: 0;
        table-layout: fixed;
        font-size: 12px;
      }
      .wxt-short-video-table { min-width: 5200px; }
      .wxt-report-table th, .wxt-report-table td {
        position: relative;
        height: 46px;
        padding: 8px 10px;
        border-right: 1px solid #e3eaf4;
        border-bottom: 1px solid #e3eaf4;
        color: #344054;
        text-align: right;
        white-space: normal;
        overflow: visible;
      }
      .wxt-report-table th {
        height: 48px;
        background: #eef4ff;
        color: #243b72;
        font-weight: 750;
        text-align: center;
        vertical-align: top;
      }
      .wxt-report-table th[data-sort-type="number"] {
        cursor: pointer;
        user-select: none;
      }
      .wxt-sort-mark {
        display: inline-block;
        margin-left: 4px;
        color: #98a2b3;
        font-size: 11px;
      }
      .wxt-report-table th[data-sort-direction="asc"] .wxt-sort-mark::after { content: "↑"; color: #315efb; }
      .wxt-report-table th[data-sort-direction="desc"] .wxt-sort-mark::after { content: "↓"; color: #315efb; }
      .wxt-report-table th[data-sort-direction] .wxt-sort-mark { font-size: 0; }
      .wxt-report-table th[data-sort-direction] { color: #315efb; background: #eef4ff; }
      .wxt-goal-reference {
        display: block;
        margin-top: 4px;
        color: #5e78ad;
        font-size: 10px;
        font-weight: 650;
        line-height: 1.2;
      }
      .wxt-report-table th select {
        display: block;
        width: 100%;
        min-width: 0;
        max-width: 100%;
        height: 26px;
        margin-top: 6px;
        padding: 0 4px;
        border: 1px solid #d9dee8;
        border-radius: 4px;
        background: #fff;
        color: #344054;
        font-size: 12px;
        font-weight: 500;
      }
      .wxt-report-table th select:focus {
        border-color: #315efb;
        box-shadow: 0 0 0 2px rgba(49,94,251,.12);
        outline: 0;
      }
      .wxt-report-table tbody tr:nth-child(even) td { background-color: #fbfcff; }
      .wxt-report-table tbody tr:hover td { background-color: #f4f8ff; }
      .wxt-cell-scroll {
        max-height: 72px;
        overflow: auto;
        line-height: 1.35;
        white-space: normal;
        word-break: break-word;
      }
      .wxt-report-table td:not(.is-identity) .wxt-cell-scroll {
        text-align: right;
      }
      .wxt-report-table th:first-child, .wxt-report-table td:first-child {
        position: sticky;
        left: 0;
        z-index: 2;
        width: 172px;
        text-align: left;
        background: #fff;
      }
      .wxt-report-table th:first-child { z-index: 4; background: #eef4ff; }
      .wxt-short-video-table th:first-child, .wxt-short-video-table td:first-child { width: 118px; }
      .wxt-short-video-table th.is-identity, .wxt-short-video-table td.is-identity {
        text-align: left;
        white-space: normal;
        line-height: 1.35;
      }
      .wxt-short-video-table th:nth-child(2), .wxt-short-video-table td:nth-child(2),
      .wxt-short-video-table th:nth-child(6), .wxt-short-video-table td:nth-child(6) { width: 170px; }
      .wxt-short-video-table th:nth-child(3), .wxt-short-video-table td:nth-child(3),
      .wxt-short-video-table th:nth-child(4), .wxt-short-video-table td:nth-child(4),
      .wxt-short-video-table th:nth-child(5), .wxt-short-video-table td:nth-child(5) { width: 260px; }
      .wxt-report-table tr.is-short-video td { background: #fffbea; }
      .wxt-report-table tr.is-short-video td:first-child { color: #8a5200; }
      .wxt-report-table th.is-roi, .wxt-report-table td.is-roi { background-color: #fff5e8; color: #a34b00; }
      .wxt-report-table th.is-potential, .wxt-report-table td.is-potential { background-color: #eaf8f3; color: #08765b; }
      .wxt-report-table td.is-money .wxt-data-bar { background: #ffe0b7; border-left-color: #ff7a00; }
      .wxt-report-table td.is-percent .wxt-data-bar { background: #ccefe4; border-left-color: #16a085; }
      .wxt-report-table td.wxt-metric-cell {
        font-weight: 700;
        box-shadow: inset 3px 0 0 transparent;
      }
      .wxt-report-table td.wxt-metric-good {
        color: #08765b;
        background: #eaf8f3;
        box-shadow: inset 3px 0 0 #16a085;
      }
      .wxt-report-table td.wxt-metric-watch {
        color: #8a5200;
        background: #fff8dd;
        box-shadow: inset 3px 0 0 #e5a000;
      }
      .wxt-report-table td.wxt-metric-bad {
        color: #b42318;
        background: #fff0f0;
        box-shadow: inset 3px 0 0 #e5484d;
      }
      .wxt-diagnosis-table { min-width: 3160px; }
      .wxt-aggregate-table { min-width: 2500px; }
      .wxt-linked-table { min-width: 5200px; }
      .wxt-diagnosis-table th:first-child, .wxt-diagnosis-table td:first-child {
        width: 118px;
        min-width: 118px;
        text-align: center;
      }
      .wxt-aggregate-table th:first-child, .wxt-aggregate-table td:first-child {
        width: 118px;
        min-width: 118px;
        text-align: center;
      }
      .wxt-linked-table th:first-child, .wxt-linked-table td:first-child {
        width: 118px;
        min-width: 118px;
        text-align: center;
      }
      .wxt-diagnosis-table th:nth-child(2), .wxt-diagnosis-table td:nth-child(2),
      .wxt-aggregate-table th:nth-child(2), .wxt-aggregate-table td:nth-child(2),
      .wxt-linked-table th:nth-child(2), .wxt-linked-table td:nth-child(2) {
        position: sticky;
        left: 118px;
        z-index: 2;
        background: #fff;
        text-align: left;
        box-shadow: 1px 0 0 #d7e2f1, 8px 0 12px -12px rgba(36,59,114,.65);
      }
      .wxt-diagnosis-table th:nth-child(2),
      .wxt-aggregate-table th:nth-child(2),
      .wxt-linked-table th:nth-child(2) {
        z-index: 3;
        background: #eef4ff;
      }
      .wxt-diagnosis-table th:nth-child(2), .wxt-diagnosis-table td:nth-child(2) {
        width: 240px;
        min-width: 240px;
      }
      .wxt-aggregate-table th:nth-child(2), .wxt-aggregate-table td:nth-child(2) {
        width: 300px;
        min-width: 300px;
      }
      .wxt-linked-table th:nth-child(2), .wxt-linked-table td:nth-child(2) {
        width: 210px;
        min-width: 210px;
      }
      .wxt-diagnosis-table tbody tr:nth-child(even) td:nth-child(2),
      .wxt-aggregate-table tbody tr:nth-child(even) td:nth-child(2),
      .wxt-linked-table tbody tr:nth-child(even) td:nth-child(2) { background: #fbfcff; }
      .wxt-diagnosis-table tbody tr:hover td:nth-child(2),
      .wxt-aggregate-table tbody tr:hover td:nth-child(2),
      .wxt-linked-table tbody tr:hover td:nth-child(2) { background: #f4f8ff; }
      .wxt-diagnosis-table td:first-child strong { display: block; font-size: 18px; line-height: 1; }
      .wxt-diagnosis-table td:first-child span { color: #667085; font-size: 11px; }
      .wxt-aggregate-table td:first-child strong { display: block; font-size: 18px; line-height: 1; }
      .wxt-aggregate-table td:first-child span { color: #667085; font-size: 11px; }
      .wxt-linked-table td:first-child strong { display: block; font-size: 18px; line-height: 1; }
      .wxt-linked-table td:first-child span { color: #667085; font-size: 11px; }
      .wxt-diagnosis-table tr.is-grade-S td:first-child { color: #08765b; background: #eaf8f3; }
      .wxt-diagnosis-table tr.is-grade-A td:first-child { color: #315efb; background: #eef4ff; }
      .wxt-diagnosis-table tr.is-grade-B td:first-child { color: #8a5200; background: #fff8dd; }
      .wxt-diagnosis-table tr.is-grade-C td:first-child { color: #a34b00; background: #fff5e8; }
      .wxt-diagnosis-table tr.is-grade-D td:first-child { color: #b42318; background: #fef3f2; }
      .wxt-aggregate-table tr.is-grade-S td:first-child { color: #08765b; background: #eaf8f3; }
      .wxt-aggregate-table tr.is-grade-A td:first-child { color: #315efb; background: #eef4ff; }
      .wxt-aggregate-table tr.is-grade-B td:first-child { color: #8a5200; background: #fff8dd; }
      .wxt-aggregate-table tr.is-grade-C td:first-child { color: #a34b00; background: #fff5e8; }
      .wxt-aggregate-table tr.is-grade-D td:first-child { color: #b42318; background: #fef3f2; }
      .wxt-linked-table tr.is-grade-S td:first-child { color: #08765b; background: #eaf8f3; }
      .wxt-linked-table tr.is-grade-A td:first-child { color: #315efb; background: #eef4ff; }
      .wxt-linked-table tr.is-grade-B td:first-child { color: #8a5200; background: #fff8dd; }
      .wxt-linked-table tr.is-grade-C td:first-child { color: #a34b00; background: #fff5e8; }
      .wxt-linked-table tr.is-grade-D td:first-child { color: #b42318; background: #fef3f2; }
      .wxt-delivery-diagnosis { margin: 20px 0; }
      .wxt-delivery-diagnosis > .wxt-section-heading {
        margin: 0;
        padding: 20px;
        border: 1px solid #e2e7ef;
        border-bottom: 0;
        background: #fff;
      }
      .wxt-delivery-cards {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        padding: 16px 20px 20px;
        border: 1px solid #e2e7ef;
        background: #fff;
      }
      .wxt-delivery-cards > div {
        min-width: 0;
        padding: 14px;
        border: 1px solid #e6ebf2;
        background: #f8fafc;
      }
      .wxt-delivery-cards span {
        display: block;
        margin-bottom: 7px;
        color: #667085;
        font-size: 12px;
      }
      .wxt-delivery-cards strong {
        display: block;
        color: #172033;
        font-size: 20px;
      }
      .wxt-delivery-cards p {
        margin: 8px 0 0;
        color: #344054;
        font-size: 12px;
        line-height: 1.45;
      }
      .wxt-action-section { margin: 20px 0; }
      .wxt-overall-diagnosis {
        border-top: 1px solid #e2e7ef;
        border-bottom: 1px solid #e2e7ef;
      }
      .wxt-overall-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 0 10px;
      }
      .wxt-overall-heading h3, .wxt-priority-actions h3 {
        margin: 0;
        color: #172033;
        font-size: 14px;
      }
      .wxt-overall-heading span { color: #667085; font-size: 11px; }
      .wxt-account-diagnosis {
        padding: 17px 20px 18px;
        border-top: 1px solid #e2e7ef;
        border-left: 4px solid #98a2b3;
        background: #fff;
      }
      .wxt-account-diagnosis.is-good { border-left-color: #16a085; }
      .wxt-account-diagnosis.is-watch { border-left-color: #e5a000; }
      .wxt-account-diagnosis.is-bad { border-left-color: #e5484d; }
      .wxt-account-diagnosis header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .wxt-account-diagnosis header span { display: block; color: #315efb; font-size: 12px; font-weight: 800; }
      .wxt-account-diagnosis header strong {
        display: block;
        margin-top: 6px;
        color: #172033;
        font-size: 15px;
        line-height: 1.55;
      }
      .wxt-account-diagnosis header > b {
        flex: 0 0 auto;
        padding: 3px 8px;
        border: 1px solid #d6e1f5;
        border-radius: 4px;
        color: #475467;
        font-size: 11px;
      }
      .wxt-account-kpis {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        margin-top: 14px;
        border: 1px solid #e2e7ef;
      }
      .wxt-account-kpis > div { min-width: 0; padding: 12px 14px; border-right: 1px solid #e2e7ef; }
      .wxt-account-kpis > div:last-child { border-right: 0; }
      .wxt-account-kpis span { display: block; color: #667085; font-size: 10px; }
      .wxt-account-kpis strong {
        display: block;
        margin-top: 5px;
        color: #243b72;
        font-size: 17px;
        font-variant-numeric: tabular-nums;
      }
      .wxt-account-diagnosis > p { margin: 10px 0 0; color: #667085; font-size: 11px; line-height: 1.6; }
      .wxt-account-diagnosis > p b { margin-right: 7px; color: #172033; }
      .wxt-core-diagnosis {
        padding: 18px 20px;
        border-left: 4px solid #315efb;
        background: #f5f8ff;
      }
      .wxt-core-diagnosis.is-good { border-left-color: #16a085; background: #f1faf7; }
      .wxt-core-diagnosis.is-watch { border-left-color: #e5a000; background: #fffaf0; }
      .wxt-core-diagnosis.is-bad { border-left-color: #e5484d; background: #fff5f5; }
      .wxt-core-diagnosis.is-neutral { border-left-color: #98a2b3; background: #f8fafc; }
      .wxt-core-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }
      .wxt-core-heading span { color: #315efb; font-size: 12px; font-weight: 800; }
      .wxt-core-heading b {
        padding: 3px 8px;
        border: 1px solid #d6e1f5;
        border-radius: 4px;
        background: #fff;
        color: #475467;
        font-size: 11px;
      }
      .wxt-core-diagnosis > strong {
        display: block;
        color: #172033;
        font-size: 17px;
        line-height: 1.55;
      }
      .wxt-core-diagnosis ul {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px 16px;
        margin: 14px 0 10px;
        padding: 12px 0 0 18px;
        border-top: 1px solid rgba(49,94,251,.14);
        color: #344054;
        font-size: 12px;
        line-height: 1.55;
      }
      .wxt-core-diagnosis > p { margin: 0; color: #667085; font-size: 11px; line-height: 1.55; }
      .wxt-diagnosis-matrix {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        border-top: 1px solid #e2e7ef;
        border-left: 1px solid #e2e7ef;
      }
      .wxt-diagnosis-matrix article {
        min-width: 0;
        padding: 16px 18px;
        border-right: 1px solid #e2e7ef;
        border-bottom: 1px solid #e2e7ef;
        box-shadow: inset 3px 0 0 #98a2b3;
      }
      .wxt-diagnosis-matrix article.is-good { box-shadow: inset 3px 0 0 #16a085; }
      .wxt-diagnosis-matrix article.is-watch { box-shadow: inset 3px 0 0 #e5a000; }
      .wxt-diagnosis-matrix article.is-bad { box-shadow: inset 3px 0 0 #e5484d; }
      .wxt-diagnosis-matrix article header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 9px;
      }
      .wxt-diagnosis-matrix h4 { margin: 0; color: #172033; font-size: 13px; }
      .wxt-diagnosis-matrix header span {
        padding: 2px 6px;
        border-radius: 3px;
        background: #f2f4f7;
        color: #667085;
        font-size: 10px;
        font-weight: 750;
      }
      .wxt-diagnosis-matrix article.is-good header span { background: #eaf8f3; color: #08765b; }
      .wxt-diagnosis-matrix article.is-watch header span { background: #fff8dd; color: #8a5200; }
      .wxt-diagnosis-matrix article.is-bad header span { background: #fff0f0; color: #b42318; }
      .wxt-diagnosis-matrix article > strong {
        display: block;
        min-height: 42px;
        color: #243b72;
        font-size: 13px;
        line-height: 1.6;
      }
      .wxt-diagnosis-matrix p { margin: 8px 0 0; color: #475467; font-size: 11px; line-height: 1.6; }
      .wxt-diagnosis-matrix p b { margin-right: 7px; color: #172033; }
      .wxt-diagnosis-matrix footer { margin-top: 10px; color: #7b8495; font-size: 10px; }
      .wxt-priority-actions { padding-top: 16px; }
      .wxt-action-section ol {
        margin: 8px 0 0;
        padding-left: 22px;
        color: #344054;
        font-size: 13px;
        line-height: 1.8;
      }
      .wxt-low-sample-actions {
        margin-top: 16px;
        border: 1px solid #e2e7ef;
        background: #f8fafc;
        overflow: hidden;
      }
      .wxt-low-sample-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 16px;
      }
      .wxt-low-sample-heading h3 { margin: 0; color: #172033; font-size: 14px; }
      .wxt-low-sample-heading p { margin: 5px 0 0; color: #667085; font-size: 11px; line-height: 1.55; }
      .wxt-low-sample-heading > span {
        flex: 0 0 auto;
        padding: 3px 8px;
        border: 1px solid #d9dee8;
        border-radius: 4px;
        background: #fff;
        color: #667085;
        font-size: 11px;
        font-weight: 700;
      }
      .wxt-low-sample-table { min-width: 720px; table-layout: fixed; }
      .wxt-low-sample-table th:first-child, .wxt-low-sample-table td:first-child {
        width: 90px;
        text-align: left;
      }
      .wxt-low-sample-table th:nth-child(2), .wxt-low-sample-table td:nth-child(2) {
        width: 250px;
        text-align: left;
      }
      .wxt-low-sample-table th:nth-child(3), .wxt-low-sample-table td:nth-child(3) { width: 140px; }
      .wxt-low-sample-table th:nth-child(4), .wxt-low-sample-table td:nth-child(4) { text-align: left; }
      .wxt-metric-cell .wxt-data-bar {
        position: absolute;
        z-index: 0;
        left: 5px;
        top: 8px;
        bottom: 8px;
        background: #dce7ff;
        border-left: 3px solid #5b82e8;
        opacity: .78;
      }
      .wxt-metric-cell.is-roi .wxt-data-bar { background: #ffe0b7; border-left-color: #ff7a00; }
      .wxt-metric-cell.is-potential .wxt-data-bar { background: #ccefe4; border-left-color: #16a085; }
      .wxt-metric-cell span { position: relative; z-index: 1; font-variant-numeric: tabular-nums; }
      .wxt-report-foot { padding: 4px 2px; color: #7b8495; font-size: 11px; }
      @media (max-width: 980px) {
        .wxt-kpi-strip, .wxt-diagnosis-report .wxt-kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .wxt-kpi-strip > div { border-bottom: 1px solid #e2e7ef; }
        .wxt-guanghe-link { grid-template-columns: 1fr; }
        .wxt-guanghe-link > div { border-right: 0; border-bottom: 1px solid #e2e7ef; }
        .wxt-guanghe-link > div:last-child { border-bottom: 0; }
        .wxt-chart-grid { grid-template-columns: 1fr; }
        .wxt-core-diagnosis ul { grid-template-columns: 1fr; }
        .wxt-account-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .wxt-account-kpis > div { border-bottom: 1px solid #e2e7ef; }
        .wxt-diagnosis-matrix { grid-template-columns: 1fr; }
      }
      @media (max-width: 620px) {
        .wxt-report { padding: 0 12px 24px; }
        .wxt-report-head { margin: 0 -12px; padding: 22px 16px; align-items: flex-start; flex-direction: column; }
        .wxt-report-head h1 { font-size: 23px; }
        .wxt-kpi-strip, .wxt-diagnosis-report .wxt-kpi-strip { grid-template-columns: 1fr; }
        .wxt-kpi-strip > div { border-right: 0; }
        .wxt-pie-layout { grid-template-columns: 1fr; }
        .wxt-pie { width: min(184px, 70vw); margin: 0 auto; }
      }
      @media print {
        .wxt-report { padding: 0; background: #fff; }
        .wxt-report-head { margin: 0; }
        .wxt-chart-section, .wxt-detail-section { break-inside: avoid; }
      }
    `;
  }

  function downloadVisualReport(data) {
    const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>万相台数据报告</title><style>body{margin:0;background:#f4f6f9}' +
      reportStyles() + '</style></head><body>' + reportMarkup(data) + '</body></html>';
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '万相台可视化报告_' + data.startTime + '_' + data.endTime + '.html';
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function renderReportPreview(data) {
    ensureStyles();
    let dialog = document.getElementById(DIALOG_ID);
    if (!dialog) {
      dialog = document.createElement('div');
      dialog.id = DIALOG_ID;
      document.documentElement.appendChild(dialog);
    }
    dialog.innerHTML = '<div class="wxt-export-panel is-report" role="dialog" aria-modal="true" aria-label="万相台数据报告">' +
      '<div class="wxt-export-title"><span>万相台数据报告</span>' +
      '<div class="wxt-export-actions">' +
      '<button class="wxt-export-action primary" type="button" data-action="download-report">↓ 可视化报告</button>' +
      '<button class="wxt-export-action" type="button" data-action="download-excel">↓ Excel数据</button>' +
      '<button class="wxt-export-close" type="button" title="关闭">×</button>' +
      '</div></div><div class="wxt-export-report-body">' + reportMarkup(data) + '</div></div>';
    dialog.querySelector('.wxt-export-close').addEventListener('click', () => dialog.remove());
    dialog.querySelector('[data-action="download-report"]').addEventListener('click', () => {
      downloadVisualReport(data);
    });
    dialog.querySelector('[data-action="download-excel"]').addEventListener('click', () => {
      downloadWorkbook(data);
    });
  }

  function encodeCell(columnIndex, rowNumber) {
    return XLSX.utils.encode_col(columnIndex) + rowNumber;
  }

  function ensureStyledCells(sheet, rowStart, rowEnd, columnCount) {
    for (let row = rowStart; row <= rowEnd; row += 1) {
      for (let column = 0; column < columnCount; column += 1) {
        const address = encodeCell(column, row);
        if (!sheet[address]) sheet[address] = { t: 's', v: '' };
      }
    }
    const range = XLSX.utils.decode_range(sheet['!ref']);
    range.e.c = Math.max(range.e.c, columnCount - 1);
    range.e.r = Math.max(range.e.r, rowEnd - 1);
    sheet['!ref'] = XLSX.utils.encode_range(range);
  }

  function workbookStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><color rgb="FF20242C"/><name val="Arial"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FF20242C"/><name val="Arial"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF315EFB"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFF7A00"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8F0FF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD9DEE8"/></left>
      <right style="thin"><color rgb="FFD9DEE8"/></right>
      <top style="thin"><color rgb="FFD9DEE8"/></top>
      <bottom style="thin"><color rgb="FFD9DEE8"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="15">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="10" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="4" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="10" fontId="2" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="4" fontId="2" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="3" fontId="2" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
  }

  function styleForCell(sheetIndex, column, row, options) {
    if (row === 1) return 1;
    if (row === 2) return 2;
    if (row === 4) return 3;

    const isHighlight = options.highlightRows.has(row);
    const isTotal = options.totalRowNumber === row;
    if (isTotal) {
      if (sheetIndex === 0 && column === 'C') return 12;
      if (sheetIndex === 0 && column === 'B') return 13;
      if (sheetIndex === 1 && PERCENT_COLUMNS.has(column)) return 12;
      if (sheetIndex === 1 && (column === 'B' || column === 'L')) return 13;
      if (sheetIndex === 1 && COUNT_COLUMNS.has(column)) return 14;
      return 6;
    }

    if (sheetIndex === 0) {
      if (column === 'B') return isHighlight ? 10 : 9;
      if (column === 'C') return isHighlight ? 8 : 7;
      return isHighlight ? 5 : 4;
    }
    if (PERCENT_COLUMNS.has(column)) return isHighlight ? 8 : 7;
    if (column === 'B' || column === 'L') return isHighlight ? 10 : 9;
    if (COUNT_COLUMNS.has(column)) return isHighlight ? 5 : 11;
    return isHighlight ? 5 : 4;
  }

  function injectSheetStyles(xml, sheetIndex, options) {
    let updated = xml.replace(/<c r="([A-Z]+)(\d+)"([^>]*)>/g, (match, column, rowText, rest) => {
      const row = Number(rowText);
      const styleIndex = styleForCell(sheetIndex, column, row, options);
      const cleanRest = rest.replace(/\s+s="\d+"/g, '');
      return '<c r="' + column + row + '" s="' + styleIndex + '"' + cleanRest + '>';
    });
    updated = updated.replace(
      /<sheetView workbookViewId="0"(?:\/>|>[\s\S]*?<\/sheetView>)/,
      '<sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView>'
    );
    if (sheetIndex === 1 && options.lastDataRow >= 5) {
      let priority = 1;
      const rules = [];
      for (let columnIndex = 1; columnIndex <= 13; columnIndex += 1) {
        const column = XLSX.utils.encode_col(columnIndex);
        const color = column === 'L'
          ? 'FFFF7A00'
          : column === 'M'
            ? 'FF16A085'
            : 'FF5B82E8';
        rules.push(
          '<conditionalFormatting sqref="' + column + '5:' + column + options.lastDataRow + '">' +
          '<cfRule type="dataBar" priority="' + priority++ + '"><dataBar>' +
          '<cfvo type="min"/><cfvo type="max"/><color rgb="' + color + '"/>' +
          '</dataBar></cfRule></conditionalFormatting>'
        );
      }
      updated = updated.replace('<ignoredErrors>', rules.join('') + '<ignoredErrors>');
    }
    return updated;
  }

  function replaceZipText(cfb, path, text) {
    const entry = XLSX.CFB.find(cfb, path);
    if (!entry) throw new Error('工作簿缺少文件：' + path);
    const bytes = new TextEncoder().encode(text);
    entry.content = bytes;
    entry.size = bytes.byteLength;
  }

  function styledWorkbookBytes(workbook, styleOptions) {
    const base = XLSX.write(workbook, {
      type: 'array',
      bookType: 'xlsx',
      compression: true,
    });
    const cfb = XLSX.CFB.read(new Uint8Array(base), { type: 'array' });
    replaceZipText(cfb, '/xl/styles.xml', workbookStylesXml());

    styleOptions.forEach((options, index) => {
      const path = '/xl/worksheets/sheet' + (index + 1) + '.xml';
      const entry = XLSX.CFB.find(cfb, path);
      if (!entry) throw new Error('工作簿缺少工作表 XML。');
      const xml = new TextDecoder().decode(entry.content);
      replaceZipText(cfb, path, injectSheetStyles(xml, index, options));
    });
    return XLSX.CFB.write(cfb, { type: 'array', fileType: 'zip', compression: true });
  }

  function downloadWorkbook(data) {
    if (typeof XLSX === 'undefined' || !XLSX.utils || !XLSX.CFB) {
      throw new Error('Excel 导出组件未加载，请刷新页面后重试。');
    }
    const spendSheet = buildSpendSheet(data);
    const detail = buildDetailSheet(data);
    ensureStyledCells(spendSheet, 4, 9, 3);
    ensureStyledCells(detail.sheet, 4, detail.tableRows.length + 4, 14);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, spendSheet, '花费占比');
    XLSX.utils.book_append_sheet(workbook, detail.sheet, '营销场景明细');

    const highlightRows = new Set();
    detail.tableRows.forEach((row, index) => {
      if (String(row[0]).includes('超级短视频') || row[0] === '短视频展现数据') {
        highlightRows.add(index + 5);
      }
    });
    const bytes = styledWorkbookBytes(workbook, [
      {
        highlightRows: new Set([8]),
        totalRowNumber: 5,
      },
      {
        highlightRows,
        totalRowNumber: detail.totalRowNumber,
        lastDataRow: detail.tableRows.length + 4,
      },
    ]);
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '万相台数据报告_' + data.startTime + '_' + data.endTime + '.xlsx';
    anchor.style.display = 'none';
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function exportReport() {
    if (exporting) return;
    exporting = true;
    const button = document.getElementById(BUTTON_ID);
    if (button) {
      button.disabled = true;
      button.textContent = '正在导出…';
    }
    try {
      const dateRange = lastThirtyFullDays();
      showDialog(
        '正在准备 ' + dateRange.startTime + ' 至 ' + dateRange.endTime + ' 的30天数据…',
        false
      );
      const data = await requestReportData(dateRange);
      await saveBusinessDefenseWxtSnapshot(data, 'marketingScene');
      showDialog('数据读取完成，正在生成可视化报告…', false);
      downloadVisualReport(data);
      renderReportPreview(data);
    } catch (error) {
      showDialog(error && error.message ? error.message : '万相台报告导出失败。', true);
    } finally {
      exporting = false;
      if (button) {
        button.disabled = false;
        button.textContent = '导出万相台报告';
      }
    }
  }

  async function exportShortVideoDetail() {
    if (exporting) return;
    exporting = true;
    const button = document.getElementById(BUTTON_ID);
    if (button) {
      button.disabled = true;
      button.textContent = '正在诊断…';
    }
    try {
      const dateRange = currentShortVideoDateRange();
      showDialog(
        '正在读取 ' + dateRange.startTime + ' 至 ' + dateRange.endTime +
        ' 的万相台双归因数据…',
        false
      );
      const data = await requestReportData(dateRange, 'shortVideoDetail');
      const targetVideoGroups = collectGuangheTargetGroups(data);
      showDialog(
        '万相台数据读取完成；正在光合定向匹配 ' +
        formatInteger(targetVideoGroups.length) +
        ' 个视频，并跳过“其他用户内容”…',
        false
      );
      let guangheSync;
      try {
        guangheSync = await requestAutomaticGuangheSync(targetVideoGroups);
      } catch (syncError) {
        guangheSync = {
          ok: false,
          code: String(syncError && syncError.code || 'GUANGHE_SYNC_FAILED'),
          message: syncError && syncError.message
            ? syncError.message
            : '光合作品定向匹配失败。',
        };
      }
      showDialog(
        guangheSync.ok
          ? '光合已匹配 ' + formatInteger(guangheSync.matchedCount) + '/' +
            formatInteger(guangheSync.targetCount) + ' 个视频，正在关联商品ID…'
          : '光合匹配未完成：' + String(guangheSync.message || '未知原因') +
            '；将使用万相台付费数据继续生成报告…',
        false
      );
      await enrichShortVideoWithGuanghe(data, guangheSync);
      await saveBusinessDefenseWxtSnapshot(data, 'shortVideoDetail');
      showDialog('关联完成，正在生成诊断报告…', false);
      renderShortVideoDiagnosis(data);
    } catch (error) {
      showDialog(error && error.message ? error.message : '短视频诊断报告生成失败。', true);
    } finally {
      exporting = false;
      if (button) {
        button.disabled = false;
        button.textContent = '生成诊断报告';
      }
    }
  }

  function writeContentDiagnosisWxtSection(runId, section, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get([CONTENT_DIAGNOSIS_WXT_KEY], (stored) => {
        const readError = chrome.runtime.lastError;
        if (readError) {
          reject(new Error(readError.message || '万相台报告快照读取失败。'));
          return;
        }
        const previous = stored && stored[CONTENT_DIAGNOSIS_WXT_KEY];
        const snapshot = previous && previous.runId === runId
          ? Object.assign({}, previous)
          : {
            schema: 1,
            runId,
            createdAt: Date.now(),
            marketing: null,
            shortVideo: null,
          };
        snapshot.savedAt = Date.now();
        snapshot.styles = reportStyles();
        snapshot[section] = value;
        chrome.storage.local.set({ [CONTENT_DIAGNOSIS_WXT_KEY]: snapshot }, () => {
          const writeError = chrome.runtime.lastError;
          if (writeError) {
            reject(new Error(writeError.message || '万相台报告快照保存失败。'));
            return;
          }
          resolve(snapshot);
        });
      });
    });
  }

  async function generateContentDiagnosisMarketingReport(runId) {
    const dateRange = lastThirtyFullDays();
    try {
      const data = await requestReportData(dateRange, 'marketingScene', { silent: true });
      await saveBusinessDefenseWxtSnapshot(data, 'marketingScene');
      const section = {
        ok: true,
        savedAt: Date.now(),
        startTime: data.startTime,
        endTime: data.endTime,
        rowCount: Array.isArray(data.marketingRows) ? data.marketingRows.length : 0,
        markup: reportMarkup(data),
      };
      await writeContentDiagnosisWxtSection(runId, 'marketing', section);
      return {
        ok: true,
        startTime: section.startTime,
        endTime: section.endTime,
        rowCount: section.rowCount,
      };
    } catch (error) {
      const message = error && error.message ? error.message : '万相台营销场景报告生成失败。';
      await writeContentDiagnosisWxtSection(runId, 'marketing', {
        ok: false,
        savedAt: Date.now(),
        message,
      });
      throw new Error(message);
    }
  }

  async function generateContentDiagnosisShortVideoReport(runId) {
    const dateRange = currentShortVideoDateRange();
    try {
      const data = await requestReportData(dateRange, 'shortVideoDetail', { silent: true });
      const targetVideoGroups = collectGuangheTargetGroups(data);
      let guangheSync;
      try {
        guangheSync = await requestAutomaticGuangheSync(targetVideoGroups);
      } catch (syncError) {
        guangheSync = {
          ok: false,
          code: String(syncError && syncError.code || 'GUANGHE_SYNC_FAILED'),
          message: syncError && syncError.message
            ? syncError.message
            : '光合作品定向匹配失败。',
        };
      }
      await enrichShortVideoWithGuanghe(data, guangheSync);
      const matchedCount = Number(guangheSync && guangheSync.matchedCount) || 0;
      const targetCount = targetVideoGroups.length;
      const guanghePartial = Boolean(
        !guangheSync || guangheSync.ok === false ||
        guangheSync.complete === false || guangheSync.timedOut === true ||
        guangheSync.failed === true || guangheSync.capped === true ||
        (targetCount > 0 && matchedCount === 0)
      );
      let guangheWarning = '';
      if (!guangheSync || guangheSync.ok === false) {
        guangheWarning = String(guangheSync && guangheSync.message ||
          '光合作品匹配未完成，报告使用万相台付费数据。');
      } else if (targetCount > 0 && matchedCount === 0) {
        guangheWarning = '光合未匹配到万相台视频，请核对光合权限、登录账号与作品 ID。';
      } else if (guanghePartial) {
        guangheWarning = '光合作品匹配未完整扫描，本章已标记为部分完成。';
      }
      const section = {
        ok: true,
        partial: guanghePartial,
        savedAt: Date.now(),
        startTime: data.startTime,
        endTime: data.endTime,
        targetCount,
        matchedCount,
        warning: guangheWarning,
        markup: shortVideoDiagnosisMarkup(data),
      };
      await writeContentDiagnosisWxtSection(runId, 'shortVideo', section);
      return {
        ok: true,
        partial: section.partial,
        startTime: section.startTime,
        endTime: section.endTime,
        targetCount: section.targetCount,
        matchedCount: section.matchedCount,
        warning: section.warning,
      };
    } catch (error) {
      const message = error && error.message ? error.message : '万相台短视频诊断生成失败。';
      await writeContentDiagnosisWxtSection(runId, 'shortVideo', {
        ok: false,
        savedAt: Date.now(),
        message,
      });
      throw new Error(message);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || ![
      'WXT_GENERATE_MARKETING_REPORT_SNAPSHOT',
      'WXT_GENERATE_SHORT_VIDEO_REPORT_SNAPSHOT',
    ].includes(message.type)) return;
    const runId = String(message.runId || '').slice(0, 120);
    if (!runId) {
      sendResponse({ ok: false, message: '报告任务缺少运行标识。' });
      return;
    }
    const task = message.type === 'WXT_GENERATE_SHORT_VIDEO_REPORT_SNAPSHOT'
      ? generateContentDiagnosisShortVideoReport(runId)
      : generateContentDiagnosisMarketingReport(runId);
    task.then(sendResponse).catch((error) => sendResponse({
      ok: false,
      message: error && error.message ? error.message : '万相台报告生成失败。',
    }));
    return true;
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || ![
      'WXT_RUN_BUSINESS_DEFENSE_METRICS',
      'WXT_RUN_BUSINESS_DEFENSE_REPORT',
    ].includes(message.type)) return;
    const dateRange = lastThirtyFullDays();
    requestReportData(dateRange, 'marketingScene', { silent: true })
      .then(async (data) => {
        const rows = Array.isArray(data.marketingRows) ? data.marketingRows : [];
        const scene = rows.find((row) => String(row && (row.scene1Name || row.sceneName) || '').includes('超级短视频')) ||
          rows.find((row) => String(row && (row.scene1Name || row.sceneName) || '').includes('短视频')) || {};
        const businessMetrics = data.businessDefenseMetrics || {};
        const click = data.shortVideoClick || {};
        const display = data.shortVideoDisplay || data.shortVideo || {};
        const spend = data.spendSummary || {};
        const totalSpend = [spend.totalCharge, spend.onebpTotalCharge, spend.charge]
          .map(numberOrNull).find((value) => value !== null);
        const shortVideoSpend = [scene.charge, spend.shortVideoCharge]
          .map(numberOrNull).find((value) => value !== null);
        const sceneName = String(scene.scene1Name || scene.sceneName || '');
        const hasDirectPotentialSignal = [
          businessMetrics.displayPotentialRatio,
          display.inshopPotentialUvRate,
          display.potentialUvRate,
        ].map(numberOrNull).some((value) => value !== null);
        const hasShortVideoScope = sceneName.includes('短视频') ||
          shortVideoSpend !== undefined ||
          hasDirectPotentialSignal;
        const hasPaidActivity = hasShortVideoScope && shortVideoSpend !== undefined && shortVideoSpend > 0;
        const hasTrafficActivity = hasShortVideoScope && [
          click.adPv,
          display.adPv,
          click.click,
          display.click,
          click.inshopUv,
          display.inshopUv,
          click.inshopPotentialUv,
          display.inshopPotentialUv,
        ].map(numberOrNull).some((value) => value !== null && value > 0) ||
          hasDirectPotentialSignal;
        const rawClickRoi = [businessMetrics.lastClickRoi, scene.roi, click.roi, ratio(click.alipayInshopAmt, click.charge)]
          .map(numberOrNull).find((value) => value !== null);
        const rawDisplayRoi = [businessMetrics.displayRoi, display.roi, ratio(display.alipayInshopAmt, display.charge)]
          .map(numberOrNull).find((value) => value !== null);
        const rawPotentialRatio = [
          businessMetrics.displayPotentialRatio,
          display.inshopPotentialUvRate,
          display.potentialUvRate,
          ratio(display.inshopPotentialUv, display.inshopUv),
        ].map(numberOrNull).find((value) => value !== null);
        const clickRoi = hasPaidActivity ? rawClickRoi : undefined;
        const displayRoi = hasPaidActivity ? rawDisplayRoi : undefined;
        const potentialRatio = hasPaidActivity || hasTrafficActivity ? rawPotentialRatio : undefined;
        data.businessDefenseMetrics = {
          ...businessMetrics,
          lastClickRoi: clickRoi === undefined ? null : clickRoi,
          displayRoi: displayRoi === undefined ? null : displayRoi,
          displayPotentialRatio: potentialRatio === undefined ? null : potentialRatio,
        };
        data.businessDefenseActivity = {
          hasShortVideoScope,
          hasPaidActivity,
          hasTrafficActivity,
          hasDirectPotentialSignal,
          shortVideoSpend: shortVideoSpend === undefined ? null : shortVideoSpend,
        };
        const metrics = [
          { name: '无界花费', value: totalSpend },
          { name: '超级短视频花费', value: shortVideoSpend },
          { name: '末次点击归因投产', value: clickRoi },
          { name: '展现投产', value: displayRoi },
          { name: '潜客比', value: potentialRatio },
        ];
        const capturedMetrics = metrics.filter((item) => item.value !== undefined).map((item) => item.name);
        const missingMetrics = metrics.filter((item) => item.value === undefined).map((item) => item.name);
        await saveBusinessDefenseWxtSnapshot(data, 'marketingScene');
        if (!capturedMetrics.length) {
          throw new Error('万相台导出报告取数链路未返回任何所需指标。');
        }
        sendResponse({
          ok: true,
          partial: missingMetrics.length > 0,
          source: '万相台导出报告取数链路',
          capturedMetrics,
          missingMetrics,
          savedAt: Date.now(),
          startTime: data.startTime,
          endTime: data.endTime,
        });
      })
      .catch((error) => sendResponse({
        ok: false,
        message: error && error.message ? error.message : '万相台自动取数失败。',
      }));
    return true;
  });

  ensureButton();
  window.addEventListener('hashchange', ensureButton);
})();

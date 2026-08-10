// 生意参谋页面适配：只读取已渲染 DOM，不请求或重放业务接口。
(function () {
  'use strict';

  const ancestorOrigins = Array.from(location.ancestorOrigins || []);
  const embeddedInSycm = window.top !== window && ancestorOrigins.includes('https://sycm.taobao.com');
  const inheritedSycmFrame = embeddedInSycm && ['about:', 'blob:', 'data:'].includes(location.protocol);
  if (location.hostname !== 'sycm.taobao.com' && !embeddedInSycm && !inheritedSycmFrame) return;
  if (window.__sycmDiagnosisScriptV2282) return;
  window.__sycmDiagnosisScriptV2282 = true;

  const PREFIX = '[生意参谋诊断]';
  const SYCM_CONTENT_ANALYSIS_PATH = '/xsite/contentanalysis/overview_new_v2';
  const BUTTON_ID = 'sycm-diagnosis-trigger';
  const PANEL_ID = 'sycm-diagnosis-panel';
  const CONTENT_CACHE_KEY = 'sycmContentDiagnosisSnapshotV1';
  const BUSINESS_DEFENSE_TRAFFIC_KEY = 'businessDefenseSycmTrafficSnapshotV1';
  const RETRY_AFTER_RELOAD_KEY = 'sycmDiagnosisRetryAfterExtensionReload';
  const CHANNELS = ['全部', '首猜', '逛逛', '搜索', '其他'];
  const REFERENCES = {
    shortVideoShare: 0.60,
    seedingShare: 0.10,
    ratioGap: 6,
    recommendedShare: 0.70,
  };
  let currentPath = location.pathname;
  let running = false;
  let lastMouseClickSummary = '';

  function isTrafficPage() {
    return location.pathname.includes('/flow/monitor/overview');
  }

  function isContentPage() {
    return location.pathname === SYCM_CONTENT_ANALYSIS_PATH;
  }

  function isGrassPage() {
    return location.pathname === '/xsite/frame/content/grass';
  }

  function isGrassDataContext() {
    if (!document.body) return false;
    const text = normalizeText(document.body.innerText || document.body.textContent);
    return text.includes('内容种草') &&
      text.includes('阅读UV') &&
      text.includes('商家GMV') &&
      text.includes('订单商品成交GMV');
  }

  function isContentDataContext() {
    if (!document.body) return false;
    const text = normalizeText(document.body.innerText || document.body.textContent);
    return text.includes('内容查看人数') && text.includes('消费渠道');
  }

  function isContentOverviewContext() {
    if (!document.body) return false;
    const text = normalizeText(document.body.innerText || document.body.textContent);
    return text.includes('核心数据') &&
      text.includes('数据时间范围') &&
      text.includes('内容供给') &&
      text.includes('内容效果');
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, '').replace(/[：:]/g, '').trim();
  }

  function isVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function isViewportInteractable(element) {
    if (!isVisible(element)) return false;
    const rect = element.getBoundingClientRect();
    const clientX = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const clientY = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    if (
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= window.innerHeight ||
      rect.left >= window.innerWidth
    ) {
      return false;
    }
    const hitTarget = document.elementFromPoint(clientX, clientY);
    return Boolean(hitTarget && (
      element === hitTarget ||
      element.contains(hitTarget) ||
      hitTarget.contains(element)
    ));
  }

  function getElementText(element) {
    return normalizeText(element && (element.innerText || element.textContent));
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function parseDisplayNumber(value) {
    const match = String(value == null ? '' : value)
      .replace(/[,，]/g, '')
      .replace(/\s+/g, '')
      .match(/(-?\d+(?:\.\d+)?)(万|亿)?/);
    if (!match) return null;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return null;
    if (match[2] === '万') return base * 10000;
    if (match[2] === '亿') return base * 100000000;
    return base;
  }

  function numberAfterLabel(text, labels) {
    const source = normalizeText(text);
    for (const label of labels) {
      const normalizedLabel = normalizeText(label);
      const index = source.indexOf(normalizedLabel);
      if (index === -1) continue;
      const tail = source.slice(index + normalizedLabel.length);
      const match = tail.match(/(-?\d[\d,，]*(?:\.\d+)?)(万|亿)?/);
      if (match) return parseDisplayNumber(match[0]);
    }
    return null;
  }

  function textMatches(element, labels) {
    const text = getElementText(element);
    return labels.some((label) => text.includes(normalizeText(label)));
  }

  function findTextElements(labels) {
    const normalizedLabels = labels.map(normalizeText);
    return Array.from(document.querySelectorAll('body *')).filter((element) => {
      if (!isVisible(element) || element.closest('#' + BUTTON_ID + ', #' + PANEL_ID)) return false;
      const text = getElementText(element);
      return normalizedLabels.some((label) => text === label || text.includes(label));
    }).sort((a, b) => {
      const aText = getElementText(a);
      const bText = getElementText(b);
      const aExact = normalizedLabels.includes(aText) ? 0 : 1;
      const bExact = normalizedLabels.includes(bText) ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return aText.length - bText.length;
    });
  }

  function readMetric(labels, options) {
    const config = options || {};
    const candidates = findTextElements(labels);
    if (config.preferLower) {
      candidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    }

    for (const element of candidates) {
      let container = element;
      for (let level = 0; level < 7 && container && container !== document.body; level += 1, container = container.parentElement) {
        const text = container.innerText || container.textContent || '';
        const normalized = normalizeText(text);
        if (normalized.length > 360 || !textMatches(container, labels)) continue;
        const value = numberAfterLabel(text, labels);
        if (value !== null) return { value, text: normalizeText(text) };
      }
    }
    // 生意参谋的指标标题与数值有时被拆到不同的深层节点，卡片容器会同时
    // 包含趋势图文本。此时从已渲染的整页文本中按标题后的首个数值兜底读取。
    if (config.allowBodyFallback !== false && document.body) {
      const text = document.body.innerText || document.body.textContent || '';
      const value = numberAfterLabel(text, labels);
      if (value !== null) return { value, text: normalizeText(text) };
    }
    return null;
  }

  function dateModeFromLabel(label) {
    const normalized = normalizeText(label);
    if (normalized === '日') return 'day';
    if (/^(?:近|最近|过去)?7(?:日|天)$/.test(normalized)) return 'last7';
    if (/^(?:近|最近|过去)?30(?:日|天)$/.test(normalized)) return 'last30';
    if (normalized === '周' || normalized === '自然周') return 'naturalWeek';
    if (normalized === '月' || normalized === '自然月') return 'naturalMonth';
    if (normalized === '自定义') return 'custom';
    if (normalized === '实时') return 'realtime';
    return '';
  }

  function findTrafficDateToolbar() {
    const customLabels = findTextElements(['自定义']).filter((element) => (
      getElementText(element) === '自定义' && isViewportInteractable(element)
    ));
    const candidates = [];
    for (const label of customLabels) {
      let container = label.parentElement;
      for (let level = 0; level < 7 && container && container !== document.body; level += 1, container = container.parentElement) {
        const text = getElementText(container);
        const rect = container.getBoundingClientRect();
        if (
          text.includes('自定义') &&
          (text.includes('7天') || text.includes('7日')) &&
          (text.includes('30天') || text.includes('30日')) &&
          text.includes('日') &&
          rect.width >= 220 &&
          rect.width <= 1200 &&
          rect.height >= 24 &&
          rect.height <= 100
        ) {
          candidates.push(container);
        }
      }
    }
    return candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || null;
  }

  function dateModeActivationScore(element, toolbar) {
    let score = 0;
    let node = element;
    for (let level = 0; level < 3 && node && toolbar.contains(node); level += 1, node = node.parentElement) {
      const className = String(node.className || '').toLowerCase();
      if (/active|selected|checked|current|primary/.test(className)) score += 20;
      if (node.getAttribute('aria-selected') === 'true') score += 20;
      if (node.getAttribute('aria-checked') === 'true') score += 20;
      const checkedInput = node.matches('input:checked') ? node : node.querySelector('input:checked');
      if (checkedInput) score += 20;
    }
    const color = window.getComputedStyle(element).color.match(/\d+(?:\.\d+)?/g) || [];
    if (color.length >= 3) {
      const red = Number(color[0]);
      const green = Number(color[1]);
      const blue = Number(color[2]);
      if (blue >= 170 && blue > red * 1.25 && blue > green * 1.08) score += 5;
    }
    return score;
  }

  function detectTrafficDateMode() {
    const toolbar = findTrafficDateToolbar();
    const root = document.body;
    if (!root) return '';
    const candidates = Array.from(root.querySelectorAll('button, [role="button"], [role="radio"], label, a, span')).filter((element) => (
      isVisible(element) &&
      dateModeFromLabel(getElementText(element)) &&
      element.getBoundingClientRect().width <= 110 &&
      element.getBoundingClientRect().height <= 60
    )).map((element) => ({
      element,
      mode: dateModeFromLabel(getElementText(element)),
      score: dateModeActivationScore(element, toolbar || root),
    })).filter((candidate) => candidate.mode);
    const best = candidates.sort((left, right) => right.score - left.score)[0];
    return best && best.score > 0 ? best.mode : '';
  }

  function findTrafficThirtyDayTarget() {
    const toolbar = findTrafficDateToolbar();
    const root = document.body;
    if (!root) return null;
    const candidates = Array.from(root.querySelectorAll('button, [role="button"], [role="radio"], label, a, span')).filter((element) => {
      const text = getElementText(element);
      if (!isVisible(element) || dateModeFromLabel(text) !== 'last30') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.width <= 110 && rect.height > 0 && rect.height <= 60;
    }).sort((left, right) => {
      const leftInToolbar = toolbar && toolbar.contains(left) ? 0 : 1;
      const rightInToolbar = toolbar && toolbar.contains(right) ? 0 : 1;
      if (leftInToolbar !== rightInToolbar) return leftInToolbar - rightInToolbar;
      const leftSemantic = left.matches('button, [role="button"], [role="radio"]') ? 0 : 1;
      const rightSemantic = right.matches('button, [role="button"], [role="radio"]') ? 0 : 1;
      if (leftSemantic !== rightSemantic) return leftSemantic - rightSemantic;
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    });
    const directButtons = candidates.filter((element) => !element.querySelector('input'));
    return directButtons[0] || candidates[0] || null;
  }

  async function waitForTrafficThirtyDayTarget(timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < (Number(timeoutMs) || 20000)) {
      const target = findTrafficThirtyDayTarget();
      if (target) return target;
      await sleep(400);
    }
    return null;
  }

  async function ensureTrafficThirtyDayMode() {
    let context = getDateContext();
    const initialPageText = normalizeText(document.body && (document.body.innerText || document.body.textContent));
    const initialMetricsReady = initialPageText.includes('较前30日') || initialPageText.includes('较前30天');
    if (
      context.dateMode === 'last30' &&
      canonicalDateRange(context) &&
      initialMetricsReady
    ) {
      return context;
    }

    if (context.dateMode !== 'last30') {
      const target = await waitForTrafficThirtyDayTarget(20000);
      if (!target) throw new Error('未找到流量页日期工具条中的“30天”按钮。');
      if (!(await dispatchMainWorldClickAtCenter(target))) {
        throw new Error('流量页“30天”按钮不可点击：' + (lastMouseClickSummary || '未记录点击结果') + '。');
      }
    }

    const startedAt = Date.now();
    let lastRange = '';
    let stableMatches = 0;
    while (Date.now() - startedAt < 15000) {
      await sleep(320);
      context = getDateContext();
      const range = canonicalDateRange(context);
      const pageText = normalizeText(document.body && (document.body.innerText || document.body.textContent));
      const metricsUseThirtyDayPeriod = pageText.includes('较前30日') || pageText.includes('较前30天');
      if (context.dateMode !== 'last30' || !range || !metricsUseThirtyDayPeriod) {
        lastRange = '';
        stableMatches = 0;
        continue;
      }
      stableMatches = range === lastRange ? stableMatches + 1 : 1;
      lastRange = range;
      if (stableMatches >= 3) return context;
    }
    throw new Error('点击“30天”后流量页日期未完成切换，请等待页面稳定后重试。');
  }

  function getDateContext() {
    const params = new URLSearchParams(location.search);
    const dateRange = params.get('dateRange') || '';
    const dateType = params.get('dateType') || '';
    const text = document.body ? document.body.innerText : '';
    const datePattern = '20\\d{2}[./-]\\d{1,2}[./-]\\d{1,2}';
    const labeledMatch = text.match(new RegExp(
      '(?:数据时间范围|图表数据周期|统计时间)\\s*[：:]?\\s*(' + datePattern + ')' +
      '(?:\\s*[-~至—–]\\s*(' + datePattern + '))?'
    ));
    const genericRange = (text.match(new RegExp(
      datePattern + '\\s*[-~至—–]\\s*' + datePattern
    )) || [])[0] || '';
    const visibleRange = labeledMatch
      ? labeledMatch[1] + '|' + (labeledMatch[2] || labeledMatch[1])
      : genericRange;
    const normalizedVisibleRange = normalizeText(visibleRange);
    return {
      dateRange: isTrafficPage()
        ? dateRange.replace(/%7C/ig, '|')
        : (normalizedVisibleRange || dateRange.replace(/%7C/ig, '|')),
      dateType,
      visibleRange: normalizedVisibleRange,
      dateMode: isTrafficPage() ? detectTrafficDateMode() : '',
    };
  }

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

  function sameDateContext(left, right) {
    if (!left || !right) return false;
    const leftRange = canonicalDateRange(left);
    const rightRange = canonicalDateRange(right);
    return Boolean(leftRange && rightRange && leftRange === rightRange);
  }

  function storageSet(key, value) {
    return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
  }

  function requestOpenContentPageSnapshot(dateContext, backgroundOnly) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'SYCM_CAPTURE_CONTENT_TOTALS',
        expectedDateRange: canonicalDateRange(dateContext),
        expectedDateMode: String(dateContext && dateContext.dateMode || ''),
        backgroundOnly: backgroundOnly === true,
      }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, message: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, message: '内容页未响应。' });
      });
    });
  }

  function requestChannelDiagnosisFromDataFrame() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'SYCM_RUN_CHANNEL_DIAGNOSIS' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, message: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, message: '内容指标层未响应。' });
      });
    });
  }

  function formatInteger(value) {
    return Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '—';
  }

  function formatMoney(value) {
    if (!Number.isFinite(value)) return '—';
    if (Math.abs(value) >= 10000) {
      const wan = value / 10000;
      return wan.toFixed(wan >= 100 ? 1 : 2).replace(/\.0$/, '') + '万';
    }
    return Math.round(value).toLocaleString('zh-CN');
  }

  function formatPercent(value, digits) {
    if (!Number.isFinite(value)) return '—';
    return (value * 100).toFixed(digits == null ? 0 : digits).replace(/\.0+$/, '') + '%';
  }

  function formatFixed(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : '—';
  }

  function safeDivide(numerator, denominator) {
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0 ? numerator / denominator : null;
  }

  function findExactTextElement(text, selector) {
    const normalized = normalizeText(text);
    const targets = selector ? Array.from(document.querySelectorAll(selector)) : Array.from(document.querySelectorAll('body *'));
    return targets.filter((element) => isVisible(element) && !element.closest('#' + PANEL_ID) && getElementText(element) === normalized)
      .sort((a, b) => getElementText(a).length - getElementText(b).length)[0] || null;
  }

  function closestClickTarget(element) {
    if (!element) return null;
    const interactive = element.closest('button, a, [role="button"], [role="tab"], [role="combobox"], [tabindex]');
    if (interactive && isVisible(interactive)) return interactive;
    return element;
  }

  function getMetricCardCandidates(labelElement, labels) {
    const cards = [];
    let element = labelElement;
    for (let level = 0; level < 8 && element && element !== document.body; level += 1, element = element.parentElement) {
      const rect = element.getBoundingClientRect();
      const text = getElementText(element);
      const hasMetricLabel = labels.some((label) => text.includes(normalizeText(label)));
      const isCardSized = rect.width >= 140 && rect.width <= 1600 && rect.height >= 56 && rect.height <= 300;
      if (hasMetricLabel && isCardSized && text.length <= 260) cards.push(element);
    }
    return cards;
  }

  function triggerCardClick(element) {
    if (!element) return;
    // 指标卡依赖鼠标事件和冒泡，单次模拟完整点击链。
    const eventOptions = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new MouseEvent('mousedown', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseup', eventOptions));
    element.dispatchEvent(new MouseEvent('click', eventOptions));
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function hasActiveExtensionContext() {
    try {
      return Boolean(chrome && chrome.runtime && chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

  function isExtensionContextInvalidError(error) {
    const message = String(error && error.message || error || '');
    return message.includes('Extension context invalidated') ||
      message.includes('context invalidated');
  }

  function reloadAndRetryDiagnosis() {
    try {
      window.sessionStorage.setItem(RETRY_AFTER_RELOAD_KEY, '1');
    } catch (error) {
      console.warn(PREFIX, '无法记录诊断重试状态:', error);
    }
    window.location.reload();
  }

  function compactTextClickTarget(element) {
    if (!element) return null;
    const expectedText = getElementText(element);
    let target = element;
    let container = element.parentElement;
    for (let level = 0; level < 4 && container; level += 1, container = container.parentElement) {
      const rect = container.getBoundingClientRect();
      if (getElementText(container) !== expectedText || rect.width > 180 || rect.height > 80) break;
      target = container;
    }
    return closestClickTarget(target);
  }

  function findContentDateToolbar() {
    const labels = findTextElements(['数据时间范围']);
    const candidates = [];
    for (const label of labels) {
      let container = label.parentElement;
      for (let level = 0; level < 8 && container && container !== document.body; level += 1, container = container.parentElement) {
        const text = getElementText(container);
        const rect = container.getBoundingClientRect();
        if (
          text.includes('数据时间范围') &&
          text.includes('7日') &&
          text.includes('30日') &&
          text.includes('自定义') &&
          rect.width >= 320 &&
          rect.height >= 24 &&
          rect.height <= 140
        ) {
          candidates.push(container);
        }
      }
    }
    return candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || null;
  }

  function findDatePresetTarget(preset) {
    const toolbar = findContentDateToolbar();
    if (!toolbar) return null;
    let candidates = Array.from(toolbar.querySelectorAll('*')).filter((element) => {
      if (!isViewportInteractable(element) || getElementText(element) !== normalizeText(preset)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.width <= 110 && rect.height > 0 && rect.height <= 60;
    });
    const visibleRadioButtons = candidates.filter((element) => (
      Array.from(element.classList || []).some((className) => className.startsWith('radioBtn--')) &&
      !element.querySelector('input')
    ));
    const directButtons = visibleRadioButtons.length
      ? visibleRadioButtons
      : candidates.filter((element) => !element.querySelector('input'));
    if (directButtons.length) candidates = directButtons;

    return candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || null;
  }

  function dispatchMainWorldClickAtCenter(element) {
    if (!element) return Promise.resolve(false);
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const hitTarget = document.elementFromPoint(clientX, clientY);
    if (!hitTarget || !(
      element === hitTarget ||
      element.contains(hitTarget) ||
      hitTarget.contains(element)
    )) {
      return Promise.resolve(false);
    }
    const targetToken = [
      'sycm',
      Date.now().toString(36),
      Math.random().toString(36).slice(2, 12),
    ].join('-');
    element.setAttribute('data-sycm-diagnosis-click-token', targetToken);

    return new Promise((resolve) => {
      const clearTargetToken = () => {
        if (element.getAttribute('data-sycm-diagnosis-click-token') === targetToken) {
          element.removeAttribute('data-sycm-diagnosis-click-token');
        }
      };
      try {
        chrome.runtime.sendMessage({
          type: 'SYCM_MAIN_WORLD_CLICK',
          clientX,
          clientY,
          expectedText: getElementText(element),
          targetToken,
        }, (response) => {
          clearTargetToken();
          if (chrome.runtime.lastError || !response || !response.ok) {
            lastMouseClickSummary = response && response.message
              ? response.message
              : (chrome.runtime.lastError && chrome.runtime.lastError.message) || '页面主环境点击未响应';
            resolve(false);
            return;
          }
          lastMouseClickSummary = response.summary || '页面主环境点击成功';
          resolve(true);
        });
      } catch (error) {
        clearTargetToken();
        lastMouseClickSummary = error && error.message
          ? error.message
          : '页面主环境点击未响应';
        resolve(false);
      }
    });
  }

  function isContentFrameContext() {
    if (!document.body) return false;
    const text = normalizeText(document.body.innerText || document.body.textContent);
    return text.includes('数据总览') &&
      text.includes('商品分析') &&
      text.includes('作品分析');
  }

  function findViewportTextTarget(text) {
    return findTextElements([text]).filter((element) => (
      getElementText(element) === normalizeText(text) &&
      isViewportInteractable(element)
    )).sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || null;
  }

  async function ensureContentEffectContext() {
    if (isContentDataContext()) return;
    if (!isContentOverviewContext()) {
      let overviewTab = null;
      const tabStartedAt = Date.now();
      while (Date.now() - tabStartedAt < 8000 && !overviewTab && !isContentOverviewContext()) {
        overviewTab = findViewportTextTarget('数据总览');
        if (!overviewTab) await sleep(220);
      }
      if (!isContentOverviewContext()) {
        if (!overviewTab || !(await dispatchMainWorldClickAtCenter(overviewTab))) {
          throw new Error('未能切换到内容页“数据总览”。');
        }
        const overviewStartedAt = Date.now();
        while (Date.now() - overviewStartedAt < 10000 && !isContentOverviewContext() && !isContentDataContext()) {
          await sleep(240);
        }
      }
    }
    if (isContentDataContext()) return;

    let effectTarget = null;
    const effectTargetStartedAt = Date.now();
    while (Date.now() - effectTargetStartedAt < 8000 && !effectTarget) {
      effectTarget = findViewportTextTarget('内容效果');
      if (!effectTarget) await sleep(220);
    }
    if (!effectTarget || !(await dispatchMainWorldClickAtCenter(effectTarget))) {
      throw new Error('未能切换到内容页“内容效果”。');
    }
    const effectStartedAt = Date.now();
    while (Date.now() - effectStartedAt < 12000) {
      await sleep(260);
      if (isContentDataContext()) return;
    }
    throw new Error('切换“内容效果”后指标未完成加载。');
  }

  function metricSignature() {
    try {
      const totals = readContentTotals();
      return [
        totals.contentViewers,
        totals.productClickers,
        totals.seedingAmount,
        totals.seedingShare,
      ].join('|');
    } catch (error) {
      return '';
    }
  }

  async function waitForExpectedDateRange(expectedDateRange, timeout) {
    const startedAt = Date.now();
    let lastSignature = '';
    let stableMatches = 0;
    while (Date.now() - startedAt < timeout) {
      await sleep(320);
      const actual = canonicalDateRange(getDateContext());
      if (actual !== expectedDateRange) {
        lastSignature = '';
        stableMatches = 0;
        continue;
      }
      const signature = metricSignature();
      if (!signature) {
        stableMatches = 0;
        continue;
      }
      stableMatches = signature === lastSignature ? stableMatches + 1 : 1;
      lastSignature = signature;
      if (stableMatches >= 3) return true;
    }
    return false;
  }

  async function selectSupportedDateMode(mode, expectedDateRange) {
    if (mode !== 'last30') throw new Error('当前版本仅支持30天日期口径。');
    const presetTarget = findDatePresetTarget('30日');
    if (!presetTarget || !(await dispatchMainWorldClickAtCenter(presetTarget))) {
      throw new Error('内容页“30日”日期按钮不可点击。');
    }
    if (!(await waitForExpectedDateRange(expectedDateRange, 8000))) {
      throw new Error('内容页切换到30日后，日期范围仍未与流量页一致。');
    }
  }

  async function alignContentDateFromDom(options) {
    const expectedDateRange = canonicalDateRange({
      visibleRange: options && options.expectedDateRange,
    });
    const expectedDateMode = String(options && options.expectedDateMode || '');
    const supportedDateModes = ['last30'];
    if (!expectedDateRange) {
      return { ok: false, retryable: false, message: '未收到有效的目标日期范围。' };
    }
    if (!supportedDateModes.includes(expectedDateMode)) {
      return {
        ok: false,
        retryable: false,
        message: '当前版本仅支持30天日期口径。',
      };
    }
    try {
      await ensureContentEffectContext();
    } catch (error) {
      return {
        ok: false,
        retryable: false,
        message: error && error.message ? error.message : '内容页指标视图切换失败。',
      };
    }

    const currentDateRange = canonicalDateRange(getDateContext());
    if (currentDateRange === expectedDateRange) {
      const stable = await waitForExpectedDateRange(expectedDateRange, 5000);
      return stable
        ? { ok: true, changed: false, dateContext: getDateContext() }
        : { ok: false, retryable: false, message: '内容页日期一致，但指标尚未稳定。' };
    }

    try {
      await selectSupportedDateMode(expectedDateMode, expectedDateRange);
    } catch (error) {
      const actual = canonicalDateRange(getDateContext());
      return {
        ok: false,
        retryable: false,
        message: '内容页日期模式自动对齐失败。目标：' + expectedDateRange.replace('|', ' 至 ') +
          '；当前：' + (actual ? actual.replace('|', ' 至 ') : '未识别') + '。' +
          (error && error.message ? error.message : ''),
      };
    }
    if (await waitForExpectedDateRange(expectedDateRange, 16000)) {
      return { ok: true, changed: true, dateContext: getDateContext() };
    }
    const actual = canonicalDateRange(getDateContext());
    return {
      ok: false,
      retryable: false,
      message: '内容页日期未能对齐。目标：' + expectedDateRange.replace('|', ' 至 ') +
        '；当前：' + (actual ? actual.replace('|', ' 至 ') : '未识别') + '。',
    };
  }

  function getProductVisitorMetricCards() {
    const productVisitorLabels = ['商品访客数'];
    const labels = findTextElements(productVisitorLabels)
      .filter((element) => {
        const text = getElementText(element);
        return text.includes('商品访客数') &&
          !text.includes('访问商品') &&
          !text.includes('30天前') &&
          text.length <= 24;
      })
      .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    const cards = [];
    const seen = new Set();
    for (const label of labels) {
      for (const card of getMetricCardCandidates(label, productVisitorLabels)) {
        if (seen.has(card)) continue;
        seen.add(card);
        cards.push(card);
      }
    }
    return cards.sort((left, right) => {
      const topDifference = right.getBoundingClientRect().top - left.getBoundingClientRect().top;
      if (topDifference) return topDifference;
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    });
  }

  function getProductSummaryCards() {
    const candidates = findTextElements(['访问商品', '商品访客数']);
    const cards = [];
    const seen = new Set();
    for (const candidate of candidates) {
      for (const card of getMetricCardCandidates(candidate, ['商品访客数'])) {
        if (seen.has(card)) continue;
        const text = getElementText(card);
        const value = numberAfterLabel(card.innerText || card.textContent || '', ['商品访客数']);
        if (!text.includes('访问商品') || !text.includes('商品访客数') || !Number.isFinite(value)) continue;
        seen.add(card);
        cards.push(card);
      }
    }
    return cards.sort((left, right) => {
      const topDifference = left.getBoundingClientRect().top - right.getBoundingClientRect().top;
      if (topDifference) return topDifference;
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    });
  }

  function getStoreSummaryCards() {
    const candidates = findTextElements(['访问店铺访客数', '访问店铺']);
    const cards = [];
    const seen = new Set();
    for (const candidate of candidates) {
      for (const card of getMetricCardCandidates(candidate, ['访问店铺', '访客数'])) {
        if (seen.has(card)) continue;
        const text = getElementText(card);
        const value = numberAfterLabel(
          card.innerText || card.textContent || '',
          ['访问店铺访客数', '访问店铺']
        );
        if (!text.includes('访问店铺') || !text.includes('访客数') || !Number.isFinite(value)) continue;
        seen.add(card);
        cards.push(card);
      }
    }
    return cards.sort((left, right) => {
      const topDifference = left.getBoundingClientRect().top - right.getBoundingClientRect().top;
      if (topDifference) return topDifference;
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    });
  }

  function hasThirtyDayComparison(text) {
    const normalized = normalizeText(text);
    return normalized.includes('较前30日') || normalized.includes('较前30天');
  }

  function readThirtyDayMetricCard(labels) {
    const cards = [];
    const seen = new Set();
    for (const label of findTextElements(labels)) {
      for (const card of getMetricCardCandidates(label, labels)) {
        if (seen.has(card)) continue;
        seen.add(card);
        const text = getElementText(card);
        const value = numberAfterLabel(card.innerText || card.textContent || '', labels);
        if (!isVisible(card) || !hasThirtyDayComparison(text) || !Number.isFinite(value)) continue;
        cards.push({ value, card, text });
      }
    }
    return cards.sort((left, right) => {
      const leftRect = left.card.getBoundingClientRect();
      const rightRect = right.card.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || null;
  }

  function readThirtyDayStoreSummaryMetric(summaryCard) {
    if (!summaryCard || !isVisible(summaryCard)) return null;
    const text = getElementText(summaryCard);
    if (!hasThirtyDayComparison(text)) return null;
    const value = numberAfterLabel(
      summaryCard.innerText || summaryCard.textContent || '',
      ['访问店铺访客数', '访问店铺']
    );
    return Number.isFinite(value) ? { value, card: summaryCard, text } : null;
  }

  async function ensureStoreVisitorMetrics() {
    const summaryCards = getStoreSummaryCards();
    if (!summaryCards.length) {
      throw new Error('未找到顶部“访问店铺 / 访客数”汇总卡。');
    }
    for (const summaryCard of summaryCards) {
      const storeVisitors = readThirtyDayStoreSummaryMetric(summaryCard);
      if (!storeVisitors) continue;
      triggerCardClick(summaryCard);
      const startedAt = Date.now();
      let lastSignature = '';
      let stableMatches = 0;
      while (Date.now() - startedAt < 8000) {
        await sleep(180);
        const dateContext = getDateContext();
        const shortVideoVisitors = readThirtyDayMetricCard(['短视频访客数']);
        if (dateContext.dateMode !== 'last30' || !shortVideoVisitors) {
          lastSignature = '';
          stableMatches = 0;
          continue;
        }
        const signature = storeVisitors.value + '|' + shortVideoVisitors.value;
        stableMatches = signature === lastSignature ? stableMatches + 1 : 1;
        lastSignature = signature;
        if (stableMatches >= 3) return { storeVisitors, shortVideoVisitors };
      }
    }
    throw new Error('点击顶部访问店铺汇总卡后，未能从30天指标卡读取“短视频访客数”。');
  }

  function readProductVisitorsFromMetricCards(minimumValue) {
    for (const card of getProductVisitorMetricCards()) {
      const value = numberAfterLabel(card.innerText || card.textContent || '', ['商品访客数']);
      if (Number.isFinite(value) && (!Number.isFinite(minimumValue) || value >= minimumValue)) {
        return { value, card, text: getElementText(card) };
      }
    }
    return null;
  }

  async function revealProductVisitorMetrics() {
    const existing = readMetric(['商品微详情访客数']);
    if (existing) {
      const product = readProductVisitorsFromMetricCards(existing.value);
      if (product) return { productVisitors: product, microDetailVisitors: existing };
    }

    const summaryCards = getProductSummaryCards();
    if (!summaryCards.length) {
      throw new Error('未找到顶部“访问商品 / 商品访客数”汇总卡。');
    }
    for (const summaryCard of summaryCards) {
      const summaryValue = numberAfterLabel(
        summaryCard.innerText || summaryCard.textContent || '',
        ['商品访客数']
      );
      triggerCardClick(summaryCard);

      const startedAt = Date.now();
      while (Date.now() - startedAt < 5000) {
        await sleep(180);
        const revealed = readMetric(['商品微详情访客数']);
        if (!revealed) continue;
        const product = readProductVisitorsFromMetricCards(revealed.value);
        if (product) return { productVisitors: product, microDetailVisitors: revealed };
        if (Number.isFinite(summaryValue) && summaryValue >= revealed.value) {
          return {
            productVisitors: { value: summaryValue, text: getElementText(summaryCard) },
            microDetailVisitors: revealed,
          };
        }
      }
    }
    throw new Error('点击顶部商品访客汇总卡后，未能读取下方商品微详情访客数。');
  }

  function readContentTotals() {
    const contentViewers = readMetric(['内容查看人数']);
    const productClickers = readMetric(['商品点击人数']);
    const seedingAmount = readMetric(['种草成交金额']);
    const seedingShare = readMetric(['种草成交金额占全店', '种草成交金额占比全店']);
    if (!contentViewers || !productClickers || !seedingAmount) {
      throw new Error('未能读取内容页核心数据，请确认页面已加载且停留在“内容概览 - 数据总览”。');
    }
    return {
      contentViewers: contentViewers.value,
      productClickers: productClickers.value,
      seedingAmount: seedingAmount.value,
      seedingShare: seedingShare ? seedingShare.value / 100 : null,
    };
  }

  function findChannelControl() {
    const labels = findTextElements(['消费渠道']);
    for (const label of labels) {
      let container = label;
      for (let level = 0; level < 6 && container; level += 1, container = container.parentElement) {
        const text = getElementText(container);
        const rect = container.getBoundingClientRect();
        const looksLikeChannelControl = text.includes('消费渠道') &&
          CHANNELS.some((channel) => text.includes(channel)) &&
          text.length <= 50 &&
          rect.width >= 90 && rect.width <= 360 &&
          rect.height >= 24 && rect.height <= 80;
        if (looksLikeChannelControl) return container;

        const control = container.querySelector('button, input, [role="combobox"], [role="button"], [tabindex]');
        if (control && isVisible(control) && getElementText(control).length <= 50) return control;
      }
    }
    return null;
  }

  function isAllChannelSelected() {
    const control = findChannelControl();
    if (control && getElementText(control).includes('全部')) return true;
    const labels = findTextElements(['消费渠道']);
    for (const label of labels) {
      let container = label;
      for (let level = 0; level < 4 && container; level += 1, container = container.parentElement) {
        const text = getElementText(container);
        if (text.length <= 80 && text.includes('消费渠道') && text.includes('全部')) return true;
      }
    }
    return false;
  }

  function isChannelSelected(channel) {
    const control = findChannelControl();
    if (!control) return false;
    const text = getElementText(control);
    return text.includes('消费渠道') && text.includes(normalizeText(channel));
  }

  function findChannelOption(channel, control) {
    const normalized = normalizeText(channel);
    const controlRect = control.getBoundingClientRect();
    const preferredSelector = '[role="option"], .next-menu-item, .ant-select-item-option, .ant-cascader-menu-item, li, [class*="option"], [class*="menu-item"]';
    const candidates = Array.from(document.querySelectorAll('body *')).filter((element) => {
      if (!isVisible(element) || element.closest('#' + PANEL_ID) || control.contains(element)) return false;
      return getElementText(element) === normalized;
    });
    candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      const leftPreferred = left.matches(preferredSelector) || left.closest(preferredSelector) ? 0 : 1;
      const rightPreferred = right.matches(preferredSelector) || right.closest(preferredSelector) ? 0 : 1;
      if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
      const leftNear = Math.abs(leftRect.left - controlRect.left) + Math.abs(leftRect.top - controlRect.bottom);
      const rightNear = Math.abs(rightRect.left - controlRect.left) + Math.abs(rightRect.top - controlRect.bottom);
      return leftNear - rightNear;
    });
    return candidates[0] || null;
  }

  async function selectChannel(channel) {
    if (isChannelSelected(channel)) return;
    const control = findChannelControl();
    if (!control) throw new Error('未找到“消费渠道”筛选控件。');

    const before = readMetric(['内容查看人数']);
    const controlTarget = compactTextClickTarget(control) || control;
    controlTarget.click();
    await sleep(180);

    const option = findChannelOption(channel, control);
    if (!option) throw new Error('消费渠道中未找到“' + channel + '”。');
    const optionTarget = compactTextClickTarget(option) || closestClickTarget(option);
    optionTarget.click();

    const startedAt = Date.now();
    let selectedAt = 0;
    while (Date.now() - startedAt < 10000) {
      await sleep(220);
      const selected = isChannelSelected(channel);
      const current = readMetric(['内容查看人数']);
      const metricChanged = before && current && before.value !== current.value;
      if (selected && !selectedAt) selectedAt = Date.now();
      if (selected && (metricChanged || Date.now() - selectedAt >= 2500)) return;
    }
    throw new Error('消费渠道未成功切换到“' + channel + '”。');
  }

  function setButtonBusy(isBusy) {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.disabled = isBusy;
    button.textContent = isBusy ? '正在取数…' : getButtonText();
  }

  function getButtonText() {
    if (isTrafficPage()) return '内容诊断';
    if (isGrassPage() || isGrassDataContext()) return '种草报告';
    return '渠道诊断';
  }

  function showPanel(title, bodyHtml, wide) {
    const previous = document.getElementById(PANEL_ID);
    if (previous) previous.remove();
    const root = document.createElement('section');
    root.id = PANEL_ID;
    root.innerHTML = [
      '<style>',
      '#' + PANEL_ID + '{position:fixed;z-index:2147483646;top:50%;left:50%;transform:translate(-50%,-50%);width:min(' + (wide ? '1180px' : '860px') + ',calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto;background:#fff;border:1px solid #d9d9d9;border-radius:6px;box-shadow:0 14px 44px rgba(0,0,0,.24);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2329}',
      '#' + PANEL_ID + ' .sycm-head{height:52px;padding:0 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #ececec;font-size:18px;font-weight:650}',
      '#' + PANEL_ID + ' .sycm-close{appearance:none;border:0;background:transparent;padding:6px 9px;font-size:26px;line-height:1;color:#6b7280;cursor:pointer}',
      '#' + PANEL_ID + ' .sycm-content{padding:18px}',
      '#' + PANEL_ID + ' .sycm-context{margin:0 0 14px;font-size:13px;line-height:1.5;color:#667085}',
      '#' + PANEL_ID + ' .sycm-warning{margin:0 0 14px;padding:9px 11px;border-left:3px solid #fa8c16;background:#fff7e6;color:#7a4b00;font-size:13px;line-height:1.5}',
      '#' + PANEL_ID + ' table{border-collapse:collapse;width:100%;font-size:16px}',
      '#' + PANEL_ID + ' th,#' + PANEL_ID + ' td{border:1px solid #ffd0ad;padding:11px 12px;text-align:center;white-space:nowrap}',
      '#' + PANEL_ID + ' th{background:#ff7a00;color:#fff;font-size:17px;font-weight:650}',
      '#' + PANEL_ID + ' tbody tr:nth-child(even){background:#fff2eb}',
      '#' + PANEL_ID + ' .sycm-key{font-weight:600;text-align:left}',
      '#' + PANEL_ID + ' .sycm-subtitle{margin:18px 0 8px;font-size:16px;font-weight:650;color:#1f2329}',
      '#' + PANEL_ID + ' .sycm-muted{color:#667085;font-size:13px}',
      '#' + PANEL_ID + ' .sycm-actions{display:flex;justify-content:flex-end;margin-top:14px}',
      '#' + PANEL_ID + ' .sycm-copy{border:0;border-radius:4px;padding:8px 13px;background:#1677ff;color:#fff;cursor:pointer;font-size:14px}',
      '#' + PANEL_ID + ' .sycm-copy:disabled{background:#91caff;cursor:default}',
      '</style>',
      '<div class="sycm-head"><span>' + escapeHtml(title) + '</span><button class="sycm-close" type="button" aria-label="关闭">×</button></div>',
      '<div class="sycm-content">' + bodyHtml + '</div>',
    ].join('');
    document.body.appendChild(root);
    root.querySelector('.sycm-close').addEventListener('click', () => root.remove());
    const copyButton = root.querySelector('.sycm-copy');
    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        const text = Array.from(root.querySelectorAll('table'))
          .map((table) => table.innerText)
          .join('\n\n');
        try {
          await navigator.clipboard.writeText(text);
          const idleText = copyButton.textContent;
          copyButton.textContent = '已复制';
          window.setTimeout(() => { copyButton.textContent = idleText; }, 1200);
        } catch (error) {
          copyButton.textContent = '复制失败';
        }
      });
    }
  }

  function showError(message) {
    showPanel('生意参谋诊断', '<p class="sycm-warning">' + escapeHtml(message) + '</p>', false);
  }

  function contentDateDescription(context) {
    const range = canonicalDateRange(context);
    if (!range) return '未识别当前页面日期';
    const dates = range.split('|');
    return dates[0] === dates[1] ? dates[0] : dates.join(' 至 ');
  }

  function buildChannelTable(rows) {
    const total = rows.find((row) => row.channel === '全部');
    if (
      !total ||
      !Number.isFinite(total.contentViewers) ||
      !Number.isFinite(total.productClickers) ||
      !Number.isFinite(total.seedingAmount)
    ) {
      throw new Error('“全部”渠道缺少核心指标，无法计算渠道占比。');
    }
    const body = rows.map((row) => {
      const contentShare = safeDivide(row.contentViewers, total.contentViewers);
      const productClickRate = safeDivide(row.productClickers, row.contentViewers);
      const productClickShare = safeDivide(row.productClickers, total.productClickers);
      const uvValue = safeDivide(row.seedingAmount, row.contentViewers);
      const seedingShare = safeDivide(row.seedingAmount, total.seedingAmount);
      return '<tr><td class="sycm-key">' + escapeHtml(row.channel) + '</td>' +
        '<td>' + formatInteger(row.contentViewers) + '</td>' +
        '<td>' + formatPercent(contentShare) + '</td>' +
        '<td>' + formatInteger(row.productClickers) + '</td>' +
        '<td>' + formatPercent(productClickRate, 2) + '</td>' +
        '<td>' + formatPercent(productClickShare) + '</td>' +
        '<td>' + formatMoney(row.seedingAmount) + '</td>' +
        '<td>' + formatFixed(uvValue, 2) + '</td>' +
        '<td>' + formatPercent(seedingShare) + '</td></tr>';
    }).join('');
    return '<table><thead><tr><th rowspan="2">渠道</th><th colspan="2">内容查看人数</th><th colspan="3">商品点击人数</th><th colspan="3">种草成交金额</th></tr>' +
      '<tr><th>人数</th><th>占比</th><th>人数</th><th>商品点击率</th><th>占比</th><th>金额</th><th>UV价值</th><th>占比</th></tr></thead><tbody>' + body + '</tbody></table>';
  }

  function renderTrafficReport(data, cache, dateWarning, channelRows) {
    const shortShare = safeDivide(data.shortVideoVisitors, data.storeVisitors);
    const ratioGap = safeDivide(shortShare, cache.totals.seedingShare);
    const removedMicroVisitors = data.productVisitors - data.microDetailVisitors;
    const recommendedShare = safeDivide(data.storeVisitors - removedMicroVisitors, data.storeVisitors);
    const rows = [
      ['访问店铺访客数', formatInteger(data.storeVisitors), '—'],
      ['短视频访客数', formatInteger(data.shortVideoVisitors), '—'],
      ['短视频访客数占比', formatPercent(shortShare), formatPercent(REFERENCES.shortVideoShare)],
      ['种草成交金额', formatMoney(cache.totals.seedingAmount), '—'],
      ['种草成交金额占比全店', formatPercent(cache.totals.seedingShare), formatPercent(REFERENCES.seedingShare)],
      ['率值倍差', formatFixed(ratioGap, 1), String(REFERENCES.ratioGap)],
      ['商品访客数', formatInteger(data.productVisitors), '—'],
      ['商品微详情访客数', formatInteger(data.microDetailVisitors), '—'],
      ['剔除微详情访客数', formatInteger(removedMicroVisitors), '—'],
      ['推荐流量占比', formatPercent(recommendedShare), formatPercent(REFERENCES.recommendedShare)],
    ];
    const table = '<table><thead><tr><th>指标</th><th>数值</th><th>参考</th></tr></thead><tbody>' + rows.map((row) => (
      '<tr><td class="sycm-key">' + row[0] + '</td><td>' + row[1] + '</td><td>' + row[2] + '</td></tr>'
    )).join('') + '</tbody></table>';
    const warning = dateWarning ? '<p class="sycm-warning">' + escapeHtml(dateWarning) + '</p>' : '';
    const context = '<p class="sycm-context">流量数据：' + escapeHtml(contentDateDescription(data.dateContext)) + '；内容数据：' + escapeHtml(contentDateDescription(cache.dateContext)) + '。计算使用未展示前的原始值。</p>';
    const channelSection = Array.isArray(channelRows) && channelRows.length
      ? '<h3 style="margin:20px 0 10px;font-size:16px">渠道诊断</h3>' + buildChannelTable(channelRows)
      : '';
    showPanel(
      '内容诊断',
      warning + context + table + channelSection +
        '<div class="sycm-actions"><button class="sycm-copy" type="button">复制全部表格</button></div>',
      Boolean(channelSection)
    );
  }

  function renderChannelReport(rows, dateContext) {
    const context = '<p class="sycm-context">数据口径：' + escapeHtml(contentDateDescription(dateContext)) + '；按内容页“消费渠道”逐项读取，计算使用未展示前的原始值。</p>';
    showPanel('渠道诊断', context + buildChannelTable(rows) + '<div class="sycm-actions"><button class="sycm-copy" type="button">复制表格</button></div>', true);
  }

  const GRASS_METRIC_GROUPS = [
    {
      name: '内容互动',
      metrics: [
        { key: 'readUv', label: '阅读UV', type: 'integer' },
        { key: 'likeUv', label: '点赞UV', type: 'integer' },
        { key: 'collectUv', label: '收藏UV', type: 'integer' },
        { key: 'commentUv', label: '评论UV', type: 'integer' },
        { key: 'shareUv', label: '转发UV', type: 'integer' },
        { key: 'barrageUv', label: '弹幕UV', type: 'integer' },
        { key: 'interactionUv', label: '互动UV', type: 'integer' },
      ],
    },
    {
      name: '搜索进店',
      metrics: [
        { key: 'searchExpoUv', label: '搜索曝光UV', type: 'integer' },
        { key: 'searchVisitUv', label: '搜索进店UV', type: 'integer' },
        { key: 'visitUv', label: '进店UV', type: 'integer' },
        { key: 'newVisitUv', label: '新客进店UV', type: 'integer' },
      ],
    },
    {
      name: '商品动作',
      metrics: [
        { key: 'itemCollectUv', label: '商品收藏UV', type: 'integer' },
        { key: 'itemCartUv', label: '商品加购UV', type: 'integer' },
        { key: 'followShopUv', label: '关注店铺UV', type: 'integer' },
        { key: 'memberUv', label: '店铺会员UV', type: 'integer' },
      ],
    },
    {
      name: '成交结果',
      metrics: [
        { key: 'payUv', label: '成交UV', type: 'integer' },
        { key: 'gmv', label: '商家GMV', type: 'money' },
        { key: 'orderItemGmv', label: '订单商品成交GMV', type: 'money' },
        { key: 'nonOrderItemGmv', label: '非订单商品成交GMV', type: 'money' },
        { key: 'newPayUv', label: '新客成交UV', type: 'integer' },
        { key: 'orderItemNewGmv', label: '订单商品新客成交GMV', type: 'money' },
        { key: 'presaleDepositGmv', label: '预售付定GMV', type: 'money' },
        { key: 'presaleEstimateGmv', label: '预售整单预估GMV', type: 'money' },
        { key: 'presaleDepositUv', label: '预售付定UV', type: 'integer' },
      ],
    },
  ];

  function readGrassMetrics() {
    const metrics = {};
    for (const group of GRASS_METRIC_GROUPS) {
      for (const metric of group.metrics) {
        const found = readMetric([metric.label], { allowBodyFallback: true });
        metrics[metric.key] = Object.assign({}, metric, {
          value: found ? found.value : null,
          rawText: found ? found.text : '',
        });
      }
    }
    return metrics;
  }

  function formatGrassValue(metric) {
    if (!metric || !Number.isFinite(metric.value)) return '—';
    return metric.type === 'money' ? formatMoney(metric.value) : formatInteger(metric.value);
  }

  function buildGrassMetricsTable(metrics) {
    return GRASS_METRIC_GROUPS.map((group) => {
      const rows = group.metrics.map((metric) => {
        const item = metrics[metric.key];
        return '<tr><td class="sycm-key">' + escapeHtml(metric.label) + '</td><td>' + escapeHtml(formatGrassValue(item)) + '</td></tr>';
      }).join('');
      return '<div class="sycm-subtitle">' + escapeHtml(group.name) + '</div><table><thead><tr><th>指标</th><th>数值</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }).join('');
  }

  function buildGrassDerivedTable(metrics) {
    const readUv = metrics.readUv.value;
    const interactionUv = metrics.interactionUv.value;
    const searchExpoUv = metrics.searchExpoUv.value;
    const searchVisitUv = metrics.searchVisitUv.value;
    const visitUv = metrics.visitUv.value;
    const payUv = metrics.payUv.value;
    const gmv = metrics.gmv.value;
    const newVisitUv = metrics.newVisitUv.value;
    const newPayUv = metrics.newPayUv.value;
    const rows = [
      ['互动率', formatPercent(safeDivide(interactionUv, readUv), 2), '互动UV / 阅读UV'],
      ['搜索进店率', formatPercent(safeDivide(searchVisitUv, searchExpoUv), 2), '搜索进店UV / 搜索曝光UV'],
      ['内容进店率', formatPercent(safeDivide(visitUv, readUv), 2), '进店UV / 阅读UV'],
      ['进店成交率', formatPercent(safeDivide(payUv, visitUv), 2), '成交UV / 进店UV'],
      ['新客进店占比', formatPercent(safeDivide(newVisitUv, visitUv), 2), '新客进店UV / 进店UV'],
      ['新客成交占比', formatPercent(safeDivide(newPayUv, payUv), 2), '新客成交UV / 成交UV'],
      ['成交UV价值', Number.isFinite(safeDivide(gmv, payUv)) ? formatMoney(safeDivide(gmv, payUv)) : '—', '商家GMV / 成交UV'],
    ];
    return '<div class="sycm-subtitle">派生指标</div><table><thead><tr><th>指标</th><th>数值</th><th>计算口径</th></tr></thead><tbody>' +
      rows.map((row) => '<tr><td class="sycm-key">' + escapeHtml(row[0]) + '</td><td>' + escapeHtml(row[1]) + '</td><td class="sycm-muted">' + escapeHtml(row[2]) + '</td></tr>').join('') +
      '</tbody></table>';
  }

  function renderGrassReport(metrics, dateContext) {
    const missing = Object.values(metrics).filter((metric) => !Number.isFinite(metric.value)).map((metric) => metric.label);
    const warning = missing.length
      ? '<p class="sycm-warning">以下指标未从当前页面读取到：' + escapeHtml(missing.join('、')) + '。请确认页面卡片已加载完成。</p>'
      : '';
    const context = '<p class="sycm-context">数据口径：' + escapeHtml(contentDateDescription(dateContext)) + '；从当前“内容种草”页面已渲染指标卡读取。</p>';
    showPanel(
      '内容种草报告',
      warning + context + buildGrassMetricsTable(metrics) + buildGrassDerivedTable(metrics) +
        '<div class="sycm-actions"><button class="sycm-copy" type="button">复制全部表格</button></div>',
      true
    );
  }

  async function runGrassReport() {
    if (!isGrassDataContext()) {
      throw new Error('当前页面还没有渲染出“内容种草”核心指标，请等待页面加载完成后重试。');
    }
    const dateContext = getDateContext();
    const metrics = readGrassMetrics();
    renderGrassReport(metrics, dateContext);
  }

  async function runTrafficDiagnosis(options) {
    const dateContext = await ensureTrafficThirtyDayMode();
    if (!canonicalDateRange(dateContext)) {
      throw new Error('未能识别流量页30天日期范围，请等待页面日期和指标加载完成。');
    }
    const storeMetrics = await ensureStoreVisitorMetrics();
    let productMetrics;
    try {
      productMetrics = await revealProductVisitorMetrics();
    } finally {
      try {
        await ensureStoreVisitorMetrics();
      } catch (error) {
        console.warn(PREFIX, '恢复访问店铺指标视图失败:', error);
      }
    }
    const productVisitors = productMetrics.productVisitors;
    const microDetailVisitors = productMetrics.microDetailVisitors;

    let snapshotResult = null;
    let cache = null;
    if (!(options && options.trafficOnly)) {
      snapshotResult = await requestOpenContentPageSnapshot(dateContext, options && options.backgroundOnly);
      const captureMessage = snapshotResult && snapshotResult.message ? snapshotResult.message : '';
      cache = snapshotResult && snapshotResult.snapshot;
      if (!cache || !cache.totals || !Number.isFinite(cache.totals.seedingAmount) || !Number.isFinite(cache.totals.seedingShare)) {
        throw new Error(captureMessage
          ? captureMessage
          : '未能读取自动对齐后的内容页数据。');
      }
      if (!sameDateContext(dateContext, cache.dateContext)) {
        throw new Error('自动对齐后两个页面日期仍不一致，已停止计算。');
      }
    }
    const trafficSnapshot = {
      savedAt: Date.now(),
      url: location.href,
      dateContext,
      storeVisitors: storeMetrics.storeVisitors.value,
      shortVideoVisitors: storeMetrics.shortVideoVisitors.value,
      productVisitors: productVisitors.value,
      microDetailVisitors: microDetailVisitors.value,
      shortVideoVisitorShare: safeDivide(storeMetrics.shortVideoVisitors.value, storeMetrics.storeVisitors.value),
      recommendedTrafficShare: safeDivide(
        storeMetrics.storeVisitors.value - microDetailVisitors.value,
        storeMetrics.storeVisitors.value
      ),
    };
    if (cache && cache.totals) {
      trafficSnapshot.seedingGmvShare = cache.totals.seedingShare;
      trafficSnapshot.efficiencyGap = safeDivide(
        trafficSnapshot.shortVideoVisitorShare,
        cache.totals.seedingShare
      );
    }
    await storageSet(BUSINESS_DEFENSE_TRAFFIC_KEY, trafficSnapshot);
    if (cache && !(options && options.backgroundOnly)) {
      renderTrafficReport(trafficSnapshot, cache, '', snapshotResult.rows);
    }
    return trafficSnapshot;
  }

  async function runChannelDiagnosis(shouldRender, expectedDateRange) {
    const expected = canonicalDateRange({ visibleRange: expectedDateRange });
    const initialDateContext = getDateContext();
    if (expected && canonicalDateRange(initialDateContext) !== expected) {
      throw new Error('内容页日期尚未与流量页对齐。');
    }
    const rows = [];
    for (const channel of CHANNELS) {
      await selectChannel(channel);
      const totals = readContentTotals();
      rows.push({ channel, ...totals });
      if (expected && canonicalDateRange(getDateContext()) !== expected) {
        throw new Error('渠道采集期间内容页日期发生变化。');
      }
      await sleep(650);
    }
    await selectChannel('全部');
    const dateContext = getDateContext();
    if (!canonicalDateRange(dateContext)) {
      throw new Error('未能识别内容页当前日期范围，请等待页面日期和指标加载完成。');
    }
    if (expected && canonicalDateRange(dateContext) !== expected) {
      throw new Error('渠道采集完成时内容页日期已变化。');
    }
    const all = rows.find((row) => row.channel === '全部');
    const snapshot = {
      savedAt: Date.now(),
      url: location.href,
      dateContext,
      totals: {
        contentViewers: all.contentViewers,
        productClickers: all.productClickers,
        seedingAmount: all.seedingAmount,
        seedingShare: all.seedingShare,
      },
    };
    await storageSet(CONTENT_CACHE_KEY, snapshot);
    if (shouldRender !== false) renderChannelReport(rows, dateContext);
    return { rows, dateContext, snapshot };
  }

  async function captureContentTotalsFromDom(options) {
    if (!isContentDataContext()) return { ok: false, message: '当前页面层未渲染内容分析指标。' };
    if (!isAllChannelSelected() && options && options.ensureAllChannel) {
      try {
        await selectChannel('全部');
      } catch (error) {
        if (!(options && options.allowUnknownChannel)) {
          return { ok: false, message: '未能将内容页消费渠道切换为“全部”。' };
        }
      }
    }
    if (!isAllChannelSelected() && !(options && options.allowUnknownChannel)) {
      return { ok: false, message: '请先将内容页“消费渠道”筛选设为“全部”。' };
    }
    try {
      const totals = readContentTotals();
      if (!Number.isFinite(totals.seedingShare)) {
        return { ok: false, message: '未读取到“种草成交金额占全店”。' };
      }
      const snapshot = {
        savedAt: Date.now(),
        url: location.href,
        dateContext: getDateContext(),
        totals,
      };
      if (!canonicalDateRange(snapshot.dateContext)) {
        return { ok: false, message: '未能识别内容页当前日期范围。' };
      }
      await storageSet(CONTENT_CACHE_KEY, snapshot);
      return { ok: true, snapshot };
    } catch (error) {
      return { ok: false, message: error && error.message ? error.message : '内容页核心指标读取失败。' };
    }
  }

  async function runDiagnosis() {
    if (running) return;
    if (!hasActiveExtensionContext()) {
      reloadAndRetryDiagnosis();
      return;
    }
    running = true;
    setButtonBusy(true);
    try {
      if (isTrafficPage()) await runTrafficDiagnosis();
      else if (isGrassPage() || isGrassDataContext()) await runGrassReport();
      else if (isContentDataContext()) await runChannelDiagnosis(true);
      else if (isContentPage() && window.top === window) {
        const response = await requestChannelDiagnosisFromDataFrame();
        if (!response.ok) throw new Error(response.message || '内容指标层未响应。');
        renderChannelReport(response.rows, response.dateContext);
      }
    } catch (error) {
      console.warn(PREFIX, error);
      if (isExtensionContextInvalidError(error) || !hasActiveExtensionContext()) {
        reloadAndRetryDiagnosis();
        return;
      }
      showError(error && error.message ? error.message : '取数失败，请确认页面已加载完成后重试。');
    } finally {
      running = false;
      setButtonBusy(false);
    }
  }

  function createButton() {
    const previous = document.getElementById(BUTTON_ID);
    if (previous) previous.remove();
    const isTopLevelDiagnosisPage = window.top === window && (isTrafficPage() || isContentPage() || isGrassPage());
    if (!isTopLevelDiagnosisPage) return;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = getButtonText();
    button.setAttribute('aria-label', button.textContent);
    button.style.cssText = [
      'position:fixed', 'right:22px', 'top:50%', 'transform:translateY(-50%)', 'z-index:2147483645',
      'height:38px', 'padding:0 15px', 'border:0', 'border-radius:4px',
      'background:#1677ff', 'color:#fff', 'font:600 14px/38px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
      'box-shadow:0 4px 14px rgba(22,119,255,.28)', 'cursor:pointer',
    ].join(';');
    button.addEventListener('mouseenter', () => { if (!button.disabled) button.style.background = '#0958d9'; });
    button.addEventListener('mouseleave', () => { button.style.background = button.disabled ? '#91caff' : '#1677ff'; });
    button.addEventListener('click', runDiagnosis);
    document.body.appendChild(button);
  }

  function syncPage() {
    const shouldShow = window.top === window && (isTrafficPage() || isContentPage() || isGrassPage());
    const button = document.getElementById(BUTTON_ID);
    if (currentPath !== location.pathname) currentPath = location.pathname;
    if (shouldShow && !button) createButton();
    if (!shouldShow && button) button.remove();
  }

  function resumeDiagnosisAfterExtensionReload() {
    if (window.top !== window || (!isTrafficPage() && !isContentPage() && !isGrassPage())) return;
    try {
      if (window.sessionStorage.getItem(RETRY_AFTER_RELOAD_KEY) !== '1') return;
      window.sessionStorage.removeItem(RETRY_AFTER_RELOAD_KEY);
      window.setTimeout(runDiagnosis, 1200);
    } catch (error) {
      console.warn(PREFIX, '无法恢复诊断重试:', error);
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return;
    if (message.type === 'SYCM_RUN_TRAFFIC_DIAGNOSIS') {
      if (!isTrafficPage()) return;
      runTrafficDiagnosis({ backgroundOnly: true, trafficOnly: true })
        .then((snapshot) => sendResponse({
          ok: true,
          source: '生意参谋流量页',
          snapshot,
        }))
        .catch((error) => sendResponse({
          ok: false,
          message: error && error.message ? error.message : '生意参谋内容诊断失败。',
        }));
      return true;
    }
    if (message.type === 'SYCM_ALIGN_CONTENT_DATE') {
      if (!isContentFrameContext() && !isContentOverviewContext() && !isContentDataContext()) return;
      alignContentDateFromDom(message)
        .then(sendResponse)
        .catch((error) => sendResponse({
          ok: false,
          retryable: false,
          message: error && error.message ? error.message : '内容页日期自动对齐失败。',
        }));
      return true;
    }
    if (!isContentDataContext()) return;
    if (message.type === 'SYCM_CAPTURE_CONTENT_TOTALS') {
      captureContentTotalsFromDom(message).then(sendResponse);
      return true;
    }
    if (message.type === 'SYCM_RUN_CHANNEL_DIAGNOSIS') {
      runChannelDiagnosis(false, message.expectedDateRange)
        .then((result) => sendResponse({
          ok: true,
          rows: result.rows,
          dateContext: result.dateContext,
          snapshot: result.snapshot,
        }))
        .catch((error) => sendResponse({
          ok: false,
          message: error && error.message ? error.message : '渠道诊断执行失败。',
        }));
      return true;
    }
  });

  createButton();
  resumeDiagnosisAfterExtensionReload();
  window.setInterval(syncPage, 800);
})();

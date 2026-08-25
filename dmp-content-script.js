// dmp-content-script.js - ISOLATED world UI for batch DMP crowd portraits.
(function () {
  'use strict';

  if (location.hostname !== 'dmp.taobao.com') return;
  if (window.__dmpPortraitContentV22516) return;
  window.__dmpPortraitContentV22516 = true;

  const TAG = '[DMP画像]';
  const BUILD_VERSION = '2.25.16';
  const REQUEST_TYPE = 'DMP_PORTRAIT_REQUEST';
  const RESPONSE_TYPE = 'DMP_PORTRAIT_RESPONSE';
  const STORAGE_KEY = 'dmpPortraitSnapshotV1';
  const RULE_CROWDS = [
    { name: '淘天内容人群资产', rules: ['内容播放', '超级短视频曝光1次以上', '店铺浏览1次以上', '近30天'] },
    { name: '全店人群资产', rules: ['全部类目', '浏览1次以上', '近30天'] },
    { name: '小红书内容人群资产', rules: ['星河当前项目', '所有订单', '进店+种草', '近30天'] },
    { name: '小红书进店人群', rules: ['星河当前项目', '所有订单', '进店', '近30天'] },
  ];
  let requestSeq = 1;
  let root = null;
  let shadow = null;
  const state = {
    open: false,
    mode: 'portrait',
    loading: false,
    message: '',
    crowds: [],
    groups: [],
    tags: [],
    currentGroupId: null,
    selectedCrowdIds: new Set(),
    selectedTags: new Map(),
    results: [],
    resultSignature: '',
    presetLoading: false,
    presetMessage: '',
    presetStatuses: [],
    presetCurrentAccount: null,
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatNumber(value) {
    const num = Number(String(value == null ? '' : value).replace(/[,，]/g, ''));
    if (!Number.isFinite(num)) return value == null || value === '' ? '-' : String(value);
    return num.toLocaleString('zh-CN');
  }

  function dmpRequest(action, payload) {
    const id = 'dmp-' + Date.now() + '-' + requestSeq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('DMP 接口请求超时'));
      }, 30000);
      function onMessage(event) {
        if (event.source !== window) return;
        const message = event.data;
        if (!message || message.type !== RESPONSE_TYPE || message.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (message.ok) resolve(message.data);
        else reject(new Error(message.message || 'DMP 接口请求失败'));
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ type: REQUEST_TYPE, id: id, action: action, payload: payload || {} }, '*');
    });
  }

  function setLoading(message) {
    state.loading = true;
    state.message = message || '';
    render();
  }

  function setIdle(message) {
    state.loading = false;
    state.message = message || '';
    render();
  }

  async function restore() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const snapshot = data && data[STORAGE_KEY];
      if (snapshot) {
        state.results = snapshot.results || [];
        state.resultSignature = snapshot.resultSignature || '';
      }
    } catch (error) {
      console.warn(TAG, '读取缓存失败:', error);
    }
  }

  function runtimeDmpAction(action, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'DMP_CROWD_PRESET_ACTION',
        action: action,
        payload: payload || {},
      }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message || '扩展后台未响应。'));
          return;
        }
        if (!response || response.ok === false) {
          reject(new Error(response && response.message || '达摩盘人群操作失败。'));
          return;
        }
        resolve(response);
      });
    });
  }

  function accountLabel(account) {
    if (!account) return '当前达摩盘账号';
    return account.nick || (account.customerId ? '账号 ' + account.customerId : '当前达摩盘账号');
  }

  async function inspectPresetTargets() {
    state.presetLoading = true;
    state.presetMessage = '正在核对当前账号的同名人群...';
    render();
    try {
      const response = await runtimeDmpAction('inspect', {
        names: RULE_CROWDS.map((preset) => preset.name),
      });
      state.presetStatuses = (response.results || []).map((item) => ({
        name: item.name,
        ok: Boolean(item.exists),
        exists: item.exists,
        crowdId: item.crowdId,
        coverage: item.coverage,
        message: item.exists
          ? '已读取' + (item.coverage !== '' && item.coverage != null ? ' · ' + formatNumber(item.coverage) + ' 人' : '')
          : '未找到，请手动创建',
      }));
      state.presetCurrentAccount = response.account || state.presetCurrentAccount;
      const missing = state.presetStatuses.filter((item) => !item.exists).length;
      const found = state.presetStatuses.length - missing;
      state.presetMessage = missing
        ? accountLabel(response.account) + '已读取 ' + found + '/4，缺少 ' + missing + ' 个人群'
        : accountLabel(response.account) + '的 4 个人群均已读取';
    } catch (error) {
      state.presetMessage = error.message || String(error);
    } finally {
      state.presetLoading = false;
      render();
    }
  }

  async function createRuleCrowds() {
    const confirmed = window.confirm(
      '将在当前达摩盘账号按文档规则创建缺失人群；同名人群会自动跳过。确定继续吗？'
    );
    if (!confirmed) return;
    state.presetLoading = true;
    state.presetMessage = '正在创建人群；每次提交之间会自动留出间隔...';
    state.presetStatuses = [];
    render();
    try {
      const response = await runtimeDmpAction('ensureBusinessDefense', {});
      state.presetStatuses = response.results || [];
      state.presetCurrentAccount = response.account || state.presetCurrentAccount;
      const created = state.presetStatuses.filter((item) => item.ok && !item.skipped).length;
      const skipped = state.presetStatuses.filter((item) => item.skipped).length;
      const failed = state.presetStatuses.filter((item) => !item.ok).length;
      state.presetMessage = '完成：新建 ' + created + ' 个，跳过 ' + skipped + ' 个，失败 ' + failed + ' 个';
    } catch (error) {
      state.presetMessage = error.message || String(error);
    } finally {
      state.presetLoading = false;
      render();
    }
  }

  function normalizeHostText(value) {
    return String(value == null ? '' : value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  }

  function hostElementText(element) {
    return String(element && (element.innerText || element.textContent) || '').trim();
  }

  function isHostVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
      style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  }

  function visualElements(rootElement) {
    const scope = rootElement || document.body;
    return Array.from(scope.querySelectorAll(
      'button,a,label,input,textarea,select,[role="button"],[role="radio"],' +
      '[role="option"],[role="combobox"],[role="menuitem"],li,span,div'
    )).filter((element) => isHostVisible(element));
  }

  function visualTextElements(labels, rootElement, exactOnly) {
    const normalizedLabels = labels.map(normalizeHostText).filter(Boolean);
    return visualElements(rootElement).map((element) => {
      const text = normalizeHostText(hostElementText(element));
      const exact = normalizedLabels.some((label) => text === label);
      const partial = !exactOnly && normalizedLabels.some((label) => text.includes(label));
      return { element, text, exact, partial };
    }).filter((item) => item.exact || item.partial).sort((left, right) => {
      if (left.exact !== right.exact) return left.exact ? -1 : 1;
      const semantic = (element) => element.matches(
        'button,a,label,[role="button"],[role="radio"],[role="option"],[role="menuitem"]'
      ) ? 0 : 1;
      const semanticDelta = semantic(left.element) - semantic(right.element);
      if (semanticDelta) return semanticDelta;
      const leftRect = left.element.getBoundingClientRect();
      const rightRect = right.element.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    }).map((item) => item.element);
  }

  function visualTextElement(labels, rootElement, exactOnly) {
    return visualTextElements(labels, rootElement, exactOnly)[0] || null;
  }

  function visualTextElementByPriority(labels, rootElement) {
    for (const label of labels) {
      const exact = visualTextElement([label], rootElement, true);
      if (exact) return exact;
    }
    for (const label of labels) {
      const partial = visualTextElement([label], rootElement, false);
      if (partial) return partial;
    }
    return null;
  }

  function clickableHostElement(element) {
    if (!element) return null;
    return element.closest(
      '[mx-click],button,a,label,[role="button"],[role="radio"],[role="option"],[role="menuitem"],li'
    ) || element;
  }

  function clickHostElement(element) {
    const target = clickableHostElement(element);
    if (!target || !isHostVisible(target)) return false;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    if (typeof target.click === 'function') target.click();
    else target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  }

  function sleepVisual(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
  }

  async function waitVisual(readValue, timeoutMs, errorMessage) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = readValue();
      if (value) return value;
      await sleepVisual(timeoutMs > 30000 ? 250 : 100);
    }
    throw new Error(errorMessage);
  }

  function setHostInputValue(input, value) {
    if (!input) return false;
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, String(value));
    else input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function findHostInput(hints, rootElement) {
    const normalizedHints = hints.map(normalizeHostText);
    return Array.from((rootElement || document).querySelectorAll('input,textarea')).filter(isHostVisible)
      .map((input) => {
        const hint = normalizeHostText([
          input.placeholder,
          input.getAttribute('aria-label'),
          input.name,
          input.id,
        ].join(' '));
        const score = normalizedHints.reduce((value, term) => value + (hint.includes(term) ? term.length : 0), 0);
        return { input, score };
      }).filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.input || null;
  }

  function groupedControlForLabel(label, rootElement) {
    if (!label) return null;
    const groupId = String(label.getAttribute('group-id') || '');
    if (!/^[\w-]+$/.test(groupId)) return null;
    const scope = rootElement || document.body;
    return Array.from(scope.querySelectorAll('[id^="optionGroups_"]')).find((element) => (
      String(element.id || '').startsWith('optionGroups_' + groupId + '_')
    )) || null;
  }

  function fieldContainer(labelAliases, rootElement) {
    const scope = rootElement || document.body;
    const label = visualTextElementByPriority(labelAliases, scope);
    if (!label) return null;
    const groupedControl = groupedControlForLabel(label, scope);
    if (groupedControl) {
      let groupedContainer = groupedControl;
      for (let level = 0; level < 7 && groupedContainer && scope.contains(groupedContainer); level += 1) {
        if (groupedContainer.contains(label)) return groupedContainer;
        groupedContainer = groupedContainer.parentElement;
      }
    }
    let current = label;
    const candidates = [];
    for (let level = 0; level < 7 && current && scope.contains(current); level += 1) {
      const text = hostElementText(current);
      const controls = current.querySelectorAll(
        'input,select,button,label,.mx-trigger,[role="radio"],[role="combobox"],[role="option"]'
      ).length;
      if (controls && text.length <= 1200) candidates.push(current);
      if (current === scope) break;
      current = current.parentElement;
    }
    return candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || label.parentElement;
  }

  function visualFieldHasValue(labelAliases, valueAliases, rootElement) {
    const scope = rootElement && rootElement.isConnected ? rootElement : document.body;
    const container = fieldContainer(labelAliases, scope);
    if (!container) return false;
    const label = visualTextElementByPriority(labelAliases, container);
    const fieldControl = groupedControlForLabel(label, container) || container;
    const selected = fieldControl.querySelector(
      '.mx-trigger-label,.next-select-inner,.ant-select-selection-item'
    );
    const text = normalizeHostText(selected ? hostElementText(selected) : hostElementText(container));
    return valueAliases.some((value) => text.includes(normalizeHostText(value)));
  }

  function dropdownMenuForOpener(opener) {
    if (!opener) return null;
    const openerId = String(opener.id || '');
    if (openerId.startsWith('toggle_')) {
      const linkedMenu = document.getElementById('menu_' + openerId.slice('toggle_'.length));
      if (linkedMenu) return linkedMenu;
    }
    const dropdown = opener.closest('[mx-view*="mx-dropdown"],.next-select,.ant-select') ||
      opener.parentElement;
    return dropdown && dropdown.querySelector(
      '.mx-output,.mx-output-list,[role="listbox"],.next-menu,.ant-select-dropdown'
    );
  }

  function visibleMenuChoice(valueAliases, rootElement) {
    const scope = rootElement && rootElement.isConnected ? rootElement : document;
    const normalizedValues = valueAliases.map(normalizeHostText).filter(Boolean);
    return Array.from(scope.querySelectorAll(
      '.mx-output-link,.mx-output-item[title],[role="option"],.next-menu-item,.ant-select-item-option'
    )).filter(isHostVisible).map((element) => {
      const text = normalizeHostText(hostElementText(element));
      const title = normalizeHostText(element.getAttribute('title'));
      const exact = normalizedValues.some((value) => text === value || title === value);
      const partial = !exact && normalizedValues.some((value) => text.includes(value) || title.includes(value));
      const actionElement = element.matches('[mx-click],button,a,[role="option"],.mx-output-link')
        ? element
        : element.querySelector('[mx-click],button,a,[role="option"],.mx-output-link') || element;
      const clickable = actionElement !== element || actionElement.hasAttribute('mx-click') ||
        actionElement.matches('[role="option"],.mx-output-link');
      return { element: actionElement, exact, partial, clickable, length: text.length || title.length };
    }).filter((item) => item.exact || item.partial).sort((left, right) => {
      if (left.exact !== right.exact) return left.exact ? -1 : 1;
      if (left.clickable !== right.clickable) return left.clickable ? -1 : 1;
      return left.length - right.length;
    })[0]?.element || null;
  }

  async function chooseVisualField(labelAliases, valueAliases, optional, rootElement) {
    const container = fieldContainer(labelAliases, rootElement);
    if (!container) {
      if (optional) return false;
      throw new Error('未找到条件项“' + labelAliases[0] + '”。');
    }
    const nativeSelect = container.querySelector('select');
    if (nativeSelect && isHostVisible(nativeSelect)) {
      const option = Array.from(nativeSelect.options).find((candidate) => (
        valueAliases.some((value) => normalizeHostText(candidate.textContent).includes(normalizeHostText(value)))
      ));
      if (option) {
        nativeSelect.value = option.value;
        nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    if (visualFieldHasValue(labelAliases, valueAliases, rootElement)) return true;
    const fieldLabel = visualTextElementByPriority(labelAliases, container);
    const fieldControl = groupedControlForLabel(fieldLabel, container) || container;
    const opener = Array.from(fieldControl.querySelectorAll(
      '.mx-trigger,[role="combobox"],.next-select,.ant-select,input[readonly],button'
    )).find(isHostVisible);
    let menu = dropdownMenuForOpener(opener);
    let choice = visibleMenuChoice(valueAliases, menu) ||
      visualTextElement(valueAliases, container, true) ||
      visualTextElement(valueAliases, container, false);
    if (choice && clickHostElement(choice)) {
      await waitVisual(
        () => visualFieldHasValue(labelAliases, valueAliases, rootElement),
        8000,
        '条件“' + labelAliases[0] + '”未切换到“' + valueAliases[0] + '”。'
      );
      return true;
    }
    if (opener && clickHostElement(opener)) {
      choice = await waitVisual(
        () => {
          menu = dropdownMenuForOpener(opener);
          return visibleMenuChoice(valueAliases, menu) ||
            visibleMenuChoice(valueAliases) ||
            (menu && visualTextElement(valueAliases, menu, true)) ||
            (menu && visualTextElement(valueAliases, menu, false));
        },
        8000,
        '条件“' + labelAliases[0] + '”的选项未展开。'
      ).catch(() => null);
      if (choice && clickHostElement(choice)) {
        await waitVisual(
          () => visualFieldHasValue(labelAliases, valueAliases, rootElement),
          8000,
          '条件“' + labelAliases[0] + '”未切换到“' + valueAliases[0] + '”。'
        );
        return true;
      }
    }
    if (optional) return false;
    throw new Error('条件“' + labelAliases[0] + '”中未找到“' + valueAliases[0] + '”。');
  }

  function ensureVisualChoiceChecked(valueAliases, rootElement) {
    const scope = rootElement || document.body;
    const choices = visualTextElements(valueAliases, scope, true);
    for (const choice of choices) {
      const label = choice.closest('label');
      const input = (label && label.querySelector('input[type="checkbox"],input[type="radio"]')) ||
        choice.querySelector('input[type="checkbox"],input[type="radio"]');
      if (!input) continue;
      if (input.checked) return true;
      return clickHostElement(label || input);
    }
    return false;
  }

  function tagCardFor(label) {
    const normalizedLabel = normalizeHostText(label);
    const exactTitled = Array.from(document.querySelectorAll('[title]')).find((element) => (
      isHostVisible(element) && normalizeHostText(element.getAttribute('title')) === normalizedLabel
    ));
    const exactCard = exactTitled && exactTitled.closest('[draggable="true"]');
    if (exactCard && isHostVisible(exactCard)) return exactCard;

    const draggableCard = Array.from(document.querySelectorAll('[draggable="true"]')).find((element) => {
      if (!isHostVisible(element)) return false;
      const title = element.querySelector('[title]');
      return title && normalizeHostText(title.getAttribute('title')) === normalizedLabel;
    });
    if (draggableCard) return draggableCard;

    const textElement = visualTextElement([label], document.body, true);
    if (!textElement) return null;
    let current = textElement;
    let fallback = textElement;
    for (let level = 0; level < 6 && current && current !== document.body; level += 1) {
      const text = hostElementText(current);
      if (current.getAttribute('draggable') === 'true') return current;
      if (text.length <= 360 && text.includes(label)) fallback = current;
      current = current.parentElement;
    }
    return fallback;
  }

  function tagSearchSuggestion(label) {
    const normalizedLabel = normalizeHostText(label);
    return Array.from(document.querySelectorAll('a[mx-click*="selectRelevanceWord"]')).find((element) => (
      isHostVisible(element) && normalizeHostText(hostElementText(element)) === normalizedLabel
    )) || null;
  }

  function operationPool() {
    const exactDropPool = Array.from(document.querySelectorAll('[mx-drop]')).find((element) => {
      if (!isHostVisible(element)) return false;
      const dropAction = String(element.getAttribute('mx-drop') || '');
      const text = normalizeHostText(hostElementText(element));
      return /logicIndex\s*:\s*0/.test(dropAction) && text.includes('交集运算池');
    });
    if (exactDropPool) return exactDropPool;

    const label = visualTextElementByPriority(
      ['交集运算池', '可从左侧拖入标签到此处', '运算池'],
      document.body
    );
    if (!label) return null;
    let current = label;
    const candidates = [];
    for (let level = 0; level < 8 && current && current !== document.body; level += 1) {
      const text = normalizeHostText(hostElementText(current));
      const className = String(current.className || '').toLowerCase();
      const hasTopPool = text.includes('交集运算池');
      const hasDropHint = text.includes('可从左侧拖入标签到此处') || text.includes('拖入标签');
      if (hasTopPool && (hasDropHint || /drop|pool|operation|calculate|formula/.test(className))) {
        candidates.push(current);
      }
      current = current.parentElement;
    }
    return candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || label;
  }

  function dragHandleFor(source) {
    if (!source) return null;
    if (source.getAttribute('draggable') === 'true') return source;
    const explicit = Array.from(source.querySelectorAll(
      '[draggable="true"],[class*="drag"],[class*="handle"],[class*="sort"],[class*="move"]'
    )).filter(isHostVisible).sort((left, right) => (
      right.getBoundingClientRect().right - left.getBoundingClientRect().right
    ))[0];
    if (explicit) return explicit;

    const sourceRect = source.getBoundingClientRect();
    return Array.from(source.querySelectorAll('a,button,i,span,div')).filter((element) => {
      if (!isHostVisible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width <= 42 && rect.height <= 42 && rect.right >= sourceRect.right - 58;
    }).sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return rightRect.right - leftRect.right ||
        leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || source;
  }

  function dragTagToPool(source, pool) {
    if (!source || !pool) return false;
    const dragSource = source.getAttribute('draggable') === 'true'
      ? source
      : source.querySelector('[draggable="true"]') || source;
    dragSource.scrollIntoView({ block: 'center' });
    pool.scrollIntoView({ block: 'center' });
    const sourceRect = dragSource.getBoundingClientRect();
    const poolRect = pool.getBoundingClientRect();
    const sourcePoint = { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 };
    const poolPoint = { x: poolRect.left + poolRect.width / 2, y: poolRect.top + poolRect.height / 2 };
    let dataTransfer = null;
    try {
      dataTransfer = new DataTransfer();
      dataTransfer.effectAllowed = 'all';
      dataTransfer.setData('text/plain', hostElementText(dragSource));
    } catch (error) {}
    const dispatchDrag = (target, type, point) => {
      let event;
      try {
        event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: point.x,
          clientY: point.y,
        });
      } catch (error) {
        event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          view: window,
        });
        if (dataTransfer) Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
      }
      target.dispatchEvent(event);
    };
    dispatchDrag(dragSource, 'dragstart', sourcePoint);
    dispatchDrag(dragSource, 'drag', sourcePoint);
    dispatchDrag(pool, 'dragenter', poolPoint);
    for (let step = 1; step <= 4; step += 1) {
      const point = {
        x: sourcePoint.x + (poolPoint.x - sourcePoint.x) * step / 4,
        y: sourcePoint.y + (poolPoint.y - sourcePoint.y) * step / 4,
      };
      dispatchDrag(step === 4 ? pool : dragSource, 'dragover', point);
    }
    dispatchDrag(pool, 'drop', poolPoint);
    dispatchDrag(dragSource, 'dragend', poolPoint);
    return true;
  }

  async function dragTagToPoolWithPointer(source, pool) {
    if (!source || !pool) return false;
    source.scrollIntoView({ block: 'center' });
    pool.scrollIntoView({ block: 'center' });
    await sleepVisual(80);
    const dragSource = dragHandleFor(source);
    const sourceRect = dragSource.getBoundingClientRect();
    const poolRect = pool.getBoundingClientRect();
    const start = { x: sourceRect.left + sourceRect.width / 2, y: sourceRect.top + sourceRect.height / 2 };
    const end = { x: poolRect.left + poolRect.width / 2, y: poolRect.top + poolRect.height / 2 };
    const mouse = (target, type, point, buttons) => target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      buttons,
      view: window,
    }));
    const pointer = (target, type, point, buttons) => {
      if (typeof PointerEvent !== 'function') return;
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
        buttons,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        view: window,
      }));
    };
    pointer(dragSource, 'pointerdown', start, 1);
    mouse(dragSource, 'mousedown', start, 1);
    for (let step = 1; step <= 16; step += 1) {
      const point = {
        x: start.x + (end.x - start.x) * step / 16,
        y: start.y + (end.y - start.y) * step / 16,
      };
      const target = document.elementFromPoint(point.x, point.y) || document;
      pointer(target, 'pointermove', point, 1);
      mouse(target, 'mousemove', point, 1);
      await sleepVisual(18);
    }
    pointer(pool, 'pointerup', end, 0);
    mouse(pool, 'mouseup', end, 0);
    await sleepVisual(120);
    return true;
  }

  function storeRuleEditor() {
    const candidates = [];
    visualTextElements(['店铺行为人群'], document.body, true).forEach((label) => {
      let current = label;
      for (let level = 0; level < 9 && current && current !== document.body; level += 1) {
        const text = normalizeHostText(hostElementText(current));
        const hasRuleFields = text.includes('选择类目') && text.includes('用户行为') &&
          (text.includes('时间类型') || text.includes('最近天数'));
        if (hasRuleFields && current.querySelectorAll('input,button,[role="combobox"],.next-select').length) {
          candidates.push(current);
        }
        current = current.parentElement;
      }
    });
    return candidates.sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
    })[0] || null;
  }

  function storeRuleEditorReady() {
    return Boolean(storeRuleEditor());
  }

  function rightmostVisualTextElement(labels, rootElement) {
    return visualTextElements(labels, rootElement || document.body, true).sort((left, right) => (
      right.getBoundingClientRect().left - left.getBoundingClientRect().left
    ))[0] || null;
  }

  function editableInputsBetween(leftAliases, rightAliases, rootElement) {
    const scope = rootElement || document.body;
    const left = rightmostVisualTextElement(leftAliases, scope);
    if (!left) return [];
    const leftRect = left.getBoundingClientRect();
    const right = rightAliases && rightAliases.length
      ? visualTextElementByPriority(rightAliases, scope)
      : null;
    const rightBoundary = right ? right.getBoundingClientRect().left : Infinity;
    return Array.from(scope.querySelectorAll('input')).filter((input) => {
      if (!isHostVisible(input) || input.readOnly || input.disabled) return false;
      if (input.type === 'checkbox' || input.type === 'radio' || input.type === 'hidden') return false;
      const rect = input.getBoundingClientRect();
      const sameRow = Math.abs((rect.top + rect.height / 2) - (leftRect.top + leftRect.height / 2)) < 42;
      return sameRow && rect.left >= leftRect.right - 8 && rect.left < rightBoundary;
    }).sort((leftInput, rightInput) => (
      leftInput.getBoundingClientRect().left - rightInput.getBoundingClientRect().left
    ));
  }

  function commitHostInputValue(input, value) {
    if (!input) return false;
    input.focus();
    setHostInputValue(input, value);
    input.blur();
    return true;
  }

  async function fillRecordedStoreRuleNumbers() {
    let editor = storeRuleEditor();
    if (!editor) throw new Error('未找到“店铺行为人群”规则行。');
    let frequencyInputs = editableInputsBetween(['浏览次数'], ['时间类型'], editor);
    if (!frequencyInputs.length) throw new Error('未找到“浏览次数”的数值范围输入框。');
    commitHostInputValue(frequencyInputs[0], '1');
    await sleepVisual(100);

    editor = storeRuleEditor();
    if (!editor) throw new Error('设置浏览次数后规则行未正常刷新。');
    frequencyInputs = editableInputsBetween(['浏览次数'], ['时间类型'], editor);
    if (!frequencyInputs.length) throw new Error('设置浏览次数后规则行未正常刷新。');
    if (String(frequencyInputs[0].value || '').trim() !== '1') {
      commitHostInputValue(frequencyInputs[0], '1');
    }
    if (frequencyInputs[1] && String(frequencyInputs[1].value || '').trim()) {
      commitHostInputValue(frequencyInputs[1], '');
    }
    await sleepVisual(100);

    editor = storeRuleEditor();
    if (!editor) throw new Error('设置浏览次数后规则行未正常刷新。');
    let dayInputs = editableInputsBetween(['最近天数'], [], editor);
    if (!dayInputs.length) throw new Error('未找到“最近天数”输入框。');
    commitHostInputValue(dayInputs[0], '30');
    await sleepVisual(120);

    editor = storeRuleEditor();
    if (!editor) throw new Error('设置最近天数后规则行未正常刷新。');
    dayInputs = editableInputsBetween(['最近天数'], [], editor);
    if (!dayInputs.length) throw new Error('设置最近天数后规则行未正常刷新。');
    if (String(dayInputs[0].value || '').trim() !== '30') {
      commitHostInputValue(dayInputs[0], '30');
    }
  }

  function readablePopulation() {
    const labels = visualTextElements(
      ['覆盖人数', '人群数量', '人群规模', '预估人数'],
      document.body,
      false
    );
    for (const label of labels) {
      let current = label;
      for (let level = 0; level < 5 && current && current !== document.body; level += 1) {
        const text = hostElementText(current);
        if (text.length <= 160 && !/计算中|生成中|处理中|预估中/.test(text)) {
          const match = text.match(/\d[\d,，]*/);
          if (match) return match[0].replace(/，/g, ',');
        }
        current = current.parentElement;
      }
    }
    return '';
  }

  function enabledActionButton(labels, rootElement) {
    const scope = rootElement || document.body;
    const normalizedLabels = labels.map(normalizeHostText);
    return visualElements(scope).filter((element) => element.matches('button,[role="button"]'))
      .filter((element) => normalizedLabels.includes(normalizeHostText(hostElementText(element))))
      .filter((element) => !element.disabled && element.getAttribute('aria-disabled') !== 'true')
      .sort((left, right) => right.getBoundingClientRect().top - left.getBoundingClientRect().top)[0] || null;
  }

  function enabledCreateButton(rootElement) {
    return enabledActionButton(['创建人群', '立即创建', '确认创建', '创建'], rootElement);
  }

  function dialogContaining(labels) {
    const textElement = visualTextElementByPriority(labels, document.body);
    if (!textElement) return null;
    const knownDialog = textElement.closest('[role="dialog"],.next-dialog,.ant-modal,.dialog');
    if (knownDialog) return knownDialog;

    let current = textElement.parentElement;
    for (let level = 0; level < 8 && current && current !== document.body; level += 1) {
      const text = normalizeHostText(hostElementText(current));
      const hasVisibleAction = Array.from(current.querySelectorAll('button,[role="button"]'))
        .some(isHostVisible);
      if (hasVisibleAction && text.length <= 4000) return current;
      current = current.parentElement;
    }
    return textElement.parentElement;
  }

  function inputForFieldLabel(labelAliases, rootElement) {
    const container = fieldContainer(labelAliases, rootElement);
    if (!container) return null;
    return Array.from(container.querySelectorAll('input,textarea')).find((input) => (
      isHostVisible(input) && !input.readOnly && !input.disabled
    )) || null;
  }

  async function acknowledgeCrowdCreated(crowdName) {
    const successDialog = await waitVisual(
      () => dialogContaining(['恭喜，人群创建成功！', '人群创建成功', '创建成功']),
      30000,
      '已保存人群，但未收到“人群创建成功”反馈。'
    );
    const confirmButton = await waitVisual(
      () => enabledActionButton(['确定', '我知道了'], successDialog),
      8000,
      '人群已创建成功，但未找到成功提示的“确定”按钮。'
    );
    clickHostElement(confirmButton);
    await waitVisual(
      () => {
        const text = normalizeHostText(document.body && document.body.innerText);
        return /crowds-new\/list/.test(location.hash) && text.includes(normalizeHostText(crowdName));
      },
      20000,
      '确认创建成功后，未在“我的人群”列表看到新建人群。'
    );
  }

  function visualCrowdCreateReady() {
    if (!/crowds-new\/create/.test(location.hash)) return false;
    const text = normalizeHostText(document.body && document.body.innerText);
    return text.includes('自定义圈人运算池') ||
      text.includes('交集运算池') ||
      Boolean(findHostInput(['输入关键词回车搜索标签', '搜索人群标签'], document));
  }

  async function enterVisualCrowdCreate() {
    if (visualCrowdCreateReady()) return true;
    if (!/crowds-new\/create/.test(location.hash)) {
      location.hash = '!/crowds-new/create';
    }
    return waitVisual(
      visualCrowdCreateReady,
      20000,
      '已直接跳转自定义圈人页，但页面未在20秒内就绪。'
    );
  }

  async function createVisualStoreAudience(crowdName) {
    const name = String(crowdName || '全店人群资产').trim();
    const inspection = await runtimeDmpAction('inspect', { names: [name] });
    if (inspection.results && inspection.results[0] && inspection.results[0].exists) {
      return Object.assign({ ok: true, skipped: true, name }, inspection.results[0], {
        account: inspection.account,
        message: '已在“我的人群”找到同名人群。',
      });
    }

    state.presetLoading = true;
    state.presetMessage = '正在通过自定义圈人创建“' + name + '”...';
    state.open = false;
    render();
    try {
      if (!storeRuleEditorReady()) {
        await enterVisualCrowdCreate();
      }

      if (!storeRuleEditorReady()) {
        let searchInput = findHostInput(['搜索标签', '搜索人群标签', '搜索'], document);
        if (!searchInput) {
          const searchButton = visualTextElement(['搜索'], document.body, true);
          if (searchButton) clickHostElement(searchButton);
          searchInput = await waitVisual(
            () => findHostInput(['搜索标签', '搜索人群标签', '搜索'], document),
            5000,
            '圈人页未找到标签搜索框。'
          );
        }
        setHostInputValue(searchInput, '店铺行为人群');
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
        const suggestion = await waitVisual(
          () => tagSearchSuggestion('店铺行为人群'),
          5000,
          '搜索后未出现“店铺行为人群”关联词候选。'
        );
        clickHostElement(suggestion);
        const card = await waitVisual(
          () => {
            const candidate = tagCardFor('店铺行为人群');
            return candidate && candidate.getAttribute('draggable') === 'true' ? candidate : null;
          },
          12000,
          '点击关联词后未找到可拖拽的“店铺行为人群”卡片。'
        );
        const pool = await waitVisual(operationPool, 8000, '未找到标签运算池。');
        dragTagToPool(card, pool);
        try {
          await waitVisual(storeRuleEditorReady, 5000, '');
        } catch (error) {
          await dragTagToPoolWithPointer(card, pool);
          dragTagToPool(card, pool);
          await waitVisual(storeRuleEditorReady, 5000, '“店铺行为人群”未成功加入运算池。');
        }
      }

      await chooseVisualField(
        ['选择类目'],
        ['全部类目'],
        false,
        storeRuleEditor()
      );
      ensureVisualChoiceChecked(['全部类目'], storeRuleEditor());
      await chooseVisualField(['用户行为'], ['浏览'], false, storeRuleEditor());
      await chooseVisualField(['浏览限定条件'], ['浏览次数'], false, storeRuleEditor());
      await chooseVisualField(['时间类型'], ['最近N天'], false, storeRuleEditor());
      await fillRecordedStoreRuleNumbers();

      const population = await waitVisual(
        readablePopulation,
        120000,
        '规则已设置，但底部两分钟内没有返回人群数量。'
      );
      const createButton = await waitVisual(
        () => enabledCreateButton(document.body),
        8000,
        '覆盖人数已返回，但未找到可用的“创建人群”按钮。'
      );
      clickHostElement(createButton);
      const infoDialog = await waitVisual(
        () => dialogContaining(['填写人群信息']),
        10000,
        '点击“创建人群”后未出现“填写人群信息”弹窗。'
      );
      const nameInput = await waitVisual(
        () => inputForFieldLabel(['人群名称'], infoDialog) ||
          findHostInput(['最多输入25个字符', '人群名称', '请输入人群名称'], infoDialog),
        8000,
        '“填写人群信息”弹窗中未找到人群名称输入框。'
      );
      commitHostInputValue(nameInput, name);
      const saveButton = await waitVisual(
        () => enabledActionButton(['保存'], infoDialog),
        8000,
        '填写人群名称后未找到可用的“保存”按钮。'
      );
      clickHostElement(saveButton);
      await acknowledgeCrowdCreated(name);
      const verified = await runtimeDmpAction('inspect', { names: [name] });
      const verifiedCrowd = verified.results && verified.results[0];
      if (!verifiedCrowd || !verifiedCrowd.exists || !verifiedCrowd.crowdId) {
        throw new Error('页面提示创建成功，但列表查询未返回该人群 ID。');
      }
      return Object.assign({ ok: true, skipped: false, name, population }, verifiedCrowd, {
        account: verified.account,
        verified: true,
      });
    } finally {
      state.presetLoading = false;
      state.open = true;
      render();
    }
  }

  async function createFastStoreAudience(crowdName) {
    const name = String(crowdName || '全店人群资产').trim();
    const visualResult = await createVisualStoreAudience(name);
    return Object.assign({}, visualResult, { method: 'visual' });
  }

  async function runFastStoreCreate() {
    state.presetLoading = true;
    state.presetMessage = '正在创建并核对“全店人群资产”...';
    render();
    try {
      const result = await createFastStoreAudience('全店人群资产');
      const idText = result.crowdId ? '（ID: ' + result.crowdId + '）' : '';
      const accountText = accountLabel(result.account) + '：';
      state.presetMessage = result.skipped
        ? accountText + '已在“我的人群”找到全店人群资产' + idText + '。'
        : accountText + '全店人群资产已通过页面创建并核实' + idText + '，预估人数：' + result.population;
    } catch (error) {
      state.presetMessage = error && error.message ? error.message : String(error);
    } finally {
      state.presetLoading = false;
      state.open = true;
      render();
    }
  }

  async function saveSnapshot() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          savedAt: Date.now(),
          results: state.results,
          resultSignature: state.resultSignature,
        },
      });
    } catch (error) {
      console.warn(TAG, '保存缓存失败:', error);
    }
  }

  async function loadCrowds() {
    setLoading('正在读取我的人群...');
    try {
      const data = await dmpRequest('listCrowds', { pageSize: 100 });
      state.crowds = data.list || [];
      setIdle('已读取 ' + state.crowds.length + ' 个人群');
    } catch (error) {
      setIdle(error.message || String(error));
    }
  }

  async function loadGroups() {
    if (state.groups.length) return;
    setLoading('正在读取画像标签分组...');
    try {
      state.groups = await dmpRequest('getTagGroups', {});
      if (!state.currentGroupId && state.groups[0]) state.currentGroupId = state.groups[0].id;
      setIdle('画像标签分组已就绪');
      if (state.currentGroupId) await loadTags(state.currentGroupId);
    } catch (error) {
      setIdle(error.message || String(error));
    }
  }

  async function loadTags(groupId) {
    state.currentGroupId = groupId;
    const crowdId = Array.from(state.selectedCrowdIds)[0] || (state.crowds[0] && state.crowds[0].crowdId);
    setLoading('正在读取标签...');
    try {
      state.tags = await dmpRequest('getTags', { groupId: groupId, crowdId: crowdId });
      setIdle('已读取 ' + state.tags.length + ' 个标签');
    } catch (error) {
      state.tags = [];
      setIdle(error.message || String(error));
    }
  }

  async function buildPortraits() {
    const crowdIds = Array.from(state.selectedCrowdIds);
    const tags = Array.from(state.selectedTags.values());
    if (!crowdIds.length || !tags.length) {
      setIdle('请至少选择 1 个人群和 1 个画像标签');
      return;
    }
    state.results = [];
    state.resultSignature = '';
    for (let i = 0; i < crowdIds.length; i += 1) {
      const crowd = state.crowds.find((item) => String(item.crowdId) === String(crowdIds[i])) || {};
      setLoading('正在生成画像 ' + (i + 1) + '/' + crowdIds.length + ': ' + (crowd.crowdName || crowdIds[i]));
      try {
        const result = await dmpRequest('buildPortrait', {
          crowdId: crowdIds[i],
          crowdName: crowd.crowdName,
          tags: tags,
        });
        state.results.push(result);
        await saveSnapshot();
      } catch (error) {
        state.results.push({
          crowd: { crowdId: crowdIds[i], crowdName: crowd.crowdName || crowdIds[i] },
          error: error.message || String(error),
          charts: [],
        });
      }
      render();
    }
    state.resultSignature = selectionSignature();
    await saveSnapshot();
    setIdle('画像生成完成');
  }

  function selectionSignature() {
    const crowdIds = Array.from(state.selectedCrowdIds).map(String).sort();
    const tagIds = Array.from(state.selectedTags.keys()).map(String).sort();
    return JSON.stringify({ crowds: crowdIds, tags: tagIds });
  }

  function canExportCurrentResults() {
    return Boolean(state.results.length && state.resultSignature && state.resultSignature === selectionSignature());
  }

  function ensureExportReady() {
    if (!state.results.length) {
      setIdle('请先生成画像，再导出');
      return false;
    }
    if (!canExportCurrentResults()) {
      setIdle('当前选择已变化，请重新点击“生成画像”后再导出');
      return false;
    }
    return true;
  }

  function exportCsv() {
    if (!ensureExportReady()) return;
    const rows = [['人群ID', '人群名称', '标签', '选项', '人数', '占比%', 'TGI', 'CTR', 'PPC']];
    state.results.forEach((result) => {
      (result.charts || []).forEach((chart) => {
        (chart.rows || []).forEach((row) => {
          rows.push([
            result.crowd && result.crowd.crowdId,
            result.crowd && result.crowd.crowdName,
            chart.tagName,
            row.optionName,
            row.optionNum,
            row.rate,
            row.tgi,
            row.ctrIndex,
            row.ppcIndex,
          ]);
        });
      });
    });
    const csv = rows.map((row) => row.map((cell) => '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DMP画像_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function colorFor(index) {
    const colors = ['#5b5ff5', '#ff8a1c', '#19b7a2', '#ef4444', '#8b5cf6', '#0ea5e9', '#f59e0b', '#64748b'];
    return colors[index % colors.length];
  }

  function collectReportTags() {
    const tagMap = new Map();
    const selectedTagIds = new Set(Array.from(state.selectedTags.keys()).map(String));
    state.results.forEach((result, crowdIndex) => {
      const crowd = result.crowd || {};
      (result.charts || []).forEach((chart) => {
        const tagId = String(chart.tagId || chart.tagName);
        if (selectedTagIds.size && !selectedTagIds.has(tagId)) return;
        if (!tagMap.has(tagId)) {
          tagMap.set(tagId, {
            tagId: tagId,
            tagName: chart.tagName,
            options: new Map(),
          });
        }
        const tag = tagMap.get(tagId);
        (chart.rows || []).forEach((row) => {
          const optionKey = String(row.optionValue || row.optionName);
          if (!tag.options.has(optionKey)) {
            tag.options.set(optionKey, {
              optionName: row.optionName || optionKey,
              crowds: new Map(),
            });
          }
          tag.options.get(optionKey).crowds.set(String(crowd.crowdId), {
            crowdId: crowd.crowdId,
            crowdName: crowd.crowdName,
            crowdIndex: crowdIndex,
            rate: Number(row.rate) || 0,
            optionNum: row.optionNum,
            tgi: row.tgi,
          });
        });
      });
    });
    return Array.from(tagMap.values()).map((tag) => {
      const options = Array.from(tag.options.values()).sort((left, right) => {
        const leftMax = Math.max(0, ...Array.from(left.crowds.values()).map((row) => row.rate));
        const rightMax = Math.max(0, ...Array.from(right.crowds.values()).map((row) => row.rate));
        return rightMax - leftMax;
      });
      return Object.assign({}, tag, { options: options.slice(0, 10) });
    });
  }

  function exportReport() {
    if (!ensureExportReady()) return;
    const crowds = state.results.map((result, index) => ({
      crowdId: result.crowd && result.crowd.crowdId,
      crowdName: result.crowd && result.crowd.crowdName || '人群' + (index + 1),
      crowdIndex: index,
    }));
    const tags = collectReportTags();
    const generatedAt = new Date().toLocaleString('zh-CN');
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>DMP画像报告</title><style>' + reportStyles() + '</style></head><body>' +
      '<main>' +
      '<header class="report-head"><h1>DMP画像报告</h1><p>生成时间：' + escapeHtml(generatedAt) + ' · 人群数：' + crowds.length + ' · 标签数：' + tags.length + '</p></header>' +
      '<section class="crowd-summary"><h2>选择人群</h2><div class="legend">' + crowds.map((crowd) => (
        '<span><i style="background:' + colorFor(crowd.crowdIndex) + '"></i>' + escapeHtml(crowd.crowdName) + '<small>ID: ' + escapeHtml(crowd.crowdId) + '</small></span>'
      )).join('') + '</div></section>' +
      tags.map((tag) => renderReportTag(tag, crowds)).join('') +
      '</main></body></html>';
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'DMP画像报告_' + new Date().toISOString().slice(0, 10) + '.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderReportTag(tag, crowds) {
    const maxRate = Math.max(1, ...tag.options.flatMap((option) => crowds.map((crowd) => {
      const row = option.crowds.get(String(crowd.crowdId));
      return row ? row.rate : 0;
    })));
    return '<section class="tag-section"><h2>' + escapeHtml(tag.tagName) + '</h2>' +
      '<table class="report-table"><thead><tr><th>选项</th>' + crowds.map((crowd) => '<th><span class="crowd-dot" style="background:' + colorFor(crowd.crowdIndex) + '"></span>' + escapeHtml(crowd.crowdName) + '</th>').join('') + '</tr></thead><tbody>' +
      tag.options.map((option) => (
        '<tr><td>' + escapeHtml(option.optionName) + '</td>' + crowds.map((crowd) => {
          const row = option.crowds.get(String(crowd.crowdId));
          if (!row) return '<td class="data-cell empty-cell">-</td>';
          const width = Math.max(row.rate > 0 ? 2 : 0, Math.min(100, row.rate / maxRate * 100));
          return '<td class="data-cell" style="--bar:' + width + '%;--bar-color:' + colorFor(crowd.crowdIndex) + '">' +
            '<div class="cell-fill"></div>' +
            '<div class="cell-content"><strong>' + escapeHtml(row.rate + '%') + '</strong><small>人数 ' + escapeHtml(formatNumber(row.optionNum)) + ' · TGI ' + escapeHtml(row.tgi || '-') + '</small></div>' +
          '</td>';
        }).join('') + '</tr>'
      )).join('') +
      '</tbody></table></section>';
  }

  function reportStyles() {
    return [
      'body{margin:0;background:#f5f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"PingFang SC","Microsoft YaHei",sans-serif}',
      'main{max-width:1180px;margin:0 auto;padding:32px 28px 56px}',
      '.report-head{margin-bottom:20px}.report-head h1{margin:0 0 8px;font-size:28px}.report-head p{margin:0;color:#667085}',
      'section{background:#fff;border:1px solid #e8ebf2;border-radius:8px;margin:16px 0;padding:20px;box-shadow:0 8px 24px rgba(15,23,42,.04)}',
      'h2{font-size:18px;margin:0 0 16px}.legend{display:flex;flex-wrap:wrap;gap:10px}.legend span{display:inline-flex;align-items:center;gap:8px;border:1px solid #e5e7eb;border-radius:18px;padding:7px 10px;background:#fff}.legend i{width:10px;height:10px;border-radius:50%;display:inline-block}.legend small{color:#7b8495;margin-left:4px}',
      '.report-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;table-layout:fixed;border:1px solid #edf0f5;border-radius:8px;overflow:hidden}th,td{border-bottom:1px solid #edf0f5;text-align:left;padding:10px 9px;vertical-align:middle}th{background:#f8fafc;color:#475467;font-weight:700}td:first-child,th:first-child{width:150px;background:#fbfcfe;color:#344054;font-weight:700}.crowd-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}.data-cell{position:relative;height:52px;overflow:hidden;background:#fff}.data-cell .cell-fill{position:absolute;inset:7px auto 7px 7px;width:var(--bar);border-radius:5px;background:color-mix(in srgb,var(--bar-color) 22%,white);border-left:3px solid var(--bar-color)}.data-cell .cell-content{position:relative;z-index:1;display:flex;align-items:baseline;justify-content:space-between;gap:8px}.data-cell strong{font-size:14px;color:#172033}.data-cell small{color:#667085;white-space:nowrap}.empty-cell{color:#98a2b3;text-align:center;background:#fafafa}',
      '@media print{body{background:#fff}section{box-shadow:none;break-inside:avoid}.report-table{page-break-inside:auto}tr{break-inside:avoid}}',
    ].join('');
  }

  function selectedCrowdList() {
    return state.crowds.filter((crowd) => state.selectedCrowdIds.has(String(crowd.crowdId)));
  }

  function renderCrowds() {
    if (!state.crowds.length) return '<div class="empty">还没有读取人群，点击“刷新人群”。</div>';
    return '<div class="list">' + state.crowds.map((crowd) => {
      const id = String(crowd.crowdId);
      return '<label class="row">' +
        '<input type="checkbox" data-action="toggle-crowd" data-id="' + escapeHtml(id) + '"' + (state.selectedCrowdIds.has(id) ? ' checked' : '') + '>' +
        '<span><b>' + escapeHtml(crowd.crowdName) + '</b><small>ID: ' + escapeHtml(id) + ' · 规模 ' + escapeHtml(formatNumber(crowd.coverage)) + '</small></span>' +
        '<button type="button" data-action="open-perspective" data-id="' + escapeHtml(id) + '">打开画像</button>' +
      '</label>';
    }).join('') + '</div>';
  }

  function renderGroups() {
    if (!state.groups.length) return '<div class="empty">打开面板后会自动读取标签分组。</div>';
    return '<div class="tabs">' + state.groups.map((group) => (
      '<button type="button" data-action="select-group" data-id="' + escapeHtml(group.id) + '" class="' + (String(group.id) === String(state.currentGroupId) ? 'active' : '') + '">' +
        escapeHtml(group.name) +
      '</button>'
    )).join('') + '</div>';
  }

  function renderTags() {
    if (!state.tags.length) return '<div class="empty">当前分组暂无可选标签，或需要先选择一个人群。</div>';
    return '<div class="tag-grid">' + state.tags.map((tag) => {
      const id = String(tag.id);
      return '<label class="tag">' +
        '<input type="checkbox" data-action="toggle-tag" data-id="' + escapeHtml(id) + '"' + (state.selectedTags.has(id) ? ' checked' : '') + '>' +
        '<span>' + escapeHtml(tag.tagName) + '</span>' +
      '</label>';
    }).join('') + '</div>';
  }

  function renderResults() {
    if (!state.results.length) return '<div class="empty">生成后，这里展示各人群在所选标签下的画像分布。</div>';
    const stale = state.results.length && !canExportCurrentResults();
    return state.results.map((result) => {
      if (result.error) {
        return '<section class="result"><h3>' + escapeHtml(result.crowd && result.crowd.crowdName) + '</h3><div class="error">' + escapeHtml(result.error) + '</div></section>';
      }
      return '<section class="result"><h3>' + escapeHtml(result.crowd && result.crowd.crowdName) +
        '<small>ID: ' + escapeHtml(result.crowd && result.crowd.crowdId) + '</small></h3>' +
        (result.charts || []).map(renderChart).join('') +
      '</section>';
    }).join('') + (stale ? '<div class="empty">当前选择已变化，请重新生成画像后再导出。</div>' : '');
  }

  function renderChart(chart) {
    const rows = (chart.rows || []).slice(0, 8);
    const maxRate = Math.max(1, ...rows.map((row) => Number(row.rate) || 0));
    return '<div class="chart"><h4>' + escapeHtml(chart.tagName) + '</h4>' +
      rows.map((row) => {
        const rate = Number(row.rate) || 0;
        const width = Math.max(2, Math.min(100, rate / maxRate * 100));
        return '<div class="bar-row">' +
          '<span class="bar-name">' + escapeHtml(row.optionName) + '</span>' +
          '<span class="bar-track"><i style="width:' + width + '%"></i></span>' +
          '<span class="bar-value">' + escapeHtml(rate) + '%</span>' +
          '<span class="bar-extra">TGI ' + escapeHtml(row.tgi || '-') + '</span>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  function renderPortraitPanel() {
    return '<div class="toolbar">' +
        '<button data-action="load-crowds">刷新人群</button>' +
        '<button data-action="build" class="primary"' + (state.loading ? ' disabled' : '') + '>生成画像</button>' +
        '<button data-action="export" ' + (canExportCurrentResults() ? '' : 'disabled') + '>导出 CSV</button>' +
        '<button data-action="export-report" ' + (canExportCurrentResults() ? '' : 'disabled') + '>导出报告</button>' +
      '</div>' +
      '<div class="status ' + (state.loading ? 'busy' : '') + '">' + escapeHtml(state.message || '已选 ' + selectedCrowdList().length + ' 个人群、' + state.selectedTags.size + ' 个标签') + '</div>' +
      '<section><h2>人群</h2>' + renderCrowds() + '</section>' +
      '<section><h2>画像标签</h2>' + renderGroups() + renderTags() + '</section>' +
      '<section><h2>画像结果</h2>' + renderResults() + '</section>';
  }

  function presetStatusFor(preset) {
    return state.presetStatuses.find((item) => String(item.name || '') === String(preset.name));
  }

  function renderPresetRows() {
    return '<div class="preset-list">' + RULE_CROWDS.map((preset, index) => {
      const status = presetStatusFor(preset);
      const summary = preset.rules || [];
      let stateText = '待核对';
      let stateClass = '';
      if (status) {
        if (status.exists || status.skipped) {
          stateText = status.message || '已存在';
          stateClass = 'skip';
        } else if (status.ok && status.crowdId && !status.template) {
          stateText = '创建成功 · ID ' + status.crowdId;
          stateClass = 'ready';
        } else if (status.ok === false) {
          stateText = status.message || '操作失败';
          stateClass = 'error';
        } else if (status.message) {
          stateText = status.message;
          stateClass = status.exists ? 'skip' : 'ready';
        }
      }
      return '<article class="preset-row">' +
        '<span class="preset-index">' + (index + 1) + '</span>' +
        '<div><strong>' + escapeHtml(preset.name) + '</strong>' +
          (summary.length
            ? '<div class="condition-chips">' + summary.map((label) => '<span>' + escapeHtml(label) + '</span>').join('') + '</div>'
            : '') +
        '</div>' +
        '<em class="' + stateClass + '">' + escapeHtml(stateText) + '</em>' +
      '</article>';
    }).join('') + '</div>';
  }

  function renderPresetPanel() {
    const accountText = [
      state.presetCurrentAccount ? '当前账号：' + accountLabel(state.presetCurrentAccount) : '',
    ].filter(Boolean).join(' · ');
    return '<div class="toolbar preset-toolbar">' +
        '<button data-action="inspect-presets" class="primary"' + (state.presetLoading ? ' disabled' : '') + '>刷新并读取已有人群</button>' +
      '</div>' +
      '<div class="status ' + (state.presetLoading ? 'busy' : '') + '">' +
        escapeHtml(state.presetMessage || '手动建包完成后，按固定名称读取人数与画像') +
      '</div>' +
      (accountText ? '<div class="account-line">' + escapeHtml(accountText) + '</div>' : '') +
      '<section class="preset-section"><h2>内容人群包</h2>' + renderPresetRows() + '</section>';
  }

  function render() {
    if (!shadow) return;
    shadow.innerHTML = '<style>' + styles() + '</style>' +
      '<button class="trigger" data-action="toggle-panel">DMP工具</button>' +
      (state.open ? '<aside class="panel">' +
        '<header><div><strong>达摩盘人群工具</strong><span>' +
          escapeHtml(state.mode === 'portrait' ? '批量画像与报告' : '读取四个诊断人群包') +
        '</span></div><button data-action="toggle-panel">×</button></header>' +
        '<nav class="mode-tabs">' +
          '<button data-action="set-mode" data-id="portrait" class="' + (state.mode === 'portrait' ? 'active' : '') + '">批量画像</button>' +
          '<button data-action="set-mode" data-id="presets" class="' + (state.mode === 'presets' ? 'active' : '') + '">已有人群</button>' +
        '</nav>' +
        (state.mode === 'portrait' ? renderPortraitPanel() : renderPresetPanel()) +
      '</aside>' : '');
  }

  function styles() {
    return [
      ':host{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937}',
      '*{box-sizing:border-box}',
      '.trigger{position:fixed;right:18px;bottom:122px;z-index:2147483646;border:0;border-radius:22px;background:#5b5ff5;color:#fff;padding:11px 14px;font-size:13px;font-weight:700;box-shadow:0 8px 24px rgba(39,44,130,.28);cursor:pointer}',
      '.panel{position:fixed;right:18px;top:76px;bottom:24px;width:min(620px,calc(100vw - 36px));z-index:2147483647;background:#fff;border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 18px 60px rgba(15,23,42,.22);overflow:auto}',
      'header{position:sticky;top:0;background:#fff;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #eef0f4}',
      'header strong{display:block;font-size:16px} header span{display:block;color:#6b7280;font-size:12px;margin-top:4px} header button{border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#6b7280}',
      '.mode-tabs{position:sticky;top:70px;z-index:1;display:flex;gap:20px;padding:0 18px;background:#fff;border-bottom:1px solid #eef0f4}.mode-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;padding:12px 2px 10px;color:#667085;cursor:pointer}.mode-tabs button.active{border-bottom-color:#5b5ff5;color:#4338ca;font-weight:700}',
      '.toolbar{display:flex;gap:8px;padding:14px 18px 8px;flex-wrap:wrap}.toolbar button,.row button{border:1px solid #d8dce5;background:#fff;border-radius:6px;padding:7px 10px;cursor:pointer;color:#374151}.toolbar .primary{background:#5b5ff5;color:#fff;border-color:#5b5ff5}.toolbar button:disabled{opacity:.55;cursor:not-allowed}',
      '.status{margin:0 18px 10px;padding:9px 10px;border-radius:6px;background:#f6f7fb;color:#4b5563;font-size:12px}.status.busy{color:#4338ca;background:#eef2ff}',
      '.account-line{margin:0 18px 10px;color:#667085;font-size:12px}.preset-section{padding-top:14px}.preset-list{display:grid;gap:8px}.preset-row{display:grid;grid-template-columns:30px minmax(0,1fr) auto;gap:10px;align-items:start;border:1px solid #e9ecf3;border-radius:6px;padding:11px;background:#fff}.preset-index{display:grid;place-items:center;width:25px;height:25px;border-radius:5px;background:#eef2ff;color:#4f46e5;font-weight:700;font-size:12px}.preset-row strong{display:block;font-size:13px}.preset-row small{display:block;color:#7b8495;font-size:11px;margin-top:3px}.preset-row em{max-width:150px;color:#667085;font-style:normal;font-size:11px;text-align:right}.preset-row em.ready{color:#047857}.preset-row em.skip{color:#b45309}.preset-row em.error{color:#b91c1c}.condition-chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px}.condition-chips span{border:1px solid #dde3ee;border-radius:4px;background:#f8fafc;color:#475467;padding:3px 5px;font-size:10px}',
      'section{padding:12px 18px;border-top:1px solid #f0f2f5}h2{font-size:14px;margin:0 0 10px}h3{font-size:14px;margin:0 0 10px;display:flex;gap:10px;align-items:baseline}h3 small{font-weight:400;color:#6b7280}h4{font-size:13px;margin:14px 0 8px;color:#374151}',
      '.list{display:grid;gap:8px;max-height:230px;overflow:auto}.row{display:grid;grid-template-columns:22px 1fr auto;gap:8px;align-items:center;border:1px solid #eef0f4;border-radius:6px;padding:9px}.row b{display:block;font-size:13px}.row small{display:block;color:#6b7280;margin-top:3px;font-size:12px}',
      '.tabs{display:flex;gap:7px;overflow:auto;margin-bottom:10px}.tabs button{white-space:nowrap;border:1px solid #dde1eb;background:#fff;border-radius:16px;padding:6px 10px;cursor:pointer}.tabs button.active{background:#eef2ff;color:#4f46e5;border-color:#aeb7ff}',
      '.tag-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.tag{display:flex;gap:8px;align-items:center;border:1px solid #eef0f4;border-radius:6px;padding:8px;font-size:13px}',
      '.empty{font-size:12px;color:#8a93a3;background:#fafafa;border:1px dashed #e5e7eb;border-radius:6px;padding:12px}.error{color:#b91c1c;background:#fef2f2;border-radius:6px;padding:10px;font-size:12px}',
      '.result{padding:12px 0;border-top:0}.chart{border:1px solid #edf0f5;border-radius:6px;padding:10px;margin-bottom:10px}.bar-row{display:grid;grid-template-columns:120px 1fr 58px 64px;gap:8px;align-items:center;font-size:12px;margin:7px 0}.bar-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar-track{height:10px;background:#eef0f5;border-radius:999px;overflow:hidden}.bar-track i{display:block;height:100%;background:linear-gradient(90deg,#5b5ff5,#35c7b4)}.bar-value{text-align:right;font-variant-numeric:tabular-nums}.bar-extra{color:#6b7280;text-align:right}',
    ].join('');
  }

  function onClick(event) {
    const target = event.target && event.target.closest('[data-action]');
    if (!target) return;
    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-id');
    if (action === 'toggle-panel') {
      state.open = !state.open;
      render();
      if (state.open && state.mode === 'portrait' && !state.crowds.length) loadCrowds().then(loadGroups);
      else if (state.open && state.mode === 'portrait' && !state.groups.length) loadGroups();
    } else if (action === 'set-mode') {
      state.mode = id === 'presets' ? 'presets' : 'portrait';
      render();
      if (state.mode === 'presets') inspectPresetTargets();
      else if (!state.crowds.length) loadCrowds().then(loadGroups);
      else if (!state.groups.length) loadGroups();
    } else if (action === 'load-crowds') {
      loadCrowds();
    } else if (action === 'toggle-crowd') {
      if (target.checked) state.selectedCrowdIds.add(String(id));
      else state.selectedCrowdIds.delete(String(id));
      render();
    } else if (action === 'select-group') {
      loadTags(id);
    } else if (action === 'toggle-tag') {
      const tag = state.tags.find((item) => String(item.id) === String(id));
      if (target.checked && tag) state.selectedTags.set(String(id), tag);
      else state.selectedTags.delete(String(id));
      render();
    } else if (action === 'build') {
      buildPortraits();
    } else if (action === 'export') {
      exportCsv();
    } else if (action === 'export-report') {
      exportReport();
    } else if (action === 'open-perspective') {
      dmpRequest('navigatePerspective', { crowdId: id });
    } else if (action === 'inspect-presets') {
      inspectPresetTargets();
    }
  }

  function mount() {
    root = document.createElement('div');
    root.id = 'dmp-portrait-extension-root';
    root.dataset.buildVersion = BUILD_VERSION;
    shadow = root.attachShadow({ mode: 'open' });
    document.documentElement.appendChild(root);
    shadow.addEventListener('click', onClick);
    restore().then(render);
    render();
  }

  if (document.documentElement) mount();
})();

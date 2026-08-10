// wxt-report-trace.js - Opt-in bridge for inspecting normal Wanxiangtai report requests.
(function () {
  'use strict';

  if (location.hostname !== 'one.alimama.com' && location.hostname !== 'one.alimama.hk') return;
  if (new URL(location.href).searchParams.get('__wxtTrace') !== '1') return;
  if (window.__wxtReportTraceV1) return;
  window.__wxtReportTraceV1 = true;

  const STORAGE_KEY = 'wxtReportApiTraceV1';
  const STORE_ID = 'wxt-api-trace-store';
  let storeElement = null;

  function ensureStoreElement() {
    if (storeElement && storeElement.isConnected) return storeElement;
    storeElement = document.getElementById(STORE_ID);
    if (storeElement) return storeElement;
    storeElement = document.createElement('pre');
    storeElement.id = STORE_ID;
    storeElement.hidden = true;
    storeElement.setAttribute('aria-hidden', 'true');
    (document.documentElement || document).appendChild(storeElement);
    return storeElement;
  }

  function render(records) {
    ensureStoreElement().textContent = JSON.stringify(Array.isArray(records) ? records : []);
  }

  async function enableTrace() {
    try {
      await chrome.runtime.sendMessage({ type: 'WXT_ENABLE_API_TRACE' });
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      render(stored[STORAGE_KEY]);
    } catch (error) {
      render([{ error: error && error.message ? error.message : String(error) }]);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
    render(changes[STORAGE_KEY].newValue);
  });

  document.addEventListener('WXT_REPORT_API_RESPONSE', (event) => {
    try {
      const payload = JSON.parse(String(event.detail || '{}'));
      chrome.runtime.sendMessage({
        type: 'WXT_STORE_API_RESPONSE',
        event: payload,
      }).catch(() => {});
    } catch (error) {}
  });

  enableTrace();
})();

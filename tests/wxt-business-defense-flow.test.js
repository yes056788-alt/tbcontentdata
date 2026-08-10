const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'wxt-report-page-hook.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const messageListeners = [];
const internalMarketingSceneBodies = [];
const internalShortVideoBodies = [];
const internalShortVideoUrls = [];
let currentHash = '#!/report/account?rptType=account';
let responseResolver = null;

function parseBody(body) {
  const text = String(body || '').trim();
  if (!text) return {};
  if (text.startsWith('{')) return JSON.parse(text);
  const data = {};
  for (const [key, rawValue] of new URLSearchParams(text).entries()) {
    const value = rawValue.trim();
    if (
      (value.startsWith('[') && value.endsWith(']')) ||
      (value.startsWith('{') && value.endsWith('}'))
    ) {
      data[key] = JSON.parse(value);
    } else {
      data[key] = rawValue;
    }
  }
  return data;
}

class FakeXMLHttpRequest {
  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader() {}

  send(body) {
    const data = parseBody(body);
    const reportData = data && data.data && data.data.bizCode ? data.data : data;
    const domains = Array.isArray(reportData.queryDomains)
      ? reportData.queryDomains
      : [reportData.queryDomains];
    let responseData = {};

    if (String(this.url || '').includes('/report/chargeSum.json')) {
      responseData = { totalCharge: 1000, shortVideoCharge: 250 };
    } else if (reportData.bizCode === 'universalBP' && domains.includes('scene')) {
      if (this.__wxtInternalRequest) internalMarketingSceneBodies.push(reportData);
      responseData = {
        list: [{
          dimensions: { scene1Name: { absolute: '超级短视频' } },
          metrics: {
            charge: 250,
            roi: { currentValue: '2.70' },
          },
        }],
      };
    } else if (reportData.bizCode === 'onebpShortVideo') {
      if (this.__wxtInternalRequest) {
        internalShortVideoBodies.push(reportData);
        internalShortVideoUrls.push(this.url);
      }
      const isDisplay = reportData.unifyType === 'video_kuan';
      const isShortVideoUrl = new URL(this.url).searchParams.get('bizCode') === 'onebpShortVideo';
      responseData = {
        totalData: [{
          metrics: {
            roi: { value: isDisplay ? '3.40' : '2.70' },
            inshopPotentialUvRate: isDisplay && isShortVideoUrl ? { value: '28%' } : null,
          },
        }],
      };
    }

    this.status = 200;
    this.responseText = JSON.stringify({
      data: responseData,
      info: { ok: true },
    });
    queueMicrotask(() => {
      if (typeof this.onload === 'function') this.onload();
    });
  }
}

const locationObject = {
  hostname: 'one.alimama.com',
  origin: 'https://one.alimama.com',
  href: 'https://one.alimama.com/indexbp.html#!/report/account?rptType=account',
};
Object.defineProperty(locationObject, 'hash', {
  get() {
    return currentHash;
  },
  set(value) {
    currentHash = String(value || '');
  },
});

const windowObject = {
  addEventListener(type, listener) {
    if (type === 'message') messageListeners.push(listener);
  },
  postMessage(message) {
    if (message.type === 'WXT_REPORT_EXPORT_RESPONSE' && responseResolver) {
      responseResolver(message);
    }
  },
  fetch() {
    return Promise.resolve({ ok: true, status: 200 });
  },
};
const context = {
  URL,
  URLSearchParams,
  XMLHttpRequest: FakeXMLHttpRequest,
  clearTimeout,
  console,
  document: { querySelectorAll: () => [] },
  location: locationObject,
  setTimeout,
  window: windowObject,
};
vm.runInNewContext(source, context, { filename: sourcePath });

function sendNaturalRequest(url, data) {
  const xhr = new context.XMLHttpRequest();
  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
  const params = new URLSearchParams();
  Object.entries(data).forEach(([key, value]) => {
    params.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
  });
  xhr.send(params.toString());
}

const marketingBase = {
  bizCode: 'universalBP',
  rptType: 'account',
  source: 'baseReport',
  effectEqual: 15,
  splitType: 'day',
  unifyType: 'zhai',
};
sendNaturalRequest('https://one.alimama.com/report/query.json?csrfId=test', {
  ...marketingBase,
  queryDomains: ['account'],
});
sendNaturalRequest('https://one.alimama.com/report/query.json?csrfId=test', {
  ...marketingBase,
  queryDomains: ['scene'],
});
sendNaturalRequest('https://one.alimama.com/report/chargeSum.json?csrfId=test', marketingBase);

async function run() {
  const responsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('business defense flow timed out')), 5000);
    responseResolver = (message) => {
      clearTimeout(timeout);
      resolve(message);
    };
  });
  const request = {
    source: 'wxt-report-content',
    type: 'WXT_REPORT_EXPORT_REQUEST',
    requestId: 'wxt-business-defense-test',
    reportKind: 'businessDefense',
    startTime: '2026-07-06',
    endTime: '2026-08-04',
  };
  messageListeners.forEach((listener) => listener({
    source: windowObject,
    origin: locationObject.origin,
    data: request,
  }));

  const response = await responsePromise;
  assert.equal(response.ok, true);
  assert.equal(response.data.businessDefenseMetrics.lastClickRoi, 2.7);
  assert.equal(response.data.businessDefenseMetrics.displayRoi, 3.4);
  assert.equal(response.data.businessDefenseMetrics.displayPotentialRatio, 0.28);
  assert.equal(internalMarketingSceneBodies.length, 1);
  assert.equal(internalMarketingSceneBodies[0].unifyType, 'zhai');
  assert.ok(internalMarketingSceneBodies.every((body) => body.bizCode === 'universalBP'));
  assert.equal(response.data.businessDefenseMetrics.displayPotentialRatioSource, 'shortVideoAccountApi');
  assert.equal(internalShortVideoBodies.length, 2);
  assert.equal(internalShortVideoBodies[0].unifyType, 'zhai');
  assert.equal(internalShortVideoBodies[1].unifyType, 'video_kuan');
  assert.ok(internalShortVideoBodies.every((body) => body.bizCode === 'onebpShortVideo'));
  assert.ok(internalShortVideoUrls.every((url) => (
    new URL(url).searchParams.get('bizCode') === 'onebpShortVideo'
  )));
  assert.equal(currentHash, '#!/report/account?rptType=account');
  console.log('wxt business defense flow passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

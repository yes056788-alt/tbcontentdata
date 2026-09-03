const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const sourcePath = path.join(__dirname, '..', 'web-tool-bridge.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const messageListeners = [];
const posted = [];
const storageReads = [];
const storageWrites = [];
const storageRemovals = [];
const runtimeMessages = [];
const storageState = {};
let confirmResult = true;

const windowObject = {
  addEventListener(type, listener) {
    if (type === 'message') messageListeners.push(listener);
  },
  postMessage(message) {
    posted.push(message);
  },
  confirm() {
    return confirmResult;
  },
};
windowObject.top = windowObject;

const chromeObject = {
  runtime: {
    getManifest() {
      return { version: '9.9.9' };
    },
    lastError: null,
    sendMessage(message, callback) {
      runtimeMessages.push(message);
      if (message.type === 'ACCOUNT_SESSION_GET_MANAGEMENT') {
        const current = runtimeMessages.findLast((item) => item.type === 'ACCOUNT_SESSION_SET');
        callback({
          ok: true,
          management: current ? {
            vaultScopeId: message.expectedVaultScopeId,
            vaultLockEpoch: current.vaultLockEpoch,
            vaultFingerprint: message.expectedVaultFingerprint,
            vaultSessionKey: current.vaultSessionKey,
            vault: current.vault,
            unlockedAt: Date.now(),
          } : null,
        });
        return;
      }
      callback({ ok: true, results: [] });
    },
  },
  storage: {
    local: {
      async get(keys) {
        storageReads.push(keys);
        return Object.fromEntries(keys.map((key) => [
          key,
          Object.prototype.hasOwnProperty.call(storageState, key) ? storageState[key] : { key },
        ]));
      },
      async set(value) {
        storageWrites.push(value);
        Object.assign(storageState, value);
      },
      async remove(keys) {
        storageRemovals.push(keys);
        for (const key of Array.isArray(keys) ? keys : [keys]) delete storageState[key];
      },
    },
    onChanged: {
      addListener() {},
    },
  },
};

const context = {
  atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
  btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
  chrome: chromeObject,
  console,
  crypto: webcrypto,
  document: {
    visibilityState: 'visible',
    hasFocus() { return true; },
  },
  location: { origin: 'http://127.0.0.1:3400', pathname: '/accounts.html' },
  TextEncoder,
  Uint8Array,
  window: windowObject,
};
vm.runInNewContext(source, context, { filename: sourcePath });

function send(action, payload, requestId) {
  messageListeners.forEach((listener) => listener({
    source: windowObject,
    origin: context.location.origin,
    data: {
      channel: 'taobao-full-chain-tool-v1',
      type: 'request',
      requestId,
      action,
      payload,
    },
  }));
}

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function run() {
  assert.ok(posted.some((message) => (
    message.type === 'ready' &&
      message.version === '9.9.9' &&
      message.capabilities.includes('accountSessionUnlock') &&
      message.capabilities.includes('accountBatchMultiSelect') &&
      message.capabilities.includes('storeRunManualInputs') &&
      message.capabilities.includes('cloudSync') &&
      message.capabilities.includes('projectTaskCancel') &&
      !message.capabilities.includes('autoCollect') &&
      !message.capabilities.includes('contentDiagnosisReport')
  )));

  send('getStorage', {
    keys: ['gh_channel_snapshot', 'privateUnexpectedKey'],
  }, 'read');
  await settle();
  assert.deepEqual(Array.from(storageReads[0]), ['gh_channel_snapshot']);

  send('setManualInputs', {
    manualInputs: {
      xhs_kolSpend: '1200',
      xhs_dmpVisitors: '3600',
      xhs_l12Penetration: '30%',
      xhs_l45Penetration: '0.3',
      xhs_unreportedNoteCount: '2',
      xhs_storeGmv: {
        value: '8800',
        manualOverride: true,
        updatedAt: '2030-01-02T03:04:05.000Z',
        accountKeys: ['fictional-pgy-account'],
        dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
        unexpected: 'drop-me',
      },
      privateUnexpectedKey: 'secret',
    },
  }, 'write');
  await settle();
  assert.deepEqual(
    JSON.parse(JSON.stringify(storageWrites[0].businessDefenseManualInputsV1)),
    {
      xhs_kolSpend: '1200',
      xhs_dmpVisitors: '3600',
      xhs_l12Penetration: '30%',
      xhs_l45Penetration: '30%',
      xhs_unreportedNoteCount: '2',
      xhs_storeGmv: {
        value: '8800',
        manualOverride: true,
        updatedAt: '2030-01-02T03:04:05.000Z',
        accountKeys: ['fictional-pgy-account'],
        dateRange: { from: '2030-01-01', to: '2030-01-31', timezone: 'Asia/Shanghai' },
      },
    }
  );

  send('setProjectDirectory', {
    directory: {
      schema: 1,
      storeGroups: [{ id: 'group-1', name: '默认组', unknown: 'drop' }],
      stores: [{
        id: 'store-1',
        name: '家具店',
        groupId: 'group-1',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-24T00:00:00.000Z',
        classification: {
          schema: 1,
          profileId: 'home-furnishing-v1',
          customIndustry: '家'.repeat(150),
          ownBrandTerms: Array.from({ length: 205 }, (_, index) => ` 品牌 ${index} `),
          ownProductTerms: ['护腰床垫', '护腰床垫'],
          competitorTerms: ['慕思'],
          manualOverrides: [{
            id: 'override-1',
            scopeKey: 'store-1',
            keyword: '顾家床垫值得买吗',
            active: false,
            reason: '运营人工确认',
            commercialCategory: 'own_brand',
            topicTagIds: ['core_category', 'safety_adverse_effect'],
            secondaryIntents: ['problem_solving', 'purchase_decision'],
            relevance: 'strong',
            password: 'must-drop',
          }, {
            id: 'override-clear-topic',
            keyword: '清空旧主题',
            patch: {
              topicTagIds: [],
              relevance: 'review',
            },
          }],
          revision: 3,
          updatedAt: 1788048000000,
          token: 'must-drop',
          unknown: 'must-drop',
        },
        cookies: 'must-drop',
      }],
      updatedAt: 1788048000000,
      password: 'must-drop',
    },
  }, 'set-classification-directory');
  await settle();
  const classificationDirectory = storageState.taobaoProjectDirectoryV1;
  assert.ok(classificationDirectory, '桥接层应保存项目目录');
  assert.equal(classificationDirectory.stores[0].classification.customIndustry.length, 120);
  assert.equal(classificationDirectory.stores[0].classification.ownBrandTerms.length, 200);
  assert.deepEqual(
    JSON.parse(JSON.stringify(classificationDirectory.stores[0].classification)),
    {
      schema: 1,
      profileId: 'home-furnishing-v1',
      customIndustry: '家'.repeat(120),
      ownBrandTerms: Array.from({ length: 200 }, (_, index) => `品牌 ${index}`),
      ownProductTerms: ['护腰床垫'],
      competitorTerms: ['慕思'],
      manualOverrides: [{
        id: 'override-1',
        scopeKey: 'store-1',
        keyword: '顾家床垫值得买吗',
        active: false,
        reason: '运营人工确认',
        patch: {
          entityRelation: 'own_brand',
          topicTagIds: ['safety_adverse_effect'],
          intentIds: ['purchase_decision'],
          primaryIntentId: 'purchase_decision',
          relevance: 'strong',
        },
        updatedAt: 0,
      }, {
        id: 'override-clear-topic',
        scopeKey: '',
        keyword: '清空旧主题',
        active: true,
        reason: '',
        patch: {
          topicTagIds: [],
          relevance: 'review',
        },
        updatedAt: 0,
      }],
      revision: 3,
      updatedAt: 1788048000000,
    },
  );

  const classificationCurrentSnapshot = {
    schema: 'xhsAnalysisSnapshotV1',
    schemaVersion: 1,
    runId: 'analysis-classification-1',
    storeId: 'store-1',
    oldTopLevel: { keep: true },
    pgy: {
      coverage: 'complete',
      facts: [{ keyword: '护腰床垫', notes: 9 }],
      oldPgyField: { keep: true },
    },
  };
  const classificationHistoryRunId = 'store-run-classification-history-1';
  const classificationWrongAnalysisRunId = 'store-run-classification-wrong-analysis';
  const classificationOtherStoreRunId = 'store-run-classification-other-store';
  const classificationHistoryRun = {
    schema: 2,
    runId: classificationHistoryRunId,
    account: { storeId: 'store-1', storeName: '家具店' },
    snapshots: {
      xhsAnalysisSnapshotV1: JSON.parse(JSON.stringify(classificationCurrentSnapshot)),
      otherSnapshot: { keep: true },
    },
    oldRunField: { keep: true },
    updatedAt: 100,
  };
  const classificationWrongAnalysisRun = {
    schema: 2,
    runId: classificationWrongAnalysisRunId,
    account: { storeId: 'store-1', storeName: '家具店' },
    snapshots: {
      xhsAnalysisSnapshotV1: Object.assign({}, classificationCurrentSnapshot, {
        runId: 'analysis-classification-other',
      }),
    },
    updatedAt: 200,
  };
  const classificationOtherStoreRun = {
    schema: 2,
    runId: classificationOtherStoreRunId,
    account: { storeId: 'store-2', storeName: '其他店' },
    snapshots: {
      xhsAnalysisSnapshotV1: Object.assign({}, classificationCurrentSnapshot, {
        storeId: 'store-2',
      }),
    },
    updatedAt: 300,
  };
  const classificationRunIndex = [
    { runId: classificationHistoryRunId, storeId: 'store-1', updatedAt: 100, keep: true },
    { runId: classificationWrongAnalysisRunId, storeId: 'store-1', updatedAt: 200, keep: true },
    { runId: classificationOtherStoreRunId, storeId: 'store-2', updatedAt: 300, keep: true },
  ];
  Object.assign(storageState, {
    xhsAnalysisSnapshotV1: classificationCurrentSnapshot,
    taobaoStoreRunIndexV1: classificationRunIndex,
    [`taobaoStoreRunV1:${classificationHistoryRunId}`]: classificationHistoryRun,
    [`taobaoStoreRunV1:${classificationWrongAnalysisRunId}`]: classificationWrongAnalysisRun,
    [`taobaoStoreRunV1:${classificationOtherStoreRunId}`]: classificationOtherStoreRun,
  });
  const maliciousClassificationArchive = {
    schema: 'xhsSearchClassificationArchiveV1',
    schemaVersion: 1,
    status: 'partial',
    configRevision: 'furniture-r3',
    profileId: 'home-furnishing-v1',
    generatedAt: '2026-08-30T01:02:03.000Z',
    engine: {
      rulesetVersion: 'hybrid-rules-v1',
      taxonomyVersion: 'search-taxonomy-v2',
      provider: 'qwen',
      model: 'qwen3.7-plus-2026-05-26',
      promptVersion: 'hybrid-v1',
      apiKey: 'TOP-SECRET-ARCHIVE',
      rawPrompt: 'TOP-SECRET-PROMPT',
    },
    entries: [{
      cacheKey: 'xhs-search-classification-v2:0123456789abcdef',
      normalizedKeyword: '护腰床垫有副作用吗',
      scopeKey: 'store-1',
      automatic: {
        schema: 'xhsSearchClassificationV2',
        schemaVersion: 2,
        entity: {
          relation: 'generic_category',
          label: '伪造实体标签',
          matchedTerm: '护腰床垫',
          source: 'fact',
          lockedByFact: true,
          token: 'TOP-SECRET-ENTITY',
        },
        topicTags: [
          { id: 'core_category', label: '伪造主题', evidence: ['床垫'], source: 'rule' },
          { id: 'safety_adverse_effect', evidence: ['副作用'], source: 'qwen' },
        ],
        intents: [
          { id: 'problem_solving', isPrimary: true, evidence: ['副作用'], source: 'qwen' },
          { id: 'purchase_decision', isPrimary: false, evidence: ['值得买'], source: 'rule' },
        ],
        relevance: { id: 'strong', label: '伪造相关度', source: 'hybrid' },
        source: 'hybrid',
        confidenceScore: 0.83,
        needsReview: false,
        reasonCodes: ['RULE_MATCH', 'INVALID CODE', 'QWEN:CLASSIFIED'],
        rawModelResponse: 'TOP-SECRET-MODEL-OUTPUT',
      },
      effective: {
        schema: 'xhsSearchClassificationV2',
        schemaVersion: 2,
        entity: {
          relation: 'own_brand',
          matchedTerm: '顾家',
          source: 'override',
          lockedByFact: false,
        },
        topicTags: [
          { id: 'usage_scenario', evidence: ['卧室'], source: 'override' },
          { id: 'need_pain_point', evidence: ['护腰'], source: 'fact' },
        ],
        intents: [
          { id: 'usage', isPrimary: true, evidence: ['怎么用'], source: 'override' },
          { id: 'comparison', isPrimary: false, evidence: ['对比'], source: 'qwen' },
        ],
        relevance: { id: 'strong', source: 'override' },
        source: 'override',
        confidenceScore: 1,
        needsReview: false,
        reasonCodes: ['MANUAL_OVERRIDE'],
        messages: [{ role: 'system', content: 'TOP-SECRET-SYSTEM-PROMPT' }],
      },
      appliedOverrideId: 'manual-1',
      authorization: 'Bearer TOP-SECRET-TOKEN',
    }, {
      cacheKey: 'cache-invalid-score',
      normalizedKeyword: '应被丢弃',
      scopeKey: 'store-1',
      automatic: {
        schema: 'xhsSearchClassificationV2', schemaVersion: 2,
        confidenceScore: 99,
      },
      effective: {
        schema: 'xhsSearchClassificationV2', schemaVersion: 2,
        confidenceScore: 99,
      },
    }],
    apiKey: 'TOP-SECRET-TOP-LEVEL',
    rawModelResponse: 'TOP-SECRET-RAW-RESPONSE',
  };
  const classificationHistoryBefore = JSON.parse(JSON.stringify(classificationHistoryRun));
  const wrongAnalysisBefore = JSON.parse(JSON.stringify(classificationWrongAnalysisRun));
  const otherStoreBefore = JSON.parse(JSON.stringify(classificationOtherStoreRun));
  send('patchXhsSearchClassification', {
    storeId: 'store-1',
    analysisRunId: 'analysis-classification-1',
    archive: maliciousClassificationArchive,
  }, 'patch-search-classification-scan');
  await settle();
  const classificationPatchResponse = posted.find((message) => (
    message.requestId === 'patch-search-classification-scan'
  ));
  assert.equal(classificationPatchResponse && classificationPatchResponse.ok, true);
  assert.equal(classificationPatchResponse.data.currentUpdated, true);
  assert.deepEqual(
    Array.from(classificationPatchResponse.data.historyRunIds),
    [classificationHistoryRunId],
  );
  const savedClassification = storageState.xhsAnalysisSnapshotV1.pgy.searchClassification;
  assert.equal(savedClassification.schema, 'xhsSearchClassificationArchiveV1');
  assert.equal(savedClassification.entries.length, 1, '非法分类项应逐项丢弃');
  assert.deepEqual(
    Array.from(savedClassification.entries[0].automatic.topicTags, (item) => item.id),
    ['safety_adverse_effect'],
  );
  assert.deepEqual(
    Array.from(savedClassification.entries[0].automatic.intents, (item) => item.id),
    ['purchase_decision'],
  );
  assert.equal(savedClassification.entries[0].automatic.intents[0].isPrimary, true);
  assert.deepEqual(
    Array.from(savedClassification.entries[0].effective.topicTags, (item) => item.id),
    ['need_pain_point'],
  );
  assert.deepEqual(
    Array.from(savedClassification.entries[0].effective.intents, (item) => item.id),
    ['comparison'],
  );
  assert.equal(savedClassification.entries[0].effective.intents[0].isPrimary, true);
  assert.equal(savedClassification.entries[0].effective.entity.label, '自有品牌');
  assert.equal(savedClassification.entries[0].automatic.relevance.label, '强相关');
  assert.deepEqual(Array.from(savedClassification.entries[0].automatic.reasonCodes), [
    'RULE_MATCH', 'QWEN:CLASSIFIED',
  ]);
  assert.equal(storageState.xhsAnalysisSnapshotV1.oldTopLevel.keep, true);
  assert.equal(storageState.xhsAnalysisSnapshotV1.pgy.oldPgyField.keep, true);
  const savedHistoryRun = storageState[`taobaoStoreRunV1:${classificationHistoryRunId}`];
  assert.deepEqual(
    JSON.parse(JSON.stringify(savedHistoryRun.snapshots.xhsAnalysisSnapshotV1.pgy.searchClassification)),
    JSON.parse(JSON.stringify(savedClassification)),
  );
  assert.equal(savedHistoryRun.oldRunField.keep, true);
  assert.equal(savedHistoryRun.snapshots.otherSnapshot.keep, true);
  assert.ok(savedHistoryRun.updatedAt > classificationHistoryBefore.updatedAt);
  assert.deepEqual(
    JSON.parse(JSON.stringify(storageState[`taobaoStoreRunV1:${classificationWrongAnalysisRunId}`])),
    wrongAnalysisBefore,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(storageState[`taobaoStoreRunV1:${classificationOtherStoreRunId}`])),
    otherStoreBefore,
  );
  const savedClassificationIndex = storageState.taobaoStoreRunIndexV1;
  assert.equal(savedClassificationIndex[0].keep, true);
  assert.ok(savedClassificationIndex[0].updatedAt > classificationRunIndex[0].updatedAt);
  assert.deepEqual(
    JSON.parse(JSON.stringify(savedClassificationIndex.slice(1))),
    JSON.parse(JSON.stringify(classificationRunIndex.slice(1))),
  );
  const savedClassificationText = JSON.stringify(savedClassification);
  assert.equal(savedClassificationText.includes('TOP-SECRET'), false);
  assert.equal(savedClassificationText.includes('rawModelResponse'), false);
  assert.equal(savedClassificationText.includes('messages'), false);
  assert.equal(savedClassificationText.includes('apiKey'), false);

  const savedGeneratedAt = savedClassification.generatedAt;
  send('patchXhsSearchClassification', {
    runId: classificationWrongAnalysisRunId,
    storeId: 'store-1',
    analysisRunId: 'analysis-classification-1',
    archive: Object.assign({}, maliciousClassificationArchive, {
      generatedAt: '2026-08-30T02:03:04.000Z',
    }),
  }, 'patch-search-classification-exact-mismatch');
  await settle();
  const exactMismatchResponse = posted.find((message) => (
    message.requestId === 'patch-search-classification-exact-mismatch'
  ));
  assert.equal(exactMismatchResponse && exactMismatchResponse.ok, false);
  assert.match(exactMismatchResponse.message, /不匹配|未找到/);
  assert.equal(
    storageState.xhsAnalysisSnapshotV1.pgy.searchClassification.generatedAt,
    savedGeneratedAt,
    '精确 run 不匹配时不应部分写入当前快照',
  );

  storageState.xhsAnalysisSnapshotV1 = Object.assign({}, classificationCurrentSnapshot, {
    storeId: 'store-current-other',
  });
  send('patchXhsSearchClassification', {
    runId: classificationHistoryRunId,
    storeId: 'store-1',
    analysisRunId: 'analysis-classification-1',
    archive: Object.assign({}, maliciousClassificationArchive, {
      generatedAt: '2026-08-30T03:04:05.000Z',
    }),
  }, 'patch-search-classification-exact-match');
  await settle();
  const exactMatchResponse = posted.find((message) => (
    message.requestId === 'patch-search-classification-exact-match'
  ));
  assert.equal(exactMatchResponse && exactMatchResponse.ok, true);
  assert.equal(exactMatchResponse.data.currentUpdated, false);
  assert.deepEqual(Array.from(exactMatchResponse.data.historyRunIds), [classificationHistoryRunId]);
  assert.equal(storageState.xhsAnalysisSnapshotV1.pgy.searchClassification, undefined);
  assert.equal(
    storageState[`taobaoStoreRunV1:${classificationHistoryRunId}`]
      .snapshots.xhsAnalysisSnapshotV1.pgy.searchClassification.generatedAt,
    '2026-08-30T03:04:05.000Z',
  );

  delete storageState.xhsAnalysisSnapshotV1;
  delete storageState.taobaoStoreRunIndexV1;
  delete storageState[`taobaoStoreRunV1:${classificationHistoryRunId}`];
  delete storageState[`taobaoStoreRunV1:${classificationWrongAnalysisRunId}`];
  delete storageState[`taobaoStoreRunV1:${classificationOtherStoreRunId}`];

  send('patchStoreRunManualInput', {
    runId: 'store-run-history-1',
    key: 'xhs_contentAudienceAsset',
    value: '8800',
  }, 'write-run');
  await settle();
  const runWrite = storageWrites.find((value) => value['taobaoStoreRunV1:store-run-history-1']);
  assert.ok(runWrite);
  assert.deepEqual(
    Object.assign({}, runWrite.businessDefenseManualInputsV1),
    { xhs_contentAudienceAsset: '8800' }
  );

  send('patchStoreRunManualInput', {
    runId: 'store-run-history-1',
    key: 'xhs_dmpVisitors',
    value: '3600',
  }, 'write-run-second');
  await settle();
  const mergedRunWrite = storageWrites.at(-1);
  assert.deepEqual(
    Object.assign({}, mergedRunWrite['taobaoStoreRunV1:store-run-history-1'].snapshots.businessDefenseManualInputsV1),
    { xhs_contentAudienceAsset: '8800', xhs_dmpVisitors: '3600' }
  );

  send('patchStoreRunManualInput', {
    runId: 'store-run-history-1',
    key: 'xhs_dmpVisitors',
    value: '30%',
  }, 'write-run-invalid');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'write-run-invalid' && message.ok === false && /百分号/.test(message.message)
  )));
  assert.deepEqual(
    Object.assign({}, runWrite['taobaoStoreRunV1:store-run-history-1'].snapshots.businessDefenseManualInputsV1),
    { xhs_contentAudienceAsset: '8800' }
  );

  send('clearStorage', {
    keys: ['businessDefenseAutoCollectStatusV1', 'privateUnexpectedKey'],
  }, 'clear');
  await settle();
  assert.deepEqual(Array.from(storageRemovals[0]), ['businessDefenseAutoCollectStatusV1']);

  const runtimeCountBeforeRetiredActions = runtimeMessages.length;
  send('startAutoCollect', { message: { type: 'UNSAFE_COMMAND' } }, 'start');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'start' && message.ok === false && /不在允许范围/.test(message.message)
  )));
  assert.equal(runtimeMessages.some((message) => message.type === 'BUSINESS_DEFENSE_AUTO_COLLECT'), false);

  send('startContentDiagnosisReport', { message: { type: 'UNSAFE_COMMAND' } }, 'report');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'report' && message.ok === false && /不在允许范围/.test(message.message)
  )));
  assert.equal(runtimeMessages.some((message) => message.type === 'BUSINESS_DEFENSE_GENERATE_CONTENT_REPORT'), false);
  assert.equal(runtimeMessages.length, runtimeCountBeforeRetiredActions);

  send('startProjectTask', {
    taskType: 'report',
    store: { id: 'store-1', name: '一号店' },
  }, 'project-task-wrong-page');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeRetiredActions);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-task-wrong-page' && message.ok === false && /一键取数/.test(message.message)
  )));

  context.location.pathname = '/report.html';
  send('startProjectTask', {
    taskType: 'collect',
    credentialMode: 'vault',
    platforms: ['sycm', 'wxt'],
    store: { id: 'store-1', name: '一号店', groupId: 'group-1', groupName: '第一组' },
  }, 'project-task');
  await settle();
  const projectTaskMessage = runtimeMessages.find((message) => message.type === 'PROJECT_TASK_START');
  assert.equal(projectTaskMessage.payload.taskType, 'report');
  assert.deepEqual(Array.from(projectTaskMessage.payload.platforms), ['sycm', 'wxt']);
  assert.equal(projectTaskMessage.payload.credentialMode, 'vault');
  assert.equal(projectTaskMessage.payload.vaultScopeId, 'local:tbcontentdata');
  assert.equal(projectTaskMessage.payload.store.id, 'store-1');
  assert.ok(posted.some((message) => message.requestId === 'project-task' && message.ok === true));

  send('startProjectTask', {
    taskType: 'report',
    credentialMode: 'currentSession',
    platforms: ['juguang'],
    concurrentAccountTabs: 3,
    dateRange: { from: '2026-08-01', to: '2026-08-25' },
    store: { id: 'store-1', name: '一号店' },
  }, 'project-task-juguang-parallel');
  await settle();
  const concurrentJuguangTaskMessage = runtimeMessages.filter((message) => (
    message.type === 'PROJECT_TASK_START'
  )).at(-1);
  assert.equal(concurrentJuguangTaskMessage.payload.concurrentAccountTabs, 3,
    '聚光并发标签页设置应通过页面桥接层');

  send('startProjectTask', {
    taskType: 'report',
    credentialMode: 'currentSession',
    platforms: ['juguang'],
    concurrentAccountTabs: 4,
    dateRange: { from: '2026-08-01', to: '2026-08-25' },
    store: { id: 'store-1', name: '一号店' },
  }, 'project-task-juguang-invalid-parallel');
  await settle();
  const invalidConcurrentJuguangTaskMessage = runtimeMessages.filter((message) => (
    message.type === 'PROJECT_TASK_START'
  )).at(-1);
  assert.equal(invalidConcurrentJuguangTaskMessage.payload.concurrentAccountTabs, undefined,
    '聚光只允许显式启用 2 或 3 个并发标签页');

  const runtimeCountBeforeInvalidCredentialMode = runtimeMessages.length;
  send('startProjectTask', {
    taskType: 'report',
    credentialMode: 'legacy-default',
    platforms: ['sycm'],
    store: { id: 'store-1', name: '一号店' },
  }, 'project-task-invalid-credential-mode');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeInvalidCredentialMode);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-task-invalid-credential-mode' &&
      message.ok === false && /登录方式/.test(message.message)
  )));

  send('startProjectTask', {
    taskType: 'report',
    credentialMode: 'currentSession',
    platforms: ['sycm'],
    store: { id: 'store-1', name: '一号店' },
  }, 'project-task-current-session');
  await settle();
  const currentSessionTaskMessage = runtimeMessages.filter((message) => (
    message.type === 'PROJECT_TASK_START'
  )).at(-1);
  assert.equal(currentSessionTaskMessage.payload.credentialMode, 'currentSession');
  assert.equal(currentSessionTaskMessage.payload.vaultScopeId, undefined,
    '复用当前登录态不应依赖账号库工作区');

  context.location.pathname = '/accounts.html';
  const runtimeCountBeforeWrongPageCancel = runtimeMessages.length;
  send('cancelProjectTask', { taskId: 'project-task-safe-1' }, 'project-cancel-wrong-page');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeWrongPageCancel);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-cancel-wrong-page' && message.ok === false && /\u4e00\u952e\u53d6\u6570/.test(message.message)
  )));

  context.location.pathname = '/report.html';
  context.document.visibilityState = 'hidden';
  send('cancelProjectTask', { taskId: 'project-task-safe-1' }, 'project-cancel-hidden-page');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeWrongPageCancel);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-cancel-hidden-page' && message.ok === false && /\u53ef\u89c1/.test(message.message)
  )));
  context.document.visibilityState = 'visible';

  confirmResult = false;
  send('cancelProjectTask', {
    taskId: 'project-task-safe-1',
    confirmed: true,
    confirmedByExtension: true,
  }, 'project-cancel-forged-confirmation');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeWrongPageCancel);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-cancel-forged-confirmation' && message.ok === true &&
      message.data && message.data.cancelled === false
  )));

  confirmResult = true;
  send('cancelProjectTask', {
    taskId: 'project-task-safe-1',
    confirmed: false,
    confirmedByExtension: false,
  }, 'project-cancel-confirmed');
  await settle();
  const projectCancelMessage = runtimeMessages.find((message) => message.type === 'PROJECT_TASK_CANCEL');
  assert.deepEqual(JSON.parse(JSON.stringify(projectCancelMessage)), {
    type: 'PROJECT_TASK_CANCEL',
    source: 'business-defense-web-tool',
    taskId: 'project-task-safe-1',
    confirmedByExtension: true,
  });
  assert.ok(posted.some((message) => (
    message.requestId === 'project-cancel-confirmed' && message.ok === true
  )));

  const runtimeCountBeforeInvalidTaskCancel = runtimeMessages.length;
  send('cancelProjectTask', { taskId: '../unsafe-task' }, 'project-cancel-invalid-task');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeInvalidTaskCancel);
  assert.ok(posted.some((message) => (
    message.requestId === 'project-cancel-invalid-task' && message.ok === false && /\u4efb\u52a1\u7f16\u53f7/.test(message.message)
  )));

  context.location.pathname = '/accounts.html';
  const vaultKey = 'taobaoAccountVaultV1';
  const vaultScopeKey = 'taobaoAccountVaultScopeV1';
  const vaultLockEpochKey = 'taobaoAccountVaultLockEpochV1';
  const legacyVaultKey = 'taobaoAccountVaultLegacyV1';
  const scopedVaultKey = (scopeId) => 'taobaoAccountVaultScopedV1:' + encodeURIComponent(scopeId);
  const localScopedVaultKey = scopedVaultKey('local:tbcontentdata');
  const teamScopedVaultKey = scopedVaultKey('team:https://tbdata.aizicheng.com');
  const scopedVault = (key) => storageState[key] && storageState[key].vault;
  const localQuarantineKey = 'taobaoAccountVaultQuarantineV1:' + encodeURIComponent('local:tbcontentdata');
  const teamQuarantineKey = 'taobaoAccountVaultQuarantineV1:' +
    encodeURIComponent('team:https://tbdata.aizicheng.com');
  const encryptedRecord = (data, updatedAt) => ({
    schema: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt: 'QUJDRA==' },
    cipher: { name: 'AES-GCM', iv: 'RUZHSA==', data },
    updatedAt,
  });
  const legacyVault = encryptedRecord('TEVHQUNZ', 1893456000000);
  delete storageState[vaultScopeKey];
  storageState[vaultKey] = legacyVault;
  send('bindAccountVaultScope', { vaultScopeId: 'team:forged-by-page' }, 'bind-local-scope');
  await settle();
  const localBinding = posted.find((message) => message.requestId === 'bind-local-scope');
  assert.equal(localBinding.ok, true);
  assert.equal(localBinding.data.vaultScopeId, 'local:tbcontentdata');
  assert.equal(storageState[vaultScopeKey], 'local:tbcontentdata');
  assert.equal(storageState[vaultKey], undefined, '旧共享 active key 必须完成迁移后删除');
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, legacyVault.cipher.data);
  assert.equal(storageState[legacyVaultKey] && storageState[legacyVaultKey].cipher, undefined,
    '可信本地开发 scope 应直接认领旧本地密文，不创建无主隔离副本');

  const localVault = encryptedRecord('TE9DQUw=', 1893456001000);
  send('setAccountVault', {
    vault: localVault,
    vaultScopeId: 'team:forged-by-page',
    vaultLockEpoch: localBinding.data.vaultLockEpoch,
  }, 'set-local-vault');
  await settle();
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, localVault.cipher.data);
  const lockCountBeforeSameScope = runtimeMessages.filter((message) => (
    message.type === 'ACCOUNT_SESSION_LOCK'
  )).length;
  send('bindAccountVaultScope', {}, 'bind-local-scope-again');
  await settle();
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, localVault.cipher.data,
    '同团队/同 scope 重新绑定不得挪走密文');
  assert.equal(runtimeMessages.filter((message) => message.type === 'ACCOUNT_SESSION_LOCK').length,
    lockCountBeforeSameScope);

  send('lockAccountVault', {}, 'lock-team-vault');
  await settle();
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, localVault.cipher.data,
    '退出只清明文会话，团队密文必须保留');
  assert.ok(runtimeMessages.some((message) => message.type === 'ACCOUNT_SESSION_LOCK'));

  context.location.origin = 'https://tbdata.aizicheng.com';
  send('bindAccountVaultScope', { vaultScopeId: 'local:forged' }, 'bind-team-scope');
  await settle();
  assert.equal(storageState[vaultScopeKey], 'team:https://tbdata.aizicheng.com');
  assert.equal(storageState[vaultKey], undefined);
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, localVault.cipher.data,
    '生产团队站与本地开发 scope 必须以独立键隔离');
  send('getStorage', { keys: [vaultKey] }, 'read-team-before-vault');
  await settle();
  const emptyTeamRead = posted.find((message) => message.requestId === 'read-team-before-vault');
  assert.equal(emptyTeamRead.data[vaultKey], undefined,
    '生产页不得在任何 sidecar 交错下读到本地 scope 密文');
  const teamVault = encryptedRecord('VEVBTQ==', 1893456002000);
  send('setAccountVault', {
    vault: teamVault,
    vaultLockEpoch: storageState[vaultLockEpochKey],
  }, 'set-team-vault');
  await settle();
  assert.equal(scopedVault(teamScopedVaultKey).cipher.data, teamVault.cipher.data);
  context.location.origin = 'http://127.0.0.1:3400';
  send('bindAccountVaultScope', {}, 'restore-local-scope');
  await settle();
  assert.equal(storageState[vaultScopeKey], 'local:tbcontentdata');
  assert.equal(scopedVault(localScopedVaultKey).cipher.data, localVault.cipher.data,
    '切回原 scope 应恢复其隔离密文');
  assert.equal(scopedVault(teamScopedVaultKey).cipher.data, teamVault.cipher.data);

  // Simulate a stale team tab writing after the local tab has rebound. Its
  // scope-specific write may succeed, but the local logical read can only map
  // the local envelope and must never expose/upload the team record.
  context.location.origin = 'https://tbdata.aizicheng.com';
  storageState[vaultScopeKey] = 'team:https://tbdata.aizicheng.com';
  send('setAccountVault', {
    vault: encryptedRecord('VEVBTS1TVEFMRQ==', 1893456003000),
    vaultLockEpoch: storageState[vaultLockEpochKey],
  }, 'stale-team-write');
  await settle();
  context.location.origin = 'http://127.0.0.1:3400';
  send('getStorage', { keys: [vaultKey] }, 'read-local-after-stale-team-write');
  await settle();
  const isolatedRead = posted.find((message) => message.requestId === 'read-local-after-stale-team-write');
  assert.equal(isolatedRead.data[vaultKey].cipher.data, localVault.cipher.data,
    '跨 tab 交错保存不得串库');
  send('bindAccountVaultScope', {}, 'rebind-local-after-race');
  await settle();

  const bridgeUsernameSentinel = 'BRIDGE-USERNAME-SENTINEL';
  const bridgePasswordSentinel = 'BRIDGE-PASSWORD-SENTINEL';
  const masterPasswordSentinel = 'BRIDGE-MASTER-PASSWORD-SENTINEL';
  const vaultSessionKey = 'A'.repeat(43) + '=';
  send('setAccountSession', {
    vaultLockEpoch: storageState[vaultLockEpochKey],
    vaultSessionKey,
    masterPassword: masterPasswordSentinel,
    vault: {
      schema: 4,
      accountGroups: [],
      storeGroups: [{ id: 'group-1', name: '第一组', unexpected: 'drop-me' }],
      stores: [
        {
          id: 'store-1', name: '一号店', groupId: 'group-1',
          credentialBindings: { taobaoAccountId: 'account-1', xiaohongshuAccountId: 'account-xhs' },
        },
        {
          id: 'store-2', name: '二号店', groupId: '',
          credentialBindings: { taobaoAccountId: 'invalid-platform', xiaohongshuAccountId: '' },
        },
      ],
      accounts: [
        {
          id: 'account-1', label: '一号店淘宝主账号', platform: 'taobao', storeId: 'store-1',
          username: bridgeUsernameSentinel, password: bridgePasswordSentinel, enabled: true,
          unexpected: 'drop-me',
        },
        {
          id: 'account-xhs', label: '一号店小红书账号', platform: 'xiaohongshu', storeId: 'store-1',
          username: 'xhs-private-user', password: 'xhs-private-password', enabled: true,
        },
        {
          id: 'invalid-platform', label: '非法平台账号', platform: 'Taobao', storeId: 'store-2',
          username: 'invalid-user', password: 'invalid-password', enabled: true,
        },
        {
          id: 'missing-platform', label: '缺失平台账号', storeId: 'store-2',
          username: 'missing-user', password: 'missing-password', enabled: true,
        },
      ],
      notification: {},
      unexpected: 'drop-me',
    },
  }, 'session-set');
  await settle();
  const sessionSetMessage = runtimeMessages.find((message) => message.type === 'ACCOUNT_SESSION_SET');
  assert.ok(sessionSetMessage, JSON.stringify(posted.find((message) => message.requestId === 'session-set')));
  assert.equal(sessionSetMessage.vaultScopeId, 'local:tbcontentdata');
  assert.equal(sessionSetMessage.vault.schema, 4);
  assert.equal(sessionSetMessage.vault.accounts[0].username, bridgeUsernameSentinel);
  assert.equal(sessionSetMessage.vault.accounts[0].password, bridgePasswordSentinel);
  assert.equal(sessionSetMessage.vault.accounts[0].label, '一号店淘宝主账号');
  assert.doesNotMatch(sessionSetMessage.vault.accounts[0].label, /BRIDGE-(?:USERNAME|PASSWORD)-SENTINEL/);
  assert.deepEqual(Array.from(sessionSetMessage.vault.accounts, (account) => account.id), [
    'account-1', 'account-xhs',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(sessionSetMessage.vault.stores[0].credentialBindings)), {
    taobaoAccountId: 'account-1',
    xiaohongshuAccountId: 'account-xhs',
  });
  assert.equal(sessionSetMessage.vault.stores[1].credentialBindings.taobaoAccountId, '');
  assert.equal(sessionSetMessage.vault.accounts[0].unexpected, undefined);
  assert.equal(sessionSetMessage.vault.unexpected, undefined);
  assert.equal(sessionSetMessage.vaultSessionKey, vaultSessionKey);
  assert.match(sessionSetMessage.vaultFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(sessionSetMessage.masterPassword, undefined);
  assert.doesNotMatch(JSON.stringify(sessionSetMessage), /BRIDGE-MASTER-PASSWORD-SENTINEL/);

  context.location.pathname = '/report.html';
  const runtimeCountBeforeWrongPageSessionSet = runtimeMessages.length;
  send('setAccountSession', {
    vault: {
      schema: 4,
      stores: [{
        id: 'store-1', name: '一号店',
        credentialBindings: { taobaoAccountId: '', xiaohongshuAccountId: '' },
      }],
      accounts: [],
    },
  }, 'session-set-wrong-page');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeWrongPageSessionSet);
  assert.ok(posted.some((message) => (
    message.requestId === 'session-set-wrong-page' && message.ok === false && /账号库管理/.test(message.message)
  )));

  context.location.pathname = '/accounts.html';

  send('getAccountSessionSummary', {}, 'session-summary');
  await settle();
  assert.ok(runtimeMessages.some((message) => message.type === 'ACCOUNT_SESSION_GET_SUMMARY'));
  const runtimeCountBeforeManagementRecovery = runtimeMessages.length;
  send('getAccountManagementSession', {}, 'session-management');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeManagementRecovery + 1);
  assert.equal(runtimeMessages.at(-1).type, 'ACCOUNT_SESSION_GET_MANAGEMENT');
  const managementResponse = posted.find((message) => message.requestId === 'session-management');
  assert.equal(managementResponse.ok, true);
  assert.equal(managementResponse.data.unlocked, true);
  assert.equal(managementResponse.data.vault.accounts[0].password, bridgePasswordSentinel);
  assert.equal(JSON.stringify(managementResponse).includes(vaultSessionKey), false,
    '会话加密密钥只能留在扩展隔离环境，不得回传网页上下文');

  send('encryptAccountVaultFromSession', {
    vaultLockEpoch: storageState[vaultLockEpochKey],
    vault: sessionSetMessage.vault,
  }, 'session-encrypt');
  await settle();
  const encryptedSessionResponse = posted.find((message) => message.requestId === 'session-encrypt');
  assert.equal(encryptedSessionResponse.ok, true);
  assert.equal(encryptedSessionResponse.data.vault.schema, 1);
  assert.notEqual(
    encryptedSessionResponse.data.vault.cipher.data,
    scopedVault(localScopedVaultKey).cipher.data,
  );
  assert.equal(JSON.stringify(encryptedSessionResponse).includes(vaultSessionKey), false);
  assert.doesNotMatch(
    JSON.stringify(encryptedSessionResponse),
    /BRIDGE-(?:USERNAME|PASSWORD)-SENTINEL/,
  );

  context.location.pathname = '/report.html';
  const runtimeCountBeforeWrongPageManagementRecovery = runtimeMessages.length;
  send('getAccountManagementSession', {}, 'session-management-wrong-page');
  await settle();
  assert.equal(runtimeMessages.length, runtimeCountBeforeWrongPageManagementRecovery);
  assert.ok(posted.some((message) => (
    message.requestId === 'session-management-wrong-page' && message.ok === false &&
      /账号库管理/.test(message.message)
  )));
  send('startAccountBatchFromSession', {
    taskType: 'report',
    selection: {
      type: 'storeGroup', id: 'group-1', name: 'untrusted-name',
      accountIds: ['account-2', 'account-1', 'account-2', '', null],
    },
    accounts: [{ username: 'must-not-pass' }],
  }, 'session-start');
  await settle();
  const sessionStartMessage = runtimeMessages.find((message) => message.type === 'ACCOUNT_BATCH_START_FROM_SESSION');
  assert.deepEqual(JSON.parse(JSON.stringify(sessionStartMessage.payload.selection)), {
    type: 'storeGroup', id: 'group-1', accountIds: ['account-2', 'account-1'],
  });
  assert.equal(sessionStartMessage.payload.taskType, 'report');
  assert.equal(sessionStartMessage.payload.vaultScopeId, 'local:tbcontentdata');
  assert.equal(sessionStartMessage.payload.accounts, undefined);

  const runtimeCountBeforeInvalidSelections = runtimeMessages.length;
  send('startAccountBatchFromSession', {
    selection: { type: 'storeGroup', id: 'group-1', accountIds: [] },
  }, 'session-start-empty');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'session-start-empty' && message.ok === false && /至少选择一个/.test(message.message)
  )));
  assert.equal(runtimeMessages.length, runtimeCountBeforeInvalidSelections);

  send('startAccountBatchFromSession', {
    selection: {
      type: 'storeGroup', id: 'group-1',
      accountIds: Array.from({ length: 101 }, (_, index) => 'account-' + index),
    },
  }, 'session-start-too-many');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'session-start-too-many' && message.ok === false && /最多选择 100/.test(message.message)
  )));
  assert.equal(runtimeMessages.length, runtimeCountBeforeInvalidSelections);

  const importedAt = Date.now();
  const cloudRun = {
    schema: 2,
    runId: 'store-run-cloud-1',
    batchId: 'batch-cloud',
    taskType: 'both',
    runMode: 'batch',
    account: {
      id: 'account-cloud',
      name: '云端账号',
      platform: 'taobao',
      storeId: 'store-cloud',
      storeName: '云端店铺',
      usernameMasked: 'cl***d',
    },
    startedAt: importedAt - 1000,
    finishedAt: importedAt - 500,
    updatedAt: importedAt,
    xinghe: { state: 'ready', noPermission: false, unexpected: 'drop-me' },
    status: 'success',
    failures: [],
    snapshots: {
      businessDefenseManualInputsV1: { xhs_kolSpend: '1200' },
    },
  };
  const archiveSecretSentinel = 'ARCHIVE-PLAINTEXT-SENTINEL';
  send('importStoreRun', {
    runId: 'store-run-cloud-1',
    run: Object.assign({}, cloudRun, {
      account: Object.assign({}, cloudRun.account, { password: archiveSecretSentinel }),
    }),
  }, 'import-cloud-run-secret');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'import-cloud-run-secret' && message.ok === false && /敏感凭据/.test(message.message)
  )));

  send('importStoreRun', { runId: 'store-run-cloud-1', run: cloudRun }, 'import-cloud-run');
  await settle();
  const importedRun = storageState['taobaoStoreRunV1:store-run-cloud-1'];
  assert.equal(importedRun.runId, 'store-run-cloud-1');
  assert.equal(importedRun.account.storeName, '云端店铺');
  assert.equal(storageState.taobaoStoreRunIndexV1[0].runId, 'store-run-cloud-1');
  assert.doesNotMatch(JSON.stringify({
    run: storageState['taobaoStoreRunV1:store-run-cloud-1'],
    index: storageState.taobaoStoreRunIndexV1,
  }), /ARCHIVE-PLAINTEXT-SENTINEL/);
  assert.ok(posted.some((message) => (
    message.requestId === 'import-cloud-run' && message.ok === true && message.data.imported === true
  )));

  send('importStoreRun', {
    runId: 'store-run-cloud-1',
    run: Object.assign({}, importedRun, {
      updatedAt: importedAt - 1,
      account: Object.assign({}, importedRun.account, { storeName: '过期云端店铺' }),
    }),
  }, 'import-stale-run');
  await settle();
  assert.equal(storageState['taobaoStoreRunV1:store-run-cloud-1'].account.storeName, '云端店铺');
  assert.ok(posted.some((message) => (
    message.requestId === 'import-stale-run' && message.ok === true &&
      message.data.imported === false && message.data.reason === 'local-newer-or-equal'
  )));

  send('importStoreRun', {
    runId: 'bad-run-id',
    run: { runId: 'bad-run-id' },
  }, 'import-invalid-run');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'import-invalid-run' && message.ok === false && /编号无效/.test(message.message)
  )));

  const oversizedRun = Object.assign({}, importedRun, {
    runId: 'store-run-cloud-too-large',
    snapshots: { gh_channel_snapshot: { raw: 'x'.repeat(24 * 1024 * 1024 + 1) } },
  });
  send('importStoreRun', {
    runId: oversizedRun.runId,
    run: oversizedRun,
  }, 'import-oversized-run');
  await settle();
  assert.ok(posted.some((message) => (
    message.requestId === 'import-oversized-run' && message.ok === false && /安全限制/.test(message.message)
  )));

  assert.ok(posted.some((message) => message.requestId === 'start' && message.ok === false));
  assert.ok(posted.some((message) => message.requestId === 'report' && message.ok === false));
  console.log('web tool bridge guards passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

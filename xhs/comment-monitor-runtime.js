(function initXhsCommentMonitorRuntime(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsCommentMonitorRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createApi() {
  'use strict';

  const ALARM_NAME = 'xhs-comment-monitor-daily';
  const CONTINUATION_ALARM_NAME = 'xhs-comment-monitor-continuation';
  const STORAGE_KEYS = Object.freeze({
    profile: 'xhsCommentMonitorProfileV1',
    state: 'xhsCommentMonitorStateV1',
    summary: 'xhsCommentInsightSummaryV1',
    metricSnapshot: 'xhsCommentMetricSnapshotV2',
    noteIndex: 'xhsCommentMonitorNoteIndexV1',
    runIndex: 'xhsCommentMonitorRunIndexV1',
    checkpoints: 'xhsCommentCaptureCheckpointsV1',
  });
  const MESSAGE_TYPES = Object.freeze({
    getState: 'COMMENT_MONITOR_GET_STATE',
    configure: 'COMMENT_MONITOR_CONFIGURE',
    runNow: 'COMMENT_MONITOR_RUN_NOW',
    query: 'COMMENT_MONITOR_QUERY_COMMENTS',
    exportRaw: 'COMMENT_MONITOR_EXPORT_RAW',
  });

  function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function text(value, maximum) {
    return String(value == null ? '' : value).trim().slice(0, maximum || 5000);
  }

  function timestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : Date.now();
  }

  function iso(value) {
    return new Date(timestamp(value)).toISOString();
  }

  function runId(nowValue) {
    return `comment-monitor-${timestamp(nowValue).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function cacheKey(storeId, accountKey, noteId) {
    return `xhs-comment-monitor:${encodeURIComponent(storeId)}:${encodeURIComponent(accountKey)}:${encodeURIComponent(noteId)}`;
  }

  function cacheFingerprint(storeId, accountKey, noteId) {
    return `comment-monitor-v2:${storeId}:${accountKey}:${noteId}`;
  }

  function nextShanghaiSchedule(nowValue, dailyTime) {
    const nowMs = timestamp(nowValue);
    const match = /^(\d{2}):(\d{2})$/.exec(text(dailyTime, 5));
    const hours = match ? Number(match[1]) : 9;
    const minutes = match ? Number(match[2]) : 0;
    const chinaOffset = 8 * 60 * 60 * 1000;
    const china = new Date(nowMs + chinaOffset);
    let target = Date.UTC(
      china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate(), hours, minutes,
    ) - chinaOffset;
    if (target <= nowMs) target += 24 * 60 * 60 * 1000;
    return target;
  }

  function failureStatus(error) {
    const code = text(error && error.code || 'COMMENT_MONITOR_FAILED', 120);
    const combined = `${code} ${text(error && error.message, 1000)}`;
    let status = 'failed';
    if (/LOGIN|IDENTITY|AUTH|401|403/i.test(combined)) status = 'waiting_login';
    else if (/VERIFY|CAPTCHA|验证|验证码/i.test(combined)) status = 'waiting_verification';
    else if (/RATE|LIMIT|429|频繁|限流/i.test(combined)) status = 'paused';
    return status;
  }

  function failureState(error, base, nowValue) {
    const code = text(error && error.code || 'COMMENT_MONITOR_FAILED', 120);
    const status = failureStatus(error);
    return Object.assign({}, base, {
      schema: 'CommentMonitorStateV1', schemaVersion: 1,
      running: false, status, zeroResult: false,
      errorCode: code, error: text(error && error.message || error, 1000),
      updatedAt: iso(nowValue), finishedAt: iso(nowValue),
    });
  }

  function flattenComments(record) {
    const output = [];
    const seen = new Set();
    for (const page of Array.isArray(record && record.pages) ? record.pages : []) {
      for (const comment of Array.isArray(page && page.items) ? page.items : []) {
        const id = text(comment && comment.commentId, 240);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        output.push(comment);
      }
    }
    return output;
  }

  function csvCell(value) {
    const content = String(value == null ? '' : value);
    return /[",\r\n]/.test(content) ? `"${content.replace(/"/g, '""')}"` : content;
  }

  function createCommentMonitorRuntime(options) {
    const settings = object(options);
    const chromeApi = settings.chrome;
    const model = settings.model;
    const cache = settings.cache;
    if (!chromeApi || !chromeApi.storage || !chromeApi.storage.local || !chromeApi.runtime) {
      throw new Error('Comment monitor runtime requires Chrome storage and runtime APIs.');
    }
    if (!model || typeof model.normalizeMonitorProfile !== 'function') {
      throw new Error('Comment monitor data model is required.');
    }
    if (!cache || typeof cache.open !== 'function' || typeof cache.read !== 'function') {
      throw new Error('Comment monitor IndexedDB cache is required.');
    }
    if (typeof settings.collectInventory !== 'function' ||
        typeof settings.collectNoteComments !== 'function') {
      throw new Error('Comment monitor collectors are required.');
    }
    const now = typeof settings.now === 'function' ? settings.now : Date.now;
    let activeRun = null;
    let registered = false;

    async function read(keys) {
      return chromeApi.storage.local.get(keys);
    }

    async function write(patch) {
      await chromeApi.storage.local.set(patch);
    }

    async function currentProfile() {
      const stored = await read([STORAGE_KEYS.profile]);
      return model.normalizeMonitorProfile(stored[STORAGE_KEYS.profile] || {
        enabled: false, dailyTime: '09:00', timezone: 'Asia/Shanghai',
      });
    }

    async function schedule(profileValue) {
      const profile = model.normalizeMonitorProfile(profileValue);
      if (!chromeApi.alarms) return;
      await Promise.resolve(chromeApi.alarms.clear(ALARM_NAME));
      if (!profile.enabled || !profile.storeId) return;
      chromeApi.alarms.create(ALARM_NAME, {
        when: nextShanghaiSchedule(now(), profile.dailyTime),
        periodInMinutes: 24 * 60,
      });
    }

    async function configure(input) {
      const previous = await currentProfile();
      const requested = Object.assign({}, previous, object(input), {
        rawRetention: 'local_only',
        summarySync: 'deidentified',
      });
      const profile = Object.assign(model.normalizeMonitorProfile(requested), {
        rawRetention: 'local_only',
        summarySync: 'deidentified',
      });
      await write({ [STORAGE_KEYS.profile]: profile });
      await schedule(profile);
      return profile;
    }

    async function commentRecord(storeId, accountKey, noteId) {
      return cache.read(cacheKey(storeId, accountKey, noteId));
    }

    async function allComments(storeId, accountKey, noteIds) {
      const output = [];
      for (const noteId of noteIds) {
        output.push(...flattenComments(await commentRecord(storeId, accountKey, noteId)));
      }
      return output;
    }

    async function saveComments(storeId, accountKey, noteId, values, complete) {
      const key = cacheKey(storeId, accountKey, noteId);
      const fingerprint = cacheFingerprint(storeId, accountKey, noteId);
      const record = await cache.open(key, fingerprint);
      const known = new Set(flattenComments(record).map((item) => item.commentId));
      const normalized = [];
      for (const raw of Array.isArray(values) ? values : []) {
        const item = model.normalizeComment(raw, { accountKey, noteId });
        if (!item || known.has(item.commentId)) continue;
        known.add(item.commentId);
        normalized.push(item);
        if (normalized.length >= 500) break;
      }
      if (!normalized.length) return { saved: 0, record };
      const updated = await cache.commitPage(key, fingerprint, {
        page: (Number(record.pageCount) || 0) + 1,
        items: normalized,
        expectedCount: null,
        nextPage: complete ? null : (Number(record.pageCount) || 0) + 2,
      });
      return { saved: normalized.length, record: updated };
    }

    function candidateRemaining(candidate, initial) {
      if (initial) return Math.max(1, Number(candidate.commentCount) || 1);
      if (Number(candidate.commentDelta) > 0) return Number(candidate.commentDelta);
      return 50;
    }

    async function runOnce(input) {
      if (activeRun) return activeRun;
      const operation = (async () => {
        const trigger = text(input && input.trigger || 'manual', 40);
        const startedAt = now();
        const id = runId(startedAt);
        const profile = await currentProfile();
        const priorRuntimeState = object((await read([STORAGE_KEYS.state]))[STORAGE_KEYS.state]);
        const baseState = {
          schema: 'CommentMonitorStateV1', schemaVersion: 1,
          runId: id, accountKey: profile.accountKey,
          storeId: profile.storeId, storeName: profile.storeName,
          trigger, running: true, status: 'running', zeroResult: false,
          startedAt: iso(startedAt), updatedAt: iso(startedAt), error: '', errorCode: '',
          lastSuccessfulAt: text(priorRuntimeState.lastSuccessfulAt, 80),
        };
        await write({ [STORAGE_KEYS.state]: baseState });
        try {
          const inventory = object(await settings.collectInventory({ profile, trigger }));
          const accountKey = text(inventory.accountKey || profile.accountKey, 160) || 'unknown';
          if (accountKey !== profile.accountKey) {
            await configure(Object.assign({}, profile, { accountKey }));
          }
          const rows = (Array.isArray(inventory.rows) ? inventory.rows : []).map((row) => Object.assign({}, row, {
            accountKey,
            platformUpdatedAt: row && row.platformUpdatedAt || inventory.platformUpdatedAt,
          }));
          const capturedAt = inventory.platformUpdatedAt || inventory.capturedAt || iso(now());
          const currentSnapshot = Object.assign(
            model.createMetricSnapshot({ accountKey, capturedAt, rows }),
            { storeId: profile.storeId, storeName: profile.storeName },
          );
          const stored = await read([
            STORAGE_KEYS.metricSnapshot, STORAGE_KEYS.noteIndex, STORAGE_KEYS.runIndex,
            STORAGE_KEYS.checkpoints, STORAGE_KEYS.state,
          ]);
          const previousSnapshot = stored[STORAGE_KEYS.metricSnapshot];
          const storedCheckpointIndex = object(stored[STORAGE_KEYS.checkpoints]);
          const checkpointNotes = storedCheckpointIndex.accountKey === accountKey &&
            storedCheckpointIndex.storeId === profile.storeId
            ? object(storedCheckpointIndex.notes)
            : {};
          const hasPendingCheckpoint = Object.values(checkpointNotes)
            .some((checkpoint) => checkpoint && checkpoint.complete !== true);
          if (previousSnapshot && previousSnapshot.accountKey === accountKey &&
              previousSnapshot.storeId === profile.storeId &&
              previousSnapshot.capturedAt === currentSnapshot.capturedAt && !hasPendingCheckpoint) {
            const unchanged = Object.assign({}, baseState, {
              accountKey, running: false, status: 'completed', skipped: true,
              skipReason: 'platform_not_updated', zeroResult: currentSnapshot.notes.length === 0,
              finishedAt: iso(now()), updatedAt: iso(now()),
            });
            await write({ [STORAGE_KEYS.state]: unchanged });
            return unchanged;
          }

          const initial = !(previousSnapshot && previousSnapshot.accountKey === accountKey &&
            previousSnapshot.storeId === profile.storeId);
          let delta = null;
          let candidates;
          if (initial) {
            candidates = model.selectInitialCandidates(currentSnapshot.notes, {
              asOf: currentSnapshot.capturedAt,
              recentLookbackDays: profile.recentLookbackDays,
              historicalTopRatio: profile.historicalTopRatio,
            });
          } else {
            delta = model.computeSnapshotDelta(previousSnapshot, currentSnapshot);
            const scored = model.scoreNoteHeat(delta.notes, { hotRatio: profile.hotRatio });
            candidates = model.selectRefreshCandidates(scored, {
              asOf: currentSnapshot.capturedAt, hotReviewAfterHours: 24,
            });
            delta = Object.assign({}, delta, { notes: scored });
          }
          const candidateIds = new Set(candidates.map((item) => item.noteId));
          const currentById = new Map(currentSnapshot.notes.map((item) => [item.noteId, item]));
          for (const [noteId, checkpoint] of Object.entries(checkpointNotes)) {
            if (!checkpoint || checkpoint.complete === true || candidateIds.has(noteId)) continue;
            const pendingNote = currentById.get(noteId);
            if (!pendingNote) continue;
            candidates.push(Object.assign({}, pendingNote, {
              reasons: ['continuation'],
              commentDelta: 0,
              pendingContinuation: true,
            }));
            candidateIds.add(noteId);
          }
          const planned = candidates.map((candidate) => Object.assign({}, candidate, {
            remainingCount: candidateRemaining(candidate, initial),
          }));
          const fullQueue = model.buildRoundRobinQueue(planned, {
            perNoteLimit: profile.perNoteLimit || 500,
          });
          const seenNotes = new Set();
          const queue = fullQueue.filter((task) => {
            if (seenNotes.has(task.noteId)) return false;
            seenNotes.add(task.noteId);
            return true;
          });
          const candidateById = new Map(candidates.map((item) => [item.noteId, item]));
          const links = typeof settings.resolveOfficialLinks === 'function' && queue.length
            ? object(await settings.resolveOfficialLinks(inventory, queue.map((task) => candidateById.get(task.noteId))))
            : {};
          let capturedCommentCount = 0;
          let completedCount = 0;
          let pendingContinuationCount = 0;
          const failures = [];
          const noteStates = [];
          const nextCheckpoints = Object.assign({}, checkpointNotes);
          for (const task of queue) {
            const candidate = candidateById.get(task.noteId) || { noteId: task.noteId };
            const officialUrl = text(links[task.noteId] || candidate.officialUrl, 4000);
            try {
              if (!officialUrl) throw Object.assign(new Error('未取得蒲公英官方笔记链接。'), {
                code: 'OFFICIAL_LINK_MISSING', retryable: true,
              });
              const existing = await commentRecord(profile.storeId, accountKey, task.noteId);
              const knownCommentIds = flattenComments(existing).map((item) => item.commentId);
              const capture = object(await settings.collectNoteComments({
                accountKey, noteId: task.noteId, officialUrl,
                limit: Math.min(500, Number(task.limit) || 500),
                checkpoint: nextCheckpoints[task.noteId] || task.checkpoint || {}, knownCommentIds,
              }));
              const saved = await saveComments(
                profile.storeId, accountKey, task.noteId, capture.comments, capture.complete === true,
              );
              capturedCommentCount += saved.saved;
              if (capture.complete === true) completedCount += 1;
              else pendingContinuationCount += 1;
              const priorCapturedCount = Number(nextCheckpoints[task.noteId] &&
                nextCheckpoints[task.noteId].capturedCount) || 0;
              const checkpoint = Object.assign(model.createCaptureCheckpoint(Object.assign(
                {}, capture.checkpoint, {
                  accountKey, noteId: task.noteId,
                  capturedCount: priorCapturedCount + saved.saved,
                  updatedAt: iso(now()),
                }
              )), { complete: capture.complete === true });
              nextCheckpoints[task.noteId] = checkpoint;
              await write({
                [STORAGE_KEYS.checkpoints]: {
                  schema: 'CommentCaptureCheckpointIndexV1', schemaVersion: 1,
                  accountKey, storeId: profile.storeId, storeName: profile.storeName,
                  updatedAt: iso(now()), notes: nextCheckpoints,
                },
              });
              noteStates.push({
                noteId: task.noteId, title: candidate.title || '', officialUrl,
                status: capture.complete === true ? 'complete' : 'continuation',
                capturedCount: saved.saved,
              });
            } catch (error) {
              failures.push({
                noteId: task.noteId,
                code: text(error && error.code || 'COMMENT_CAPTURE_FAILED', 120),
                message: text(error && error.message || error, 500),
              });
              noteStates.push({ noteId: task.noteId, status: 'failed', capturedCount: 0 });
            }
          }
          const priorIds = Array.isArray(stored[STORAGE_KEYS.noteIndex] &&
            stored[STORAGE_KEYS.noteIndex].noteIds) ? stored[STORAGE_KEYS.noteIndex].noteIds : [];
          const noteIds = Array.from(new Set(priorIds.concat(currentSnapshot.notes.map((item) => item.noteId))));
          const comments = await allComments(profile.storeId, accountKey, noteIds);
          let insight = model.summarizeCommentInsights(comments, {
            accountKey, generatedAt: iso(now()), evidenceLimit: 3,
          });
          if (typeof settings.analyzeSemantics === 'function' && comments.length) {
            try {
              insight = Object.assign({}, insight, {
                semantic: await settings.analyzeSemantics(comments.map(model.sanitizeCommentForAnalysis)),
              });
            } catch (error) {
              insight = Object.assign({}, insight, {
                semantic: { status: 'pending_retry', errorCode: text(error && error.code || 'AI_UNAVAILABLE', 120) },
              });
            }
          }
          const summary = Object.assign({}, insight, {
            schema: 'CommentInsightSummaryV1', schemaVersion: 1,
            accountKey, storeId: profile.storeId, storeName: profile.storeName,
            generatedAt: iso(now()),
            platformUpdatedAt: inventory.platformUpdatedAt || '',
            interval: delta && delta.interval || null,
            noteMetrics: delta ? delta.notes : currentSnapshot.notes,
            noteStates,
          });
          const blockingStatus = failures.map(failureStatus)
            .find((value) => value !== 'failed') || '';
          const status = blockingStatus ||
            (failures.length || pendingContinuationCount ? 'partial' : 'completed');
          const finishedAt = now();
          const state = Object.assign({}, baseState, {
            accountKey, running: false, status,
            initial, candidateCount: candidates.length, completedCount,
            capturedCommentCount, pendingContinuationCount,
            failureCount: failures.length, failures,
            zeroResult: currentSnapshot.notes.length === 0,
            updatedAt: iso(finishedAt), finishedAt: iso(finishedAt),
            lastSuccessfulAt: blockingStatus
              ? text(baseState.lastSuccessfulAt, 80)
              : iso(finishedAt),
          });
          const runStatus = status === 'waiting_login' ? 'needs_login'
            : status === 'waiting_verification' ? 'needs_verification'
              : status;
          const run = model.createMonitorRun({
            runId: id, accountKey, trigger: initial ? 'initial' : trigger,
            status: runStatus, startedAt: baseState.startedAt, finishedAt: state.finishedAt,
            candidateCount: candidates.length, completedCount,
            continuationCount: pendingContinuationCount, failureCount: failures.length,
          });
          const runIndex = [run].concat(Array.isArray(stored[STORAGE_KEYS.runIndex])
            ? stored[STORAGE_KEYS.runIndex].filter((item) => item && item.runId !== id)
            : []).slice(0, 89);
          const priorNoteValues = new Map((Array.isArray(stored[STORAGE_KEYS.noteIndex] &&
            stored[STORAGE_KEYS.noteIndex].notes) ? stored[STORAGE_KEYS.noteIndex].notes : [])
            .map((item) => [item && item.noteId, item]));
          const stateByNote = new Map(noteStates.map((item) => [item.noteId, item]));
          await write({
            [STORAGE_KEYS.profile]: Object.assign({}, profile, { accountKey }),
            [STORAGE_KEYS.metricSnapshot]: currentSnapshot,
            [STORAGE_KEYS.noteIndex]: {
              schema: 'CommentMonitorNoteIndexV1', schemaVersion: 1,
              accountKey, storeId: profile.storeId, storeName: profile.storeName, noteIds,
              notes: currentSnapshot.notes.map((item) => {
                const prior = object(priorNoteValues.get(item.noteId));
                const latest = object(stateByNote.get(item.noteId));
                return Object.assign({}, item, {
                  officialUrl: latest.officialUrl || prior.officialUrl || item.officialUrl || '',
                  captureStatus: latest.status || prior.captureStatus || 'baseline',
                });
              }),
              updatedAt: iso(finishedAt),
            },
            [STORAGE_KEYS.checkpoints]: {
              schema: 'CommentCaptureCheckpointIndexV1', schemaVersion: 1,
              accountKey, storeId: profile.storeId, storeName: profile.storeName,
              updatedAt: iso(finishedAt), notes: nextCheckpoints,
            },
            [STORAGE_KEYS.summary]: summary,
            [STORAGE_KEYS.runIndex]: runIndex,
            [STORAGE_KEYS.state]: state,
          });
          if (pendingContinuationCount > 0 && chromeApi.alarms) {
            chromeApi.alarms.create(CONTINUATION_ALARM_NAME, { when: now() + 15 * 60 * 1000 });
          }
          if (typeof settings.persistSummary === 'function') {
            let summaryArchive;
            try {
              summaryArchive = object(await settings.persistSummary(summary, {
                accountKey, profile, run, state,
              }));
            } catch (error) {
              summaryArchive = {
                archived: false,
                reason: 'archive_failed',
                errorCode: text(error && error.code || 'COMMENT_SUMMARY_ARCHIVE_FAILED', 120),
              };
            }
            state.summaryArchive = {
              archived: summaryArchive.archived === true,
              reason: text(summaryArchive.reason, 80),
              runId: text(summaryArchive.runId, 160),
              storeId: text(summaryArchive.storeId, 160),
              candidateStoreCount: Math.max(0, Number(summaryArchive.candidateStoreCount) || 0),
              errorCode: text(summaryArchive.errorCode, 120),
            };
            await write({ [STORAGE_KEYS.state]: state });
          }
          return state;
        } catch (error) {
          const state = failureState(error, baseState, now());
          await write({ [STORAGE_KEYS.state]: state });
          return state;
        }
      })();
      activeRun = operation;
      try { return await operation; } finally { activeRun = null; }
    }

    async function getState() {
      const stored = await read(Object.values(STORAGE_KEYS));
      return {
        profile: model.normalizeMonitorProfile(stored[STORAGE_KEYS.profile] || { enabled: false }),
        state: stored[STORAGE_KEYS.state] || null,
        summary: stored[STORAGE_KEYS.summary] || null,
        noteIndex: stored[STORAGE_KEYS.noteIndex] || null,
        runs: Array.isArray(stored[STORAGE_KEYS.runIndex]) ? stored[STORAGE_KEYS.runIndex] : [],
      };
    }

    async function filteredComments(input) {
      const source = object(input);
      const stored = await read([STORAGE_KEYS.noteIndex]);
      const index = object(stored[STORAGE_KEYS.noteIndex]);
      const accountKey = text(source.accountKey || index.accountKey, 160);
      const storeId = text(source.storeId || index.storeId, 100);
      const requestedNoteId = text(source.noteId, 160);
      const search = text(source.search, 300).toLocaleLowerCase('zh-CN');
      const from = source.from ? Date.parse(source.from) : Number.NEGATIVE_INFINITY;
      const to = source.to ? Date.parse(source.to) + 24 * 60 * 60 * 1000 - 1 : Number.POSITIVE_INFINITY;
      const noteIds = requestedNoteId ? [requestedNoteId] : (Array.isArray(index.noteIds) ? index.noteIds : []);
      return (await allComments(storeId, accountKey, noteIds)).filter((item) => {
        const created = Date.parse(item && item.createdAt);
        return (!search || String(item && item.content || '').toLocaleLowerCase('zh-CN').includes(search)) &&
          (!Number.isFinite(created) || (created >= from && created <= to));
      });
    }

    async function queryComments(input) {
      const source = object(input);
      const items = await filteredComments(source);
      const offset = Math.max(0, Number(source.offset) || 0);
      const limit = Math.min(1000, Math.max(1, Number(source.limit) || 200));
      return { total: items.length, offset, limit, items: clone(items.slice(offset, offset + limit)) };
    }

    async function exportRaw(input) {
      const source = object(input);
      const items = await filteredComments(source);
      if (source.format === 'json') {
        return { mimeType: 'application/json', extension: 'json', content: JSON.stringify(items, null, 2) };
      }
      const columns = ['noteId', 'commentId', 'parentCommentId', 'createdAt', 'likeCount', 'content'];
      const lines = [columns.join(',')].concat(items.map((item) => (
        columns.map((column) => csvCell(item && item[column])).join(',')
      )));
      return { mimeType: 'text/csv;charset=utf-8', extension: 'csv', content: '\ufeff' + lines.join('\r\n') };
    }

    function startRun(trigger) {
      if (activeRun) return { started: false, running: true };
      const promise = runOnce({ trigger });
      promise.catch(() => {});
      return { started: true, running: true };
    }

    async function startConfiguredRun(input) {
      if (activeRun) return { started: false, running: true };
      const source = object(input);
      const storeId = text(source.storeId, 100);
      const storeName = text(source.storeName, 120);
      if (!storeId || !storeName) throw new Error('请先选择本次评论监测的店铺。');
      await configure({ storeId, storeName });
      return startRun('manual');
    }

    async function startup() {
      const profile = await currentProfile();
      await schedule(profile);
      if (!profile.enabled || !profile.storeId) return;
      const stored = await read([STORAGE_KEYS.state]);
      const state = object(stored[STORAGE_KEYS.state]);
      const last = Date.parse(state.lastSuccessfulAt || 0);
      if (!Number.isFinite(last) || now() - last >= 24 * 60 * 60 * 1000) startRun('catch_up');
    }

    function register() {
      if (registered) return;
      registered = true;
      if (chromeApi.alarms && chromeApi.alarms.onAlarm) {
        chromeApi.alarms.onAlarm.addListener((alarm) => {
          if (!alarm || ![ALARM_NAME, CONTINUATION_ALARM_NAME].includes(alarm.name)) return;
          startRun(alarm.name === ALARM_NAME ? 'daily' : 'catch_up');
        });
      }
      if (chromeApi.runtime.onStartup) chromeApi.runtime.onStartup.addListener(() => { startup().catch(() => {}); });
      if (chromeApi.runtime.onMessage) chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || !Object.values(MESSAGE_TYPES).includes(message.type)) return;
        if (typeof settings.isTrustedMessageSender === 'function' &&
            !settings.isTrustedMessageSender(message, sender)) {
          sendResponse({ ok: false, message: '请从评论监测工作台操作。' });
          return false;
        }
        const operation = message.type === MESSAGE_TYPES.getState ? getState()
          : message.type === MESSAGE_TYPES.configure ? configure(message.payload)
            : message.type === MESSAGE_TYPES.runNow ? startConfiguredRun(message.payload)
              : message.type === MESSAGE_TYPES.query ? queryComments(message.payload)
                : exportRaw(message.payload);
        operation.then((data) => sendResponse({ ok: true, data })).catch((error) => {
          sendResponse({ ok: false, message: text(error && error.message || error, 1000) });
        });
        return true;
      });
      startup().catch(() => {});
    }

    return Object.freeze({
      register, configure, getState, runOnce, queryComments, exportRaw, schedule,
    });
  }

  return Object.freeze({
    ALARM_NAME, CONTINUATION_ALARM_NAME, MESSAGE_TYPES, STORAGE_KEYS,
    createCommentMonitorRuntime, nextShanghaiSchedule,
  });
});

(function initXhsAnalysis(root, factory) {
  const contract = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.XhsContract;
  const qualityTools = typeof module === 'object' && module.exports
    ? require('./quality')
    : root.XhsQuality;
  const bindingTools = typeof module === 'object' && module.exports
    ? require('./bindings')
    : root.XhsBindings;
  const api = factory(contract, qualityTools, bindingTools);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsAnalysisApi(contract, qualityTools, bindingTools) {
  'use strict';

  if (!contract || !qualityTools || !bindingTools) {
    throw new Error('XhsContract, XhsQuality and XhsBindings must be loaded before XhsAnalysis');
  }

  const SNAPSHOT_SCHEMA = 'xhsAnalysisSnapshotV1';
  const STAR_METRIC_MAP = Object.freeze({
    readUv: 'readUv1d',
    engagementUv: 'engagementUv1d',
    searchImpressionUv: 'slrAttrItmSeImpsUv1d',
    searchVisitUv: 'slrAttrSlrSeVstUv1d',
    storeVisitUv: 'slrAttrSlrVstUv1d',
    newStoreVisitUv: 'slrAttrSlrVstUv1dNew',
    favoriteUv: 'slrAttrItmCltUv1d',
    cartUv: 'slrAttrItmCartUv1d',
    orderUv: 'slrAttrItmOrdUv1d',
    newOrderUv: 'slrAttrItmOrdUv1dNew',
    gmv: 'slrAttrItmOrdGmv1d',
    seededProductGmv: 'slrAttrItmOrdGmv1d1bpOrd',
    linkedProductGmv: 'slrAttrItmOrdGmv1dNot1bpOrd',
  });
  const STAR_METRIC_ALIASES = Object.freeze({
    favoriteUv: ['slrAttrItmFavUv1d'],
    seededProductGmv: ['slrAttrTaskItmOrdGmv1d'],
    linkedProductGmv: ['slrAttrLinkItmOrdGmv1d'],
  });

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === '' || value === '-') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = Number(String(value).replace(/[,￥¥%\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function numberOrZero(value) {
    return numberValue(value) === null ? 0 : numberValue(value);
  }

  function ratio(numerator, denominator) {
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator
      : null;
  }

  function starMetricValue(value, target, source) {
    for (const key of [source].concat(STAR_METRIC_ALIASES[target] || [], target)) {
      if (value[key] !== undefined) return value[key];
    }
    return undefined;
  }

  function canonicalDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const slash = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
    if (slash) return `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  function mergeIntervals(values) {
    const valid = array(values)
      .map((value) => ({ start: canonicalDate(value.start), end: canonicalDate(value.end) }))
      .filter((value) => value.start && value.end && value.start <= value.end)
      .sort((left, right) => left.start.localeCompare(right.start));
    const merged = [];
    for (const interval of valid) {
      const previous = merged[merged.length - 1];
      if (!previous) {
        merged.push({ ...interval });
        continue;
      }
      const dayAfter = new Date(`${previous.end}T00:00:00Z`);
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      if (interval.start <= dayAfter.toISOString().slice(0, 10)) {
        if (interval.end > previous.end) previous.end = interval.end;
      } else {
        merged.push({ ...interval });
      }
    }
    return merged;
  }

  function unique(values) {
    return [...new Set(array(values).filter((value) => value !== null && value !== undefined && value !== '')
      .map(String))];
  }

  function noteIdOf(value) {
    const row = isObject(value) ? value : {};
    return row.noteId || row.contentId || row.dimensions && row.dimensions.noteId || null;
  }

  function normalizePgy(collection) {
    const notes = new Map();
    for (const row of array(collection && collection.notes)) {
      const rawId = noteIdOf(row);
      if (!rawId) continue;
      const noteId = String(rawId);
      if (!notes.has(noteId)) {
        notes.set(noteId, {
          noteId,
          title: row.title || row.noteTitle || null,
          author: isObject(row.author)
            ? { id: row.author.id || null, name: row.author.name || null }
            : { id: row.kolId || null, name: row.author || row.kolNickName || null },
          publishDate: canonicalDate(row.publishDate || row.notePublishTime),
          cooperationCost: 0,
          platformFee: 0,
          metrics: { impressions: null, reads: null, interactions: null },
          sourceCount: 0,
          taskIntervals: [],
        });
      }
      const note = notes.get(noteId);
      const costs = isObject(row.costs) ? row.costs : {};
      const actual = numberValue(costs.cooperation !== undefined ? costs.cooperation : row.actualConsume);
      const fallback = Math.max(0, numberOrZero(row.totalConsume) - numberOrZero(row.refundAmount));
      note.cooperationCost += actual === null ? fallback : actual;
      note.platformFee += numberOrZero(costs.platformFee !== undefined ? costs.platformFee : row.totalPlatformPrice);
      const metrics = isObject(row.metrics) ? row.metrics : row;
      for (const [target, candidates] of Object.entries({
        impressions: ['impressions', 'impNum'],
        reads: ['reads', 'readNum'],
        interactions: ['interactions', 'engageNum'],
      })) {
        for (const key of candidates) {
          const value = numberValue(metrics[key]);
          if (value !== null) note.metrics[target] = Math.max(note.metrics[target] ?? value, value);
        }
      }
      const taskStart = canonicalDate(row.taskStartTime || row.task && row.task.start);
      const taskEnd = canonicalDate(row.taskEndTime || row.task && row.task.end);
      if (taskStart && taskEnd) note.taskIntervals.push({ start: taskStart, end: taskEnd });
      note.sourceCount += 1;
      if (!note.title && (row.title || row.noteTitle)) note.title = row.title || row.noteTitle;
      if (!note.publishDate) note.publishDate = canonicalDate(row.publishDate || row.notePublishTime);
    }
    for (const note of notes.values()) {
      note.metrics.readRate = ratio(note.metrics.reads, note.metrics.impressions);
      note.metrics.engagementRate = ratio(note.metrics.interactions, note.metrics.reads);
      note.taskIntervals = mergeIntervals(note.taskIntervals);
    }
    return notes;
  }

  function buildTaskIndex(adstar, pgyByNote) {
    const orders = array(adstar && adstar.lists && adstar.lists.orders && adstar.lists.orders.items);
    const orderMap = new Map();
    for (const order of orders) {
      const id = order.orderId || order.id || order.buyOrderId;
      if (!id) continue;
      orderMap.set(String(id), {
        id: String(id),
        projectId: order.projectId == null ? null : String(order.projectId),
        start: canonicalDate(order.startTime || order.startDate),
        end: canonicalDate(order.endTime || order.endDate),
      });
    }
    const mutable = new Map();
    function entry(noteId) {
      const id = String(noteId);
      if (!mutable.has(id)) {
        mutable.set(id, {
          noteId: id, intervals: [], orderIds: new Set(), projectIds: new Set(), relations: [],
        });
      }
      return mutable.get(id);
    }
    for (const row of array(adstar && adstar.contentRows)) {
      const noteId = noteIdOf(row);
      if (!noteId) continue;
      const current = entry(noteId);
      const rawOrderId = row.listOrderId || row.orderId || row.reportOrderId;
      const orderId = rawOrderId == null ? null : String(rawOrderId);
      const order = orderId ? orderMap.get(orderId) : null;
      const rawProjectId = row.projectId != null ? row.projectId : order && order.projectId;
      const projectId = rawProjectId == null ? null : String(rawProjectId);
      if (orderId) current.orderIds.add(orderId);
      if (projectId) current.projectIds.add(projectId);
      if (order && order.start && order.end) current.intervals.push({ start: order.start, end: order.end });
      current.relations.push({ source: 'adstar', orderId, projectId,
        start: order && order.start || null, end: order && order.end || null });
    }
    for (const [noteId, pgy] of pgyByNote) {
      if (!pgy.taskIntervals.length) continue;
      const current = entry(noteId);
      for (const interval of pgy.taskIntervals) {
        current.intervals.push(interval);
        current.relations.push({ source: 'pgy_task', orderId: null, projectId: null, ...interval });
      }
    }
    const result = new Map();
    for (const [noteId, value] of mutable) {
      result.set(noteId, {
        noteId,
        intervals: mergeIntervals(value.intervals),
        orderIds: [...value.orderIds],
        projectIds: [...value.projectIds],
        relations: value.relations,
      });
    }
    return result;
  }

  function taskStatus(noteId, date, taskIndex) {
    if (!date) return 'unknown';
    const task = taskIndex.get(String(noteId));
    if (!task) return 'no_task';
    if (!task.intervals.length) return 'unknown';
    return task.intervals.some((interval) => date >= interval.start && date <= interval.end)
      ? 'in_task'
      : 'out_of_task';
  }

  function normalizeStarMetrics(value) {
    if (!isObject(value)) return null;
    const metrics = {};
    for (const [target, source] of Object.entries(STAR_METRIC_MAP)) {
      metrics[target] = numberValue(starMetricValue(value, target, source));
    }
    metrics.contentEngagementRate = numberValue(value.contentEngagementRate) ??
      ratio(metrics.engagementUv, metrics.readUv);
    metrics.visitRate = numberValue(value.drainRate !== undefined ? value.drainRate : value.visitRate);
    metrics.conversionRate = numberValue(value.conversionRate);
    return metrics;
  }

  function normalizeStarNotes(adstar, taskIndex) {
    const byDay = new Map();
    for (const row of array(adstar && adstar.contentRows)) {
      const rawId = noteIdOf(row);
      if (!rawId) continue;
      const noteId = String(rawId);
      const date = canonicalDate(row.theDate || row.ds || row.date);
      const key = `${noteId}|${date || 'unknown'}`;
      if (!byDay.has(key)) {
        byDay.set(key, {
          noteId, date, orderIds: new Set(), projectIds: new Set(), rowCount: 0,
          metrics: Object.fromEntries(Object.keys(STAR_METRIC_MAP).map((name) => [name, null])),
        });
      }
      const daily = byDay.get(key);
      const orderId = row.listOrderId || row.orderId || row.reportOrderId;
      if (orderId != null) daily.orderIds.add(String(orderId));
      if (row.projectId != null) daily.projectIds.add(String(row.projectId));
      daily.rowCount += 1;
      for (const [target, source] of Object.entries(STAR_METRIC_MAP)) {
        const value = numberValue(starMetricValue(row, target, source));
        if (value !== null) daily.metrics[target] = Math.max(daily.metrics[target] ?? value, value);
      }
    }
    const daily = [...byDay.values()].map((row) => ({
      noteId: row.noteId,
      date: row.date,
      taskStatus: taskStatus(row.noteId, row.date, taskIndex),
      orderIds: [...row.orderIds],
      projectIds: [...row.projectIds],
      rowCount: row.rowCount,
      metrics: Object.assign({}, row.metrics, {
        contentEngagementRate: ratio(row.metrics.engagementUv, row.metrics.readUv),
      }),
    }));
    const byNote = new Map();
    for (const row of daily) {
      if (!byNote.has(row.noteId)) {
        byNote.set(row.noteId, {
          noteId: row.noteId, dates: 0, orderIds: new Set(), projectIds: new Set(),
          metrics: Object.fromEntries(Object.keys(STAR_METRIC_MAP).map((name) => [name, 0])),
        });
      }
      const note = byNote.get(row.noteId);
      note.dates += 1;
      row.orderIds.forEach((id) => note.orderIds.add(id));
      row.projectIds.forEach((id) => note.projectIds.add(id));
      for (const name of Object.keys(STAR_METRIC_MAP)) note.metrics[name] += row.metrics[name] ?? 0;
    }
    for (const note of byNote.values()) {
      note.orderIds = [...note.orderIds];
      note.projectIds = [...note.projectIds];
      note.metrics.contentEngagementRate = ratio(note.metrics.engagementUv, note.metrics.readUv);
    }
    return { daily, byNote };
  }

  function marketingObjective(value, row) {
    const label = value == null ? '' : String(isObject(value) ? value.name || value.label || '' : value);
    const compact = label.toLowerCase().replace(/[\s_-]/g, '');
    if (label === '13' || compact.includes('直达') || compact.includes('direct')) return 'direct';
    if (label === '4' || compact.includes('种草') || compact.includes('seeding')) return 'product_seeding';
    const metrics = isObject(row.metrics) ? row.metrics : row;
    if (numberOrZero(metrics.externalGoodsOrder15) > 0 || numberOrZero(metrics.externalRgmv15) > 0) return 'direct';
    return 'unknown';
  }

  function normalizeJuguang(juguang, taskIndex) {
    const rows = [];
    for (const unit of array(juguang && juguang.accounts)) {
      const account = isObject(unit.account) ? unit.account : {};
      const sourceRows = array(unit.dailyRows).length ? unit.dailyRows : array(unit.summaryRows);
      for (const row of sourceRows) {
        const rawId = noteIdOf(row);
        if (!rawId) continue;
        const dimensions = isObject(row.dimensions) ? row.dimensions : {};
        const metrics = isObject(row.metrics) ? row.metrics : row;
        const noteId = String(rawId);
        const date = canonicalDate(dimensions.time || row.time || row.date);
        const objective = marketingObjective(
          dimensions.marketingTarget !== undefined ? dimensions.marketingTarget : row.marketingTarget,
          row
        );
        const direct = objective === 'direct';
        rows.push({
          noteId,
          date,
          accountId: String(row.accountId || account.vSellerId || `advertiser-${account.advertiserId}`),
          accountName: account.name || null,
          accountType: account.accountType == null ? null : account.accountType,
          marketingObjective: objective,
          deliveryMode: dimensions.deliveryMode !== undefined ? dimensions.deliveryMode : row.deliveryMode,
          taskStatus: taskStatus(noteId, date, taskIndex),
          spend: numberOrZero(metrics.fee),
          impressions: numberOrZero(metrics.impression),
          clicks: numberOrZero(metrics.click),
          interactions: numberOrZero(metrics.interaction),
          seedUsers: numberOrZero(metrics.iUserNum),
          deepSeedUsers: numberOrZero(metrics.tiUserNum),
          conversion: {
            observable: direct,
            storeVisits: direct ? numberOrZero(metrics.outClickEnterStoreCnt15d) : null,
            orders: direct ? numberOrZero(metrics.externalGoodsOrder15) : null,
            gmv: direct ? numberOrZero(metrics.externalRgmv15) : null,
          },
        });
      }
    }
    return rows;
  }

  function summarizeJuguang(rows) {
    const summary = {
      rows: rows.length,
      noteCount: new Set(rows.map((row) => row.noteId)).size,
      spend: 0,
      impressions: 0,
      clicks: 0,
      interactions: 0,
      seedUsers: 0,
      deepSeedUsers: 0,
      directSpend: 0,
      storeVisits: null,
      orders: null,
      gmv: null,
    };
    for (const row of rows) {
      summary.spend += row.spend;
      summary.impressions += row.impressions;
      summary.clicks += row.clicks;
      summary.interactions += row.interactions;
      summary.seedUsers += row.seedUsers;
      summary.deepSeedUsers += row.deepSeedUsers;
      if (row.conversion.observable) {
        summary.directSpend += row.spend;
        summary.storeVisits = (summary.storeVisits ?? 0) + (row.conversion.storeVisits ?? 0);
        summary.orders = (summary.orders ?? 0) + (row.conversion.orders ?? 0);
        summary.gmv = (summary.gmv ?? 0) + (row.conversion.gmv ?? 0);
      }
    }
    summary.roi = ratio(summary.gmv, summary.directSpend);
    return summary;
  }

  function groupJuguang(rows, keyBuilder) {
    const groups = new Map();
    for (const row of rows) {
      const key = String(keyBuilder(row));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups.entries()].map(([key, values]) => ({ key, ...summarizeJuguang(values) }))
      .sort((left, right) => right.spend - left.spend);
  }

  function maturity(publishDate, asOf) {
    if (!publishDate || !asOf) return 'unknown';
    const start = new Date(`${publishDate}T00:00:00Z`);
    const end = new Date(`${canonicalDate(asOf)}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 'unknown';
    const days = Math.floor((end - start) / 86400000);
    return days < 7 ? 'new' : days < 15 ? 'observing' : 'mature';
  }

  function emptyTask(noteId) {
    return { noteId, intervals: [], orderIds: [], projectIds: [], relations: [] };
  }

  function buildNotes(pgyByNote, juguangRows, starByNote, taskIndex, asOf, availability) {
    const known = isObject(availability) ? availability : {};
    const pgyKnown = known.pgy === true;
    const juguangKnown = known.juguang === true;
    const adByNote = new Map();
    for (const row of juguangRows) {
      if (!adByNote.has(row.noteId)) adByNote.set(row.noteId, []);
      adByNote.get(row.noteId).push(row);
    }
    const ids = new Set([...pgyByNote.keys(), ...adByNote.keys(), ...starByNote.keys(), ...taskIndex.keys()]);
    const notes = [];
    for (const noteId of ids) {
      const pgy = pgyByNote.get(noteId) || null;
      const task = taskIndex.get(noteId) || emptyTask(noteId);
      const adRows = adByNote.get(noteId) || [];
      const allAds = summarizeJuguang(adRows);
      const inTask = summarizeJuguang(adRows.filter((row) => row.taskStatus === 'in_task'));
      const outsideDirect = summarizeJuguang(adRows.filter((row) => (
        row.marketingObjective === 'direct' && ['out_of_task', 'no_task'].includes(row.taskStatus)
      )));
      const star = starByNote.get(noteId) || null;
      const cooperation = pgy ? pgy.cooperationCost : (pgyKnown ? 0 : null);
      const platformFee = pgy ? pgy.platformFee : (pgyKnown ? 0 : null);
      const partnership = cooperation == null || platformFee == null
        ? null
        : cooperation + platformFee;
      const alignedCost = pgyKnown && juguangKnown
        ? (task.intervals.length ? partnership : 0) + inTask.spend
        : null;
      const publishDate = pgy && pgy.publishDate || null;
      notes.push({
        noteId,
        title: pgy && pgy.title || null,
        author: pgy && pgy.author || null,
        publishDate,
        maturity: maturity(publishDate, asOf),
        task,
        costs: {
          cooperation,
          platformFee,
          juguang: juguangKnown ? allAds.spend : null,
          total: partnership == null || !juguangKnown ? null : partnership + allAds.spend,
          starTaskAligned: alignedCost,
          outsideDirect: juguangKnown ? outsideDirect.spend : null,
        },
        pgy: pgy ? {
          sourceCount: pgy.sourceCount,
          metrics: pgy.metrics,
        } : null,
        juguang: juguangKnown ? {
          accountIds: unique(adRows.map((row) => row.accountId)),
          total: allAds,
          inTask,
          outsideDirect,
          objectives: groupJuguang(adRows, (row) => row.marketingObjective),
          taskStatuses: groupJuguang(adRows, (row) => row.taskStatus),
        } : null,
        star: star ? Object.assign({}, star, { roi: ratio(star.metrics.gmv, alignedCost) }) : null,
        results: {
          starTaskGmv: star ? star.metrics.gmv : null,
          starTaskRoi: star ? ratio(star.metrics.gmv, alignedCost) : null,
          outsideDirectGmv: juguangKnown ? outsideDirect.gmv : null,
          outsideDirectRoi: juguangKnown ? outsideDirect.roi : null,
        },
      });
    }
    return notes.sort((left, right) => right.costs.total - left.costs.total);
  }

  function allocations(notes) {
    const orders = new Map();
    const projects = new Map();
    let unmappedTaskCost = 0;
    for (const note of notes) {
      const cost = note.costs.starTaskAligned;
      if (!cost) continue;
      if (!note.task.orderIds.length && !note.task.projectIds.length) unmappedTaskCost += cost;
      const orderShare = note.task.orderIds.length ? cost / note.task.orderIds.length : 0;
      const projectShare = note.task.projectIds.length ? cost / note.task.projectIds.length : 0;
      note.task.orderIds.forEach((id) => orders.set(id, (orders.get(id) || 0) + orderShare));
      note.task.projectIds.forEach((id) => projects.set(id, (projects.get(id) || 0) + projectShare));
    }
    return { orders, projects, unmappedTaskCost };
  }

  function starLayers(adstar, allocation) {
    const nested = array(adstar && adstar.nested);
    function units(type, costs) {
      return nested.filter((unit) => unit.type === type).map((unit) => {
        const id = String(unit.id || type === 'order' && unit.orderId || type === 'project' && unit.projectId || '');
        const allocatedCost = costs.get(id) || 0;
        const metrics = normalizeStarMetrics(unit.summary);
        return {
          id,
          name: unit.name || null,
          projectId: unit.projectId == null ? null : String(unit.projectId),
          status: unit.status || 'missing',
          allocatedCost,
          metrics,
          roi: ratio(metrics && metrics.gmv, allocatedCost),
        };
      });
    }
    return {
      projects: units('project', allocation.projects),
      orders: units('order', allocation.orders),
      unmappedTaskCost: allocation.unmappedTaskCost,
    };
  }

  function buildQuality(input, collections) {
    const base = qualityTools.evaluateDecisionReadiness({
      pgy: collections.pgy,
      juguang: collections.juguang,
      adstar: collections.adstar,
    });
    const issues = array(base.issues).slice().concat(array(input.bindingIssues));
    const requestedRange = JSON.stringify(input.dateRange || {});
    const bindings = isObject(input.accountBindings) ? input.accountBindings : {};
    for (const platform of ['pgy', 'juguang', 'adstar']) {
      const collection = collections[platform];
      if (!collection) continue;
      if (requestedRange !== JSON.stringify(collection.dateRange || {})) {
        if (!issues.some((issue) => issue.code === 'date_range_mismatch' && issue.platform === platform)) {
          issues.push({
            severity: 'critical', code: 'date_range_mismatch', platform,
            message: `Requested date range does not match ${platform}`,
          });
        }
      }
      const expectedIdentity = array(bindings[platform]);
      const actualIdentity = bindingTools.extractPlatformIdentity(platform, collection);
      if (!expectedIdentity.length || !bindingTools.sameTokens(expectedIdentity, actualIdentity)) {
        issues.push({
          severity: 'critical', code: 'account_binding_mismatch', platform,
          message: `Bound account does not match ${platform} collection`,
        });
      }
      if (input.runId && collection.runId && String(input.runId) !== String(collection.runId)) {
        issues.push({
          severity: 'critical', code: 'run_id_mismatch', platform,
          message: `Run id does not match ${platform} collection`,
        });
      }
    }
    const sanitized = contract.sanitizeSensitiveData(issues);
    return {
      decisionReady: !sanitized.some((issue) => issue.severity === 'critical'),
      requiredPlatforms: ['pgy', 'juguang', 'adstar'],
      issues: sanitized,
    };
  }

  function assignActions(notes, quality, targetRoi) {
    if (!quality.decisionReady) {
      const actions = [{
        noteId: null,
        action: 'collect_more',
        confidence: 'high',
        evidence: ['三平台数据完整性或账号/日期口径未通过'],
      }];
      for (const note of notes) {
        actions.push({
          noteId: note.noteId,
          action: 'observe',
          confidence: 'low',
          evidence: ['数据质量未达到经营决策标准'],
        });
      }
      return actions;
    }
    const benchmark = numberValue(targetRoi);
    return notes.map((note) => {
      const candidates = [note.results.starTaskRoi, note.results.outsideDirectRoi].filter(Number.isFinite);
      const best = candidates.length ? Math.max(...candidates) : null;
      let action = 'observe';
      if (note.maturity === 'mature' && benchmark !== null && best !== null) {
        action = best >= benchmark ? 'scale' : best < benchmark * 0.5 ? 'stop' : 'optimize';
      }
      return {
        noteId: note.noteId,
        action,
        confidence: action === 'observe' ? 'low' : 'high',
        evidence: best === null || benchmark === null
          ? ['等待完整归因数据']
          : [`可观测 ROI ${best.toFixed(2)}，目标 ${benchmark.toFixed(2)}`],
      };
    });
  }

  function accountMetadata(collections, generatedAt) {
    const output = {};
    for (const platform of ['pgy', 'juguang', 'adstar']) {
      const collection = collections[platform] || {};
      const accountKeys = bindingTools.extractPlatformIdentity(platform, collection);
      output[platform] = {
        accountKeys,
        collectedAt: collection.finishedAt || generatedAt,
      };
    }
    return output;
  }

  function createXhsAnalysisSnapshot(input) {
    const source = isObject(input) ? input : {};
    const collections = isObject(source.collections) ? source.collections : {};
    const requestedPlatforms = array(source.selectedPlatforms)
      .filter((platform) => ['pgy', 'juguang', 'adstar'].includes(platform));
    const selectedPlatforms = requestedPlatforms.length
      ? Array.from(new Set(requestedPlatforms))
      : ['pgy', 'juguang', 'adstar'];
    const hasPgy = selectedPlatforms.includes('pgy');
    const hasJuguang = selectedPlatforms.includes('juguang');
    const hasAdstar = selectedPlatforms.includes('adstar');
    const pgy = isObject(collections.pgy) ? collections.pgy : {};
    const juguang = isObject(collections.juguang) ? collections.juguang : {};
    const adstar = isObject(collections.adstar) ? collections.adstar : {};
    const unavailableStatuses = new Set(['failed', 'cancelled', 'missing']);
    const collectionUsable = (selected, collection) => selected && Object.keys(collection).length > 0 &&
      !unavailableStatuses.has(String(collection.status || 'missing'));
    const usePgy = collectionUsable(hasPgy, pgy);
    const useJuguang = collectionUsable(hasJuguang, juguang);
    const useAdstar = collectionUsable(hasAdstar, adstar);
    const pgyByNote = normalizePgy(usePgy ? pgy : {});
    const taskIndex = buildTaskIndex(useAdstar ? adstar : {}, pgyByNote);
    const starNormalized = normalizeStarNotes(useAdstar ? adstar : {}, taskIndex);
    const juguangRows = normalizeJuguang(useJuguang ? juguang : {}, taskIndex);
    const notes = buildNotes(pgyByNote, juguangRows, starNormalized.byNote, taskIndex,
      canonicalDate(source.asOf) || canonicalDate(source.generatedAt), {
        pgy: usePgy,
        juguang: useJuguang,
      });
    const allocation = allocations(notes);
    const star = starLayers(useAdstar ? adstar : {}, allocation);
    const quality = buildQuality(source, { pgy, juguang, adstar });
    const actions = assignActions(notes, quality, source.targetRoi);
    const cooperation = usePgy
      ? notes.reduce((sum, note) => sum + note.costs.cooperation, 0)
      : null;
    const platformFee = usePgy
      ? notes.reduce((sum, note) => sum + note.costs.platformFee, 0)
      : null;
    const partnership = usePgy ? cooperation + platformFee : null;
    const adTotal = summarizeJuguang(juguangRows);
    const adInTask = summarizeJuguang(juguangRows.filter((row) => row.taskStatus === 'in_task'));
    const outsideDirect = summarizeJuguang(juguangRows.filter((row) => (
      row.marketingObjective === 'direct' && ['out_of_task', 'no_task'].includes(row.taskStatus)
    )));
    const taskPartnership = notes.filter((note) => note.task.intervals.length)
      .reduce((sum, note) => sum + note.costs.cooperation + note.costs.platformFee, 0);
    const starTaskCost = usePgy && useJuguang ? taskPartnership + adInTask.spend : null;
    const storeMetrics = useAdstar ? normalizeStarMetrics(adstar.storeSummary) : null;
    const generatedAt = source.generatedAt || new Date().toISOString();
    const snapshot = {
      schema: SNAPSHOT_SCHEMA,
      schemaVersion: 1,
      runId: source.runId || null,
      storeId: source.storeId || null,
      selectedPlatforms,
      generatedAt,
      asOf: canonicalDate(source.asOf) || canonicalDate(generatedAt),
      dateRange: contract.sanitizeSensitiveData(source.dateRange || null),
      accounts: accountMetadata({ pgy, juguang, adstar }, generatedAt),
      pgy: {
        reportedNoteCount: usePgy
          ? (Number.isFinite(numberValue(pgy.reconciliation && pgy.reconciliation.uniqueCount))
            ? numberValue(pgy.reconciliation.uniqueCount)
            : pgyByNote.size)
          : null,
      },
      management: {
        noteCount: notes.length,
        costs: {
          cooperation,
          platformFee,
          partnership,
          juguang: useJuguang ? adTotal.spend : null,
          total: usePgy && useJuguang ? partnership + adTotal.spend : null,
          starTaskAligned: starTaskCost,
          outsideDirect: useJuguang ? outsideDirect.spend : null,
        },
        starTaskResult: {
          source: 'adstar_store_summary',
          metrics: storeMetrics,
          gmv: storeMetrics && storeMetrics.gmv,
          roi: ratio(storeMetrics && storeMetrics.gmv, starTaskCost),
        },
        outsideDirectResult: useJuguang ? {
          attributionBasis: 'conversion_time',
          attributionWindowDays: numberValue(juguang.attribution && juguang.attribution.windowDays) || 15,
          spend: outsideDirect.spend,
          storeVisits: outsideDirect.storeVisits,
          orders: outsideDirect.orders,
          gmv: outsideDirect.gmv,
          roi: outsideDirect.roi,
        } : null,
      },
      spotlight: {
        total: useJuguang ? adTotal : null,
        daily: useJuguang ? juguangRows : [],
        byAccount: useJuguang ? groupJuguang(juguangRows, (row) => row.accountName || row.accountId) : [],
        byMarketingObjective: useJuguang
          ? groupJuguang(juguangRows, (row) => row.marketingObjective)
          : [],
        byDeliveryMode: useJuguang
          ? groupJuguang(juguangRows, (row) => row.deliveryMode == null ? 'unknown' : row.deliveryMode)
          : [],
        byTaskStatus: useJuguang ? groupJuguang(juguangRows, (row) => row.taskStatus) : [],
      },
      star: Object.assign({
        store: useAdstar ? {
          allocatedCost: starTaskCost,
          metrics: storeMetrics ? Object.assign({}, storeMetrics) : null,
          roi: ratio(storeMetrics && storeMetrics.gmv, starTaskCost),
        } : null,
        daily: useAdstar ? starNormalized.daily : [],
      }, star),
      targetRoi: numberValue(source.targetRoi),
      quality,
      actions,
      notes,
    };
    return contract.sanitizeSensitiveData(snapshot);
  }

  return Object.freeze({
    SNAPSHOT_SCHEMA,
    STAR_METRIC_MAP,
    canonicalDate,
    createXhsAnalysisSnapshot,
    mergeIntervals,
  });
});

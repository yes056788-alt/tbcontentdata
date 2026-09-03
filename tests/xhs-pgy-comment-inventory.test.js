const assert = require('node:assert/strict');
const test = require('node:test');

const inventoryApi = require('../xhs/pgy-comment-inventory');

test('inventory collector paginates the account note list without fetching search keywords', async () => {
  const requests = [];
  const pageClient = {
    async request(request) {
      requests.push(JSON.parse(JSON.stringify(request)));
      if (request.endpoint === 'identity.get') {
        return { brandUserId: 'brand-001', brandUserName: '测试品牌' };
      }
      if (request.endpoint === 'notes.list') {
        const page = request.payload.pageNum;
        return {
          data: {
            pageNum: page,
            total: 3,
            totalPage: 2,
            updateTime: '2030-01-08 08:55:00',
            list: page === 1 ? [{
              noteId: 'note-a', noteTitle: 'A', notePublishTime: '2030-01-07',
              readNum: 100, engageNum: 20, cmtNum: 4,
              token: 'must-not-leak', cookie: 'must-not-leak',
            }, {
              noteId: 'note-b', noteTitle: 'B', notePublishTime: '2029-12-01',
              readNum: 50, engageNum: 5, cmtNum: 1,
            }] : [{
              noteId: 'note-a', noteTitle: 'A duplicate order', notePublishTime: '2030-01-07',
              readNum: 120, engageNum: 22, cmtNum: 5,
            }],
          },
        };
      }
      throw new Error(`unexpected endpoint ${request.endpoint}`);
    },
  };
  const collector = inventoryApi.createPgyCommentInventoryCollector({
    pageClient,
    now: () => Date.parse('2030-01-08T01:00:00.000Z'),
  });

  const result = await collector.collect({ tabId: 7 });

  assert.equal(result.accountKey, 'brand-001');
  assert.equal(result.rows.length, 3, 'duplicate order rows remain available for noteId max aggregation');
  assert.equal(result.platformUpdatedAt, '2030-01-08T00:55:00.000Z');
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.deepEqual(requests.map((item) => item.endpoint), [
    'identity.get', 'notes.list', 'notes.list',
  ]);
  assert.equal(requests.some((item) => item.endpoint === 'notes.searchKeywords'), false);
});

test('official link resolver uses the platform long task and returns only requested signed links', async () => {
  const requests = [];
  let statusReads = 0;
  const pageClient = {
    async request(request) {
      requests.push(JSON.parse(JSON.stringify(request)));
      if (request.endpoint === 'notes.linkExport.submit') return { taskId: 'task-001' };
      if (request.endpoint === 'notes.linkExport.status') {
        statusReads += 1;
        return { status: statusReads < 2 ? 2 : 3 };
      }
      if (request.endpoint === 'notes.linkExport.result') {
        return {
          links: [
            ['note-a', 'https://www.xiaohongshu.com/explore/note-a?xsec_token=official-note-a&xsec_source=pc_pgyexport'],
            ['unrequested', 'https://www.xiaohongshu.com/explore/unrequested?xsec_token=official-unrequested&xsec_source=pc_pgyexport'],
          ],
        };
      }
      throw new Error(`unexpected endpoint ${request.endpoint}`);
    },
  };
  const collector = inventoryApi.createPgyCommentInventoryCollector({
    pageClient,
    wait: async () => {},
    now: () => Date.parse('2030-01-08T01:00:00.000Z'),
  });

  const links = await collector.resolveOfficialLinks({
    tabId: 7,
    brandUserId: 'brand-001',
    noteIds: ['note-a'],
    notes: [{ noteId: 'note-a', publishDate: '2030-01-07' }],
  });

  assert.deepEqual(Object.keys(links), ['note-a']);
  assert.match(links['note-a'], /xsec_source=pc_pgyexport$/);
  assert.deepEqual(requests.map((item) => item.endpoint), [
    'notes.linkExport.submit',
    'notes.linkExport.status',
    'notes.linkExport.status',
    'notes.linkExport.result',
  ]);
});

test('inventory failures preserve login and rate-limit status codes for the monitor state', async () => {
  const pageClient = {
    async request() {
      throw Object.assign(new Error('请重新登录'), { code: 'PGY_IDENTITY_UNAVAILABLE', retryable: false });
    },
  };
  const collector = inventoryApi.createPgyCommentInventoryCollector({ pageClient });

  await assert.rejects(
    () => collector.collect({ tabId: 7 }),
    (error) => error.code === 'LOGIN_REQUIRED' && error.retryable === true,
  );
});

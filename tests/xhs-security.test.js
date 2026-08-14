const assert = require('node:assert/strict');
const test = require('node:test');

const {
  sanitizeSensitiveData,
} = require('../xhs/contract');

test('recursively removes token, cookie, authorization, and signature fields', () => {
  const input = {
    noteId: 'fictional-note-001',
    account: {
      accountKey: 'fictional-account-001',
      token: 'fictional-secret-token',
      accessToken: 'fictional-access-token',
    },
    request: {
      headers: {
        Cookie: 'fictional_session=fake-cookie',
        Authorization: 'Bearer fictional-credential',
        'X-Signature': 'fictional-signature',
        Accept: 'application/json',
      },
      body: {
        xsec_token: 'fictional-xsec-token',
        _tb_token_: 'fictional-tb-token',
        pageNum: 1,
      },
    },
  };

  const sanitized = sanitizeSensitiveData(input);
  const serialized = JSON.stringify(sanitized);

  assert.equal(sanitized.noteId, 'fictional-note-001');
  assert.equal(sanitized.request.headers.Accept, 'application/json');
  assert.equal(sanitized.request.body.pageNum, 1);
  assert.doesNotMatch(
    serialized,
    /fictional-secret-token|fictional-access-token|fake-cookie|fictional-credential|fictional-signature|fictional-xsec-token|fictional-tb-token/
  );
  assert.equal(input.account.token, 'fictional-secret-token', 'input must not be mutated');
});

test('removes sensitive parameters from signed URLs while preserving safe parameters', () => {
  const input = {
    reportUrl: 'https://api.example/report?noteId=fictional-note-002&xsec_token=fictional-xsec&x-s=fictional-xs&xsign=fictional-xsign&sign=fictional-signature&pageNum=2',
    nested: [
      'https://ads.example/data?advertiserId=fictional-advertiser-001&access_token=fictional-access',
      'plain fictional text',
    ],
  };

  const sanitized = sanitizeSensitiveData(input);

  assert.match(sanitized.reportUrl, /^https:\/\/api\.example\/report\?/);
  assert.match(sanitized.reportUrl, /noteId=fictional-note-002/);
  assert.match(sanitized.reportUrl, /pageNum=2/);
  assert.doesNotMatch(
    sanitized.reportUrl,
    /xsec_token|x-s=|xsign=|sign=|fictional-xsec|fictional-xs|fictional-xsign|fictional-signature/
  );
  assert.match(sanitized.nested[0], /advertiserId=fictional-advertiser-001/);
  assert.doesNotMatch(sanitized.nested[0], /access_token|fictional-access/);
  assert.equal(sanitized.nested[1], 'plain fictional text');
});

test('removes XHS signature aliases and secret-value keys and redacts the full Bearer credential', () => {
  const input = {
    trace: {
      'X-S': 'fictional-xs-header-secret',
      xsign: 'fictional-xsign-header-secret',
      secretValue: 'fictional-secret-value',
      clientSecretValue: 'fictional-client-secret-value',
      safeLabel: 'fictional-safe-label',
    },
    message: 'request failed; Authorization: Bearer fictional-bearer-credential; retry later',
    safeText: 'secretary=fictional campaign role (not a credential)',
  };

  const sanitized = sanitizeSensitiveData(input);
  const serialized = JSON.stringify(sanitized);

  assert.deepEqual(sanitized.trace, { safeLabel: 'fictional-safe-label' });
  assert.match(sanitized.message, /request failed/);
  assert.match(sanitized.message, /retry later/);
  assert.doesNotMatch(serialized, /fictional-xs-header-secret|fictional-xsign-header-secret/);
  assert.doesNotMatch(serialized, /fictional-secret-value|fictional-client-secret-value/);
  assert.doesNotMatch(serialized, /fictional-bearer-credential/);
  assert.equal(sanitized.safeText, input.safeText);
});

test('does not leak secret values through errors or checkpoint metadata', () => {
  const input = {
    status: 'partial',
    errors: [{
      code: 'fictional_request_failed',
      message: 'request failed',
      requestUrl: 'https://star.example/orders?pageNo=3&_tb_token_=fictional-tb-token&signature=fictional-signature',
      responseHeaders: {
        'Set-Cookie': 'fictional_session=fake-cookie',
      },
    }],
    checkpoints: [{
      nextPage: 3,
      fingerprint: 'fictional-safe-query-fingerprint',
      authToken: 'fictional-auth-token',
    }],
  };

  const sanitized = sanitizeSensitiveData(input);
  const serialized = JSON.stringify(sanitized);

  assert.match(serialized, /fictional_request_failed/);
  assert.match(serialized, /fictional-safe-query-fingerprint/);
  assert.doesNotMatch(
    serialized,
    /fictional-tb-token|fictional-signature|fake-cookie|fictional-auth-token|_tb_token_|signature=/
  );
});

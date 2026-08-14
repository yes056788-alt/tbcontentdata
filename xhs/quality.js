(function initXhsQuality(root, factory) {
  const contract = typeof module === 'object' && module.exports
    ? require('./contract')
    : root.XhsContract;
  const api = factory(contract);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsQuality = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsQuality(contract) {
  'use strict';

  if (!contract) throw new Error('XhsContract must be loaded before XhsQuality');

  const REQUIRED_PLATFORMS = Object.freeze(['pgy', 'juguang', 'adstar']);
  const READY_STATUSES = new Set(['complete', 'verified_no_spend']);

  function sanitizedList(value) {
    return Array.isArray(value) ? contract.sanitizeSensitiveData(value) : [];
  }

  function derivePlatformStatus(evidence) {
    const source = evidence && typeof evidence === 'object' ? evidence : {};
    const errors = sanitizedList(source.errors);
    const warnings = sanitizedList(source.warnings);
    const truncation = source.truncation && typeof source.truncation === 'object'
      ? source.truncation
      : {};
    const activeLimits = Object.keys(truncation).filter((limit) => truncation[limit] === true);
    for (const limit of activeLimits) {
      warnings.push({
        code: `truncated_${limit}`,
        limit,
        message: `Collection was truncated by ${limit}`,
      });
    }

    const nested = Array.isArray(source.nested) ? contract.sanitizeSensitiveData(source.nested) : [];
    for (const unit of nested) {
      if (unit && READY_STATUSES.has(String(unit.status || ''))) continue;
      errors.push({
        code: 'nested_unit_incomplete',
        unitType: unit && unit.type || 'unknown',
        unitId: unit && unit.id == null ? null : String(unit.id),
        status: unit && unit.status || 'missing',
        message: 'Required nested collection unit is incomplete',
      });
    }

    const truncated = activeLimits.length > 0;
    const receivedCount = Math.max(0, Number(source.receivedCount) || 0);
    const schemaValid = source.schemaValid === true;
    const paginationComplete = source.paginationComplete === true;
    const reconciled = source.reconciled === true;
    const completeEvidence = schemaValid && paginationComplete && reconciled && !truncated && errors.length === 0;
    let status;

    if (source.cancelled === true) {
      status = 'cancelled';
    } else if (completeEvidence && source.zeroSpendVerified === true && receivedCount === 0) {
      status = 'verified_no_spend';
    } else if (completeEvidence) {
      status = 'complete';
    } else if (!schemaValid && receivedCount === 0) {
      status = 'failed';
    } else {
      status = 'partial';
    }

    return {
      platform: String(source.platform || ''),
      accountKey: source.accountKey == null ? '' : String(source.accountKey),
      dateRange: contract.sanitizeSensitiveData(source.dateRange || null),
      status,
      schemaValid,
      paginationComplete,
      reconciled,
      receivedCount,
      zeroSpendVerified: source.zeroSpendVerified === true,
      truncated,
      truncation: contract.sanitizeSensitiveData(truncation),
      nested,
      warnings,
      errors,
    };
  }

  function rangeFingerprint(value) {
    if (!value || typeof value !== 'object') return '';
    return [value.from || '', value.to || '', value.timezone || ''].join('|');
  }

  function evaluateDecisionReadiness(platforms) {
    const source = platforms && typeof platforms === 'object' ? platforms : {};
    const issues = [];
    let expectedRange = '';

    for (const platform of REQUIRED_PLATFORMS) {
      const evidence = source[platform];
      if (!evidence) {
        issues.push({
          severity: 'critical',
          code: 'platform_missing',
          platform,
          message: `Required platform is missing: ${platform}`,
        });
        continue;
      }
      if (!READY_STATUSES.has(String(evidence.status || ''))) {
        issues.push({
          severity: 'critical',
          code: 'platform_incomplete',
          platform,
          status: evidence.status || 'missing',
          message: `Required platform is not complete: ${platform}`,
        });
      }
      const currentRange = rangeFingerprint(evidence.dateRange);
      if (!currentRange) {
        issues.push({
          severity: 'critical',
          code: 'date_range_missing',
          platform,
          message: `Date range is missing: ${platform}`,
        });
      } else if (!expectedRange) {
        expectedRange = currentRange;
      } else if (currentRange !== expectedRange) {
        issues.push({
          severity: 'critical',
          code: 'date_range_mismatch',
          platform,
          message: `Date range does not match the other platforms: ${platform}`,
        });
      }
    }

    const sanitizedIssues = contract.sanitizeSensitiveData(issues);
    return {
      decisionReady: !sanitizedIssues.some((item) => item.severity === 'critical'),
      issues: sanitizedIssues,
      requiredPlatforms: REQUIRED_PLATFORMS.slice(),
    };
  }

  return Object.freeze({
    REQUIRED_PLATFORMS,
    derivePlatformStatus,
    evaluateDecisionReadiness,
  });
});

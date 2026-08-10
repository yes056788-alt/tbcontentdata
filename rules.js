// rules.js - 衍生指标计算规则
// 支持两种数据来源：Excel 导出列名 / mtop API 字段名

const FIELD_ALIASES = {
  // 处理括号全半角、空格等差异
  '次均停留时长(秒)': ['次均停留时长(秒)', '次均停留时长（秒）'],
};

function normalizeKey(key) {
  return String(key).trim()
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/\s+/g, '');
}

function buildFieldMap(row) {
  const map = {};
  for (const [k, v] of Object.entries(row)) {
    map[normalizeKey(k)] = v;
  }
  return map;
}

function safeDiv(a, b, multiplier = 1) {
  const numA = parseMetricNumber(a) || 0;
  const numB = parseMetricNumber(b) || 0;
  if (numB === 0) return null;
  return (numA / numB) * multiplier;
}

function apiFieldRawValue(value) {
  if (value && typeof value === 'object') {
    const keys = ['absolute', 'value', 'currentValue', 'indicatorValue', 'metricValue', 'absoluteFormat'];
    for (const key of keys) {
      if (value[key] != null) return value[key];
    }
  }
  return value;
}

function parseMetricNumber(value) {
  const raw = apiFieldRawValue(value);
  const text = String(raw == null ? '' : raw).replace(/[¥￥,\s，]/g, '');
  const match = text.match(/^(-?(?:\d+\.?\d*|\.\d+))(万|亿)?$/);
  if (!match) return null;
  const unit = match[2] === '亿' ? 100000000 : match[2] === '万' ? 10000 : 1;
  const number = Number(match[1]) * unit;
  return Number.isFinite(number) ? number : null;
}

// 计算单条视频的 8 个指标
function calcMetrics(row) {
  const f = buildFieldMap(row);

  const 曝光次数 = f['曝光次数'];
  const 点击次数 = f['点击次数'];
  const 查看次数 = f['查看次数'];
  const 有效查看次数 = f['有效查看次数'];
  const 总停留时长原值 = f['总停留时长(秒)'];
  const _次均原值 = f['次均停留时长(秒)'];
  const 次均停留时长 = (_次均原值 !== '' && _次均原值 != null) ? parseMetricNumber(_次均原值) : null;
  const 商品引导点击次数 = f['商品引导点击次数'];
  const 商品点击次数 = f['商品点击次数'];
  const 种草成交订单数 = f['种草成交订单数'];
  const 种草成交金额 = f['种草成交金额'];
  const 查看次数数值 = parseMetricNumber(查看次数) || 0;
  const 总停留时长 = (总停留时长原值 !== '' && 总停留时长原值 != null)
    ? (parseMetricNumber(总停留时长原值) || 0)
    : (次均停留时长 === null ? null : 次均停留时长 * 查看次数数值);

  return {
    raw_曝光次数: parseMetricNumber(曝光次数) || 0,
    raw_查看次数: 查看次数数值,
    raw_点击次数: (点击次数 !== '' && 点击次数 != null) ? (parseMetricNumber(点击次数) || 0) : null,
    raw_有效查看次数: (有效查看次数 !== '' && 有效查看次数 != null) ? (parseMetricNumber(有效查看次数) || 0) : null,
    raw_总停留时长: 总停留时长,
    raw_大点击: (商品引导点击次数 !== '' && 商品引导点击次数 != null) ? (parseMetricNumber(商品引导点击次数) || 0) : null,
    raw_小点击: (商品点击次数 !== '' && 商品点击次数 != null) ? (parseMetricNumber(商品点击次数) || 0) : null,
    raw_种草成交订单数: (种草成交订单数 !== '' && 种草成交订单数 != null)
      ? (parseMetricNumber(种草成交订单数) || 0)
      : null,
    raw_种草成交金额: parseMetricNumber(种草成交金额) || 0,
    raw_累计过审数: null,
    raw_新增过审数: null,
    曝光点击率: safeDiv(点击次数, 曝光次数),
    有效查看率: safeDiv(有效查看次数, 查看次数),
    次均停留时长: 次均停留时长,
    大点击率: safeDiv(商品引导点击次数, 查看次数),
    小点击率: safeDiv(商品点击次数, 查看次数),
    有效查看转化率: safeDiv(种草成交订单数, 有效查看次数),
    千次查看成交金额: safeDiv(种草成交金额, 查看次数, 1000),
    千次有效查看金额: safeDiv(种草成交金额, 有效查看次数, 1000),
  };
}

const METRIC_DEFS = [
  { key: 'raw_累计过审数',   label: '累计过审数',       goal: null,  goalLabel: '',       format: 'num',   productOnly: true },
  { key: 'raw_新增过审数',   label: '新增过审数',       goal: null,  goalLabel: '',       format: 'num',   productOnly: true },
  { key: 'raw_曝光次数',     label: '曝光次数',         goal: null,  goalLabel: '',       format: 'num',   productOnly: false },
  { key: 'raw_查看次数',     label: '查看次数',         goal: null,  goalLabel: '',       format: 'num',   productOnly: false },
  { key: 'raw_大点击',       label: '大点击',           goal: null,  goalLabel: '',       format: 'num',   productOnly: false },
  { key: 'raw_小点击',       label: '小点击',           goal: null,  goalLabel: '',       format: 'num',   productOnly: false },
  { key: 'raw_种草成交金额', label: '种草成交金额',     goal: null,  goalLabel: '',       format: 'money', productOnly: false },
  { key: '曝光点击率',     label: '曝光点击率',       goal: 0.03,  goalLabel: '≥3%',    format: 'pct',   productOnly: false },
  { key: '有效查看率',     label: '有效查看率',       goal: 0.40,  goalLabel: '≥40%',   format: 'pct',   productOnly: false },
  { key: '次均停留时长',   label: '次均停留时长',     goal: 6,     goalLabel: '≥6秒',   format: 'sec',   productOnly: false },
  { key: '大点击率',       label: '大点击率',         goal: 0.05,  goalLabel: '≥5%',    format: 'pct',   productOnly: false },
  { key: '小点击率',       label: '小点击率',         goal: 0.01,  goalLabel: '≥1%',    format: 'pct',   productOnly: false },
  { key: '有效查看转化率', label: '有效查看转化率',   goal: null,  goalLabel: '',        format: 'pct',   productOnly: false },
  { key: '千次查看成交金额',   label: '千次查看成交金额',   goal: null, goalLabel: '', format: 'money', productOnly: false },
  { key: '千次有效查看金额',   label: '千次有效查看金额',   goal: null, goalLabel: '', format: 'money', productOnly: false },
];

function isGoalMet(def, value) {
  if (value === null) return null;
  if (def.goalMin !== undefined) return value >= def.goalMin && value <= def.goalMax;
  if (def.goal !== null) return value >= def.goal;
  return null;
}

function formatValue(def, value) {
  if (value === null || value === undefined) return '—';
  if (def.format === 'pct') return (value * 100).toFixed(2) + '%';
  if (def.format === 'sec') return value.toFixed(1) + 's';
  if (def.format === 'money') return '¥' + value.toFixed(0);
  if (def.format === 'num') return Number(value).toLocaleString();
  return value;
}

// 商品分析（内容消费 + 内容供给合并）API 字段映射
function calcMetricsFromProductAPI(apiRow, supplyRow) {
  function val(row, field) {
    if (!row) return '';
    const v = row[field];
    if (v == null) return '';
    const raw = apiFieldRawValue(v);
    return raw == null ? '' : raw;
  }

  const metrics = calcMetrics({
    '曝光次数':         val(apiRow, 'expoPv'),
    '点击次数':         val(apiRow, 'clickPv'),
    '查看次数':         val(apiRow, 'consumePv'),
    '有效查看次数':     val(apiRow, 'consumePvValid'),
    '总停留时长(秒)':   val(apiRow, 'consumeTime'),
    '次均停留时长(秒)': val(apiRow, 'consumeTimeAvgPv'),
    // 业务口径：大点击取商品引导点击次数 ipvPv，小点击取商品点击次数 detailIpvPv。
    '商品引导点击次数': val(apiRow, 'ipvPv'),
    '商品点击次数':     val(apiRow, 'detailIpvPv'),
    '种草成交订单数':   val(apiRow, 'payOrderCntZcLast'),
    '种草成交金额':     val(apiRow, 'payAmtZcLast'),
  });

  const totalCnt = val(supplyRow, 'totalPublishPubContentCnt');
  const newCnt = val(supplyRow, 'publishPubContentCnt');
  metrics.raw_累计过审数 = (totalCnt !== '') ? (parseMetricNumber(totalCnt) || 0) : null;
  metrics.raw_新增过审数 = (newCnt !== '') ? (parseMetricNumber(newCnt) || 0) : null;

  return metrics;
}
// API 字段值结构：{ absolute: "1234" }，需先取 .absolute
function calcMetricsFromAPI(apiRow) {
  function val(field) {
    const v = apiRow[field];
    if (v == null) return '';
    // API 字段值是 { absolute: "xxx" } 或直接是数值
    const raw = apiFieldRawValue(v);
    return raw == null ? '' : raw;
  }

  const row = {
    '曝光次数':         val('expoPv'),
    '点击次数':         val('clickPv'),
    '查看次数':         val('consumePv'),
    '有效查看次数':     val('consumePvValid'),
    '总停留时长(秒)':   val('consumeTime'),
    '次均停留时长(秒)': val('consumeTimeAvgPv'),
    // 业务口径：大点击取商品引导点击次数 ipvPv，小点击取商品点击次数 detailIpvPv。
    '商品引导点击次数': val('ipvPv'),
    '商品点击次数':     val('detailIpvPv'),
    '种草成交订单数':   val('payOrderCntZcLast'),
    '种草成交金额':     val('payAmtZcLast'),
  };

  return calcMetrics(row);
}

# 小红书三平台数据契约

本文档定义淘宝星河（`adstar`）、蒲公英（`pgy`）和聚光（`juguang`）在扩展内部共享的最小契约。采集器可以保留平台特有字段，但状态、分页、账号、日期和质量信息必须遵循本契约。

## 平台状态

| 状态 | 含义 |
| --- | --- |
| `running` | 任务正在运行，不能用于分析决策 |
| `complete` | 必需响应结构、分页、嵌套单元和对账全部完成 |
| `partial` | 有可用数据，但存在截断、分页/嵌套失败或对账缺口 |
| `failed` | 没有可用数据，或响应结构已经无法识别 |
| `cancelled` | 用户取消，已提交的完整页可用于恢复但不能用于决策 |
| `verified_no_spend` | 聚光账户身份和汇总请求成功，并确认周期消耗为零 |

`complete` 不由接口调用成功单独决定。任何 `maxPages`、`maxOrders`、`maxProjects` 限制都必须标记 `truncated=true` 并降级为 `partial`。星河任一相关项目或订单的必需子数据集未完成时，父平台也必须为 `partial`。

## 平台证据

```js
{
  platform: 'pgy',
  accountKey: '不可逆账号标识',
  dateRange: {
    from: '2030-01-01',
    to: '2030-01-30',
    timezone: 'Asia/Shanghai'
  },
  schemaValid: true,
  paginationComplete: true,
  reconciled: true,
  receivedCount: 120,
  truncation: {},
  nested: [],
  warnings: [],
  errors: []
}
```

`accountKey` 只用于隔离缓存和核对运行身份，不能包含用户名、手机号、广告账户名称、Cookie 或 Token。显示名称应作为单独的脱敏字段处理。

## 响应结构门禁

- 蒲公英分页必须存在 `data.list`、`pageNum`、`pageSize`、`total` 和 `totalPage`。
- 聚光分页必须存在 `data.dataList` 以及完整的 `data.page`。
- 星河分页必须存在 `model.result`、页码、页大小、总数、总页数和 `hasNext`。
- 缺少列表字段不能解释为“成功的空列表”；只有结构完整且平台明确返回零条时才是合法空结果。
- 平台返回失败 code、`success=false` 或 HTTP 错误时，必须保留脱敏后的错误 code，并由状态机决定 `partial/failed`。

## `decisionReady`

以下条件同时满足时才能为 `true`：

1. 三个平台均存在。
2. 每个平台状态是 `complete`；聚光允许 `verified_no_spend`。
3. 三个平台日期范围和时区一致。
4. 后续分析门禁确认账号与店铺绑定一致、关键金额对账通过。

缺平台、partial、failed、cancelled、日期错位、身份错位或关键对账失败都产生 critical issue。

## 敏感信息

写入 checkpoint、日志、错误、分析快照或归档前必须递归清除：

- Cookie、Authorization、密码和会话字段。
- 名称中包含 `token` 的字段，包括 `_tb_token_`、`xsec_token`、`accessToken`。
- `sign/signature` 及签名 URL 中对应查询参数。
- 平台原始请求头和无分析价值的签名媒体 URL。

分页块只保存在扩展本机 IndexedDB；`xhsAnalysisSnapshotV1` 和 `xhsCollectionStatusV1` 才能进入现有归档与云同步。

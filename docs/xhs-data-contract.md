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

### 聚光账户终态与并发

聚光账号清单中的每个账户只有以下三种完整终态：

- `complete`：周期内有花费，笔记汇总、日明细和花费对账完整；
- `verified_no_spend`：本次实时校验身份并确认周期花费为 0；
- `cached_no_spend`：同一店铺、账户、日期范围和归因口径命中未过期的本机零花费证明。证明默认有效 6 小时，过期后必须重新实时验证。

聚光默认单标签顺序扫描。调用方显式传入 `concurrentAccountTabs: 2` 或 `3` 才尝试多标签加速：临时标签必须先切换到不同子账户，并连续通过 `advertiserId`、`accountType` 和 `vSellerId` 隔离校验；每次报表请求前后都重新校验身份。任何身份漂移会中止临时标签、废弃本次并发结果并在原标签顺序重采。临时标签无论成功、失败或取消都必须关闭。

淘宝星河保留项目层原生接口数据，项目采集仍为顺序执行；任务单元默认按 `taskConcurrency: 4` 限流并发（允许 3～5），单个任务内部的汇总和明细请求仍保持顺序，输出顺序与任务清单一致。

三平台外层始终通过独立任务并行执行；任一平台失败只影响自身结果，不得取消或覆盖另外两个平台。

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

报告页中的淘宝星河、蒲公英和聚光三份平台报告是上述同一份 `xhsAnalysisSnapshotV1` 的视图投影，不新增快照键，不在平台采集完成时提前生成单路报告。

## 报告 V3 事实口径

- 蒲公英 `notes.sum` 与 `notes.list` 不下发任务日期，必须分页采集账号全部可用笔记。采集结果记录 `collectionScope: "all_available"`、`latestPublishDate` 和 `finishedAt`；原任务 `dateRange` 仅是三源对齐和报告默认发布日期范围。
- 新快照在 `pgy.facts` 保留紧凑的笔记、SPU、作者粉丝数、费用和内容指标。报告筛选只从该归档事实调用共享 `aggregatePgyFacts`重算，不重新请求平台；旧归档无事实时保留原汇总但禁用动态日期和 SPU 筛选。
- 蒲公英原始行的“淘宝任务 ID”必须取 `starData.thirdBriefId`，归一为不透明字符串 `taobaoTaskId`；笔记行 `thirdBriefEndTime` 非空时直接归一为 `taskEndDate`，为空时必须完整分页采集蒲公英跨域项目报告，并按笔记 `thirdProjectId` = 项目 `projectId` 使用 `taobaoBriefEndTime` 回填。该过程只使用蒲公英数据，不关联星河。`starTaskNo` 不是淘宝任务 ID，不得代替。
- 蒲公英笔记行的 SPU 取官方 `spuId` / `spuName`，归一为 `spus: [{ id, name }]`；同一笔记兼容多 SPU 返回并在报告页按 SPU 本地过滤。
- `starTaskNoteCount` 只统计发布日期与 SPU 筛选内 `taobaoTaskId` 非空的蒲公英笔记；`overdueNoteCount` 只统计 `taskEndDate` 严格早于蒲公英实际采集完成日（Asia/Shanghai）的笔记。两个指标不依赖星河是否被选中、成功或完整。
- 聚光日事实使用真实 `placementType` 作为投放位置维度；旧 `deliveryMode` 可保留以兼容归档，但绝不能重命名或回填为投放位置。
- 产品种草的 `seedingExternal15` 来自 `outSideSellerPv15d`、`outSideSellerPvRate15dNew` 和 `outSideSellerPvfee15d`。三项齐全才可观测；聚合站外行为成本只能用“产品种草消耗合计 / 15 日非去重站外活跃 UV 合计”重算。任一种草行缺字段时 UV/成本为 `null`，零分母时成本为 `null`；种草直达的 15 日进店、订单、GMV 和 ROI 独立计算。
- 星河项目和任务只展示对应层的原生汇总与上卷费用，不展开笔记明细；项目/任务分析都支持项目、任务联动筛选。独立笔记浏览器的总花费、任务期内、任务期外和进店成本必须从基础事实重算，不信任与新口径冲突的旧汇总列；笔记标题只可跳转到小红书一方详情页。

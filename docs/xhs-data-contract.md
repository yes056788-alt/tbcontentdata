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

### 任务页所有权

单店任务每次为选中的淘宝星河、蒲公英和聚光各创建一个官方入口任务页。新页共享当前 Chrome Cookie：已登录时直接预检并采集；未登录时只在该页完成账号库登录或人工登录/验证，返回对应产品来源后继续。`taskOwnedTabIds` 从登录准备贯穿到采集运行时，页面桥恢复不得重新扫描或切换到其他同源页。

可关闭页面的所有权必须与采集固定页分开记录。任务成功、失败或取消并排空在途采集后，只能关闭本次任务明确创建的页；用户原有页永不关闭。没有内部任务页所有权证据时，如果发现多个同源页，运行时继续 fail closed，网页消息也不得注入 `taskOwnedTabIds` 绕过该边界。

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

唯一例外是蒲公英 `content_note_download_task` 官方导出结果中的笔记访问链接。该链接只允许
`https://www.xiaohongshu.com/explore/{noteId}`，路径 `noteId` 必须与事实行一致，查询参数必须且只能为
`xsec_token` 与 `xsec_source=pc_pgyexport`。导出结果文件 URL、长任务 `taskId`、其他域名/路径/来源的
签名 URL 仍只在内存中使用并禁止进入 checkpoint、日志和分析快照。

分页块只保存在扩展本机 IndexedDB；`xhsAnalysisSnapshotV1` 和 `xhsCollectionStatusV1` 才能进入现有归档与云同步。

报告页中的淘宝星河、蒲公英和聚光三份平台报告是上述同一份 `xhsAnalysisSnapshotV1` 的视图投影，不新增快照键，不在平台采集完成时提前生成单路报告。

## 报告 V3 事实口径

- 蒲公英 `notes.sum` 与 `notes.list` 不下发任务日期，必须分页采集账号全部可用笔记。采集结果记录 `collectionScope: "all_available"`、`latestPublishDate` 和 `finishedAt`；原任务 `dateRange` 仅是三源对齐和报告默认发布日期范围。
- 新快照在 `pgy.facts` 保留紧凑的笔记、SPU、作者粉丝数、费用和内容指标。报告筛选只从该归档事实调用共享 `aggregatePgyFacts`重算，不重新请求平台；旧归档无事实时保留原汇总但禁用动态日期和 SPU 筛选。
- 蒲公英笔记分页完成后，保留账号全部可用笔记事实，但只对本次报告发布日期范围内的笔记以最多 4 路并发调用固定 GET `notes.searchKeywords`（`/api/solar/trade/note/search_keyword_data`），避免账号全历史逐篇补采挤占预算。查询参数只允许 `noteId` 与 `orderCategory`；原始行缺少 `orderCategory` 时按蒲公英搜索词接口的默认类别 `"0"` 发送。每篇保留平台响应中的全部可识别搜索词紧凑事实，并按曝光稳定排序：`searchKeywords: [{ keyword, searchScore?, impressions, reads, clickRate }]`；`searchScore` 只能来自平台原始同名字段，缺失时保持缺失，不得用阅读量或其他指标推算。不得在采集层固定截断为前 20 词。`searchKeywordFetchStatus: "complete" | "empty" | "failed"` 区分有数据、成功空结果与失败。失败行另保留受限的 `searchKeywordErrorCode`，覆盖信息汇总 `failureCodeCounts`；HTTP 429、500 及明确限流语义在受控退避内可重试。搜索词属于非关键增强：整批默认共享 2 分钟时间预算，预算到期后剩余笔记立即标记 `failed` 并返回核心报告；单篇失败只产生覆盖警告，不得把已完整对账的费用和核心内容指标降级。
- 蒲公英报告的“搜索来源关键词（全部词）”只聚合当前发布日期、SPU 与跨域项目筛选内的事实：同词曝光和阅读分别求和，点击率按 `总阅读 / 总曝光` 重算，搜索热度仅显示一致的平台 `searchScore`，缺失或冲突显示 `-`，再按曝光、阅读和关键词稳定排序；聚合结果默认全部展示，不在 1000 词处截断。主表表头支持商业分类、品类相关度和搜索意图三维 AND 筛选，三张分类表中的标签按钮与对应表头下拉双向联动；区块顶部的总搜索词数、笔记数、曝光量、阅读量和点击率指标卡，以及每张表首行，都必须按当前筛选结果重新聚合，笔记数按非空 `noteId` 去重，不能只隐藏明细行或平均关键词点击率。覆盖率为 `(complete + empty) / 当前筛选笔记数`；`failed` 与缺少新增字段的旧归档不计为已覆盖，报告不得把旧归档显示成成功但无关键词。在线报告与离线 HTML 导出均只使用归档事实，不回捞平台，并保持相同筛选状态与行业模板。
- 搜索词报告通过共享行业模板引擎派生商业分类、品类相关度与搜索意图。内置 `sheba-cat-food-v1`（宠物食品兼容）、`home-furnishing-v1`（家具家居）、`health-supplements-v1`（营养保健）与 `cross-industry-generic-v1`（通用保守兜底）。引擎优先接受明确 `profileId`，否则用全量归档事实中的 SPU、笔记标题和搜索词自动选择模板，低置信度时进入通用模板；选定的模板在日期、SPU 和跨域项目筛选期间保持稳定，避免分类口径随样本变化。SPU 名称作为当次自有产品词；模板保留规则版本、选择方式、置信度和证据。三类汇总的点击率统一按组内 `总阅读 / 总曝光` 重算；每个关键词保留按曝光贡献排序的笔记清单，在线与离线报告都可下钻。分类属于展示派生值，词典升级不要求重新抓取原始搜索词事实。
- 蒲公英笔记链接不再按 `noteId` 拼裸 `/explore/` 地址。采集器用当前品牌与任务日期提交 `/api/solar/common/long_task/task/submit`（`taskName: content_note_download_task`），轮询 `/status` 至状态 3，再从 `/result` 取得结果文件并在页面内存中下载解析；结果下载与 XLSX 解析使用独立三分钟桥接预算、64 MiB 文件上限和 XLSX 文件头校验。同源 PGY 文件携带当前会话，跨域签名文件不携带会话凭据。工作簿有独立笔记 ID 列时必须与链接路径一致；只有链接列时从已验证的 `/explore/{noteId}` 路径提取 ID。只有通过上述官方链接白名单的行才按 `noteId` 回填。导出或解析失败只产生链接覆盖警告并让标题保持不可点击，不得降级已经对账完成的核心业务数据。
- 蒲公英原始行的“淘宝任务 ID”必须取 `starData.thirdBriefId`，归一为不透明字符串 `taobaoTaskId`；笔记行 `thirdBriefEndTime` 非空时直接归一为 `taskEndDate`，为空时必须完整分页采集蒲公英跨域项目报告，并按笔记 `thirdProjectId` = 项目 `projectId` 使用 `taobaoBriefEndTime` 回填。该过程只使用蒲公英数据，不关联星河。`starTaskNo` 不是淘宝任务 ID，不得代替。
- 蒲公英笔记行的 SPU 取官方 `spuId` / `spuName`，归一为 `spus: [{ id, name }]`；同一笔记兼容多 SPU 返回并在报告页按 SPU 本地过滤。
- `starTaskNoteCount` 只统计发布日期与 SPU 筛选内 `taobaoTaskId` 非空的蒲公英笔记；`overdueNoteCount` 只统计 `taskEndDate` 严格早于蒲公英实际采集完成日（Asia/Shanghai）的笔记。两个指标不依赖星河是否被选中、成功或完整。
- 聚光日事实使用真实 `placementType` 作为投放位置维度；旧 `deliveryMode` 可保留以兼容归档，但绝不能重命名或回填为投放位置。
- 产品种草的 `seedingExternal15` 来自 `outSideSellerPv15d`、`outSideSellerPvRate15dNew` 和 `outSideSellerPvfee15d`。三项齐全才可观测；聚合站外行为成本只能用“产品种草消耗合计 / 15 日非去重站外活跃 UV 合计”重算。任一种草行缺字段时 UV/成本为 `null`，零分母时成本为 `null`；种草直达的 15 日进店、订单、GMV 和 ROI 独立计算。
- 星河项目和任务只展示对应层的原生汇总与上卷费用，不展开笔记明细；项目/任务分析都支持项目、任务联动筛选。独立笔记浏览器的总花费、任务期内、任务期外和进店成本必须从基础事实重算，不信任与新口径冲突的旧汇总列；笔记标题只可跳转到小红书一方详情页。

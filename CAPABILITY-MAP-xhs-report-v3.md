# Capability Map: 小红书经营报告 v3

状态：2026-08-24 用户已批准。

| Module id | Responsibility | Depends on |
| --- | --- | --- |
| `pgy-latest-snapshot` | 蒲公英采集全部可用笔记，报告按发布日期动态聚合 | — |
| `juguang-placement-metrics` | 聚光按投放位置拆分，补产品种草 15 日站外行为与计算成本 | — |
| `star-rollup` | 保留既有三源费用对齐，只展示项目与任务汇总 | `pgy-latest-snapshot`, `juguang-placement-metrics` |
| `note-explorer` | 按项目、任务、发布日期筛选笔记，计算费用并提供 Top20/查看更多 | `star-rollup` |

构建顺序：`pgy-latest-snapshot`、`juguang-placement-metrics` → `star-rollup` → `note-explorer`。

共同口径：

- “星河任务”对应现有星河业务订单；旧归档里的“订单”仍可读取。
- 达人花费只计入报告所选发布日期内蒲公英合作实付与平台服务费。
- 聚光任务期内外继续按笔记关联的星河任务起止日期逐日判断。
- 笔记总花费 = 本期达人花费 + 聚光全部花费。
- 笔记任务期内花费 = 本期达人花费 + 聚光任务期内花费。
- 笔记任务期外花费 = 聚光任务期外花费。
- 笔记进店成本 = 任务期内花费 / 星河进店 UV；分母为 0 或证据缺失时为未知。

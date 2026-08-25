# Spec: juguang-placement-metrics

## Objective

把聚光报告的第三个分析维度从真实的“投放模式”迁移为真实“投放位置”，并为产品种草增加 15 日站外行为及按聚合消耗重算的站外行为成本。

## Tech Stack

沿用聚光 `reports.query`、XHS 分析快照、共享报告模型和 `node:test`。

## Commands

- Focused: `node --test tests/xhs-juguang-collector.test.js tests/xhs-juguang-report-v2.test.js tests/xhs-report-ui-v2.test.js`
- Full: `node --test tests/*.test.js`
- Syntax: `node --check xhs/juguang-collector.js && node --check xhs/analysis.js && node --check xhs/report-model.js && node --check web-tool/report.js`

## Project Structure

- `xhs/juguang-collector.js`: `placementType` 与产品种草站外字段请求
- `xhs/analysis.js`: 位置、站外行为事实和可观察性
- `xhs/report-model.js`: 位置筛选/分组及站外行为聚合
- `web-tool/report.js`: 控件、表格和兼容提示
- `diagnosis-popup.js`: 默认导出口径兼容

## Code Style

```js
const calculatedCost = activeUv > 0 ? seedingSpend / activeUv : null;
```

所有比率由可加总的分子/分母重算；不平均平台成本字段。

## Testing Strategy

- RED 校验请求使用 `placementType`，不把 `deliveryMode` 值伪装为位置。
- 覆盖完整、缺失、零分母、直达隔离和旧归档场景。
- 真实“梦想家”请求确认 `placementType` 可拆分及返回值映射后才宣称完成。

## Boundaries

- Always: 15 日归因窗口；产品种草使用 `outSideSellerPv15d` 不去重站外活跃 UV。
- Ask first: 若平台不支持 `placementType` 拆分，需要改变业务维度。
- Never: 沿用 0/1 手动/自动中文映射作为投放位置；把缺失指标当作 0。

## Success Criteria

- 新采集日报含 `placementType`，报告可按账户/营销诉求/投放位置筛选和 1–3 层分组。
- 产品种草输出消耗、15 日站外活跃 UV 和 `消耗 / UV` 计算成本。
- 任一产品种草行缺站外字段时聚合状态为 partial，UV 与成本为未知。
- 种草直达现有 15 日进店、订单、GMV、ROI 口径不变。
- 旧归档不误标位置，明确显示缺少新维度。

## Open Questions

无；`placementType` 枚举中文由真实响应确定，未知值按原值安全展示。

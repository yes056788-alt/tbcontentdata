# Spec: star-rollup

## Objective

星河报告保留全店、任务、项目和任务级原生汇总与既有三源成本口径，但项目/任务区域不再展开笔记明细。业务订单在新 UI 中称为“任务”。

## Tech Stack

沿用 `xhs/analysis.js` 快照与 `web-tool/report.js` 静态 HTML 渲染。

## Commands

- Focused: `node --test tests/xhs-star-report-v2.test.js tests/xhs-report-ui-v2.test.js`
- Full: `node --test tests/*.test.js`
- Syntax: `node --check xhs/analysis.js && node --check web-tool/report.js`

## Project Structure

- `xhs/analysis.js`: 保留项目/任务汇总和笔记归属键
- `web-tool/report.js`: 项目与任务汇总 UI
- `web-tool/report.css`: 汇总列表响应式样式

## Code Style

复用现有 `xhsStarMetricCards`、`buildXhsStarUnitCosts`，不建立第二套公式。

## Testing Strategy

- 断言项目和任务原生 summary 仍展示。
- 断言项目区域不再渲染任务下的笔记节点。
- 断言旧归档、未验证任务和未关联项目任务仍有清晰空值/状态。

## Boundaries

- Always: 星河指标用对应层原生 summary；达人费和任务期内广告费沿唯一归属笔记上卷。
- Ask first: 删除归档中的层级数据或改变质量门禁。
- Never: 跨层相加 UV、均摊笔记成本、把未验证报表任务当真实业务任务。

## Success Criteria

- 项目和任务均只显示名称、状态、周期、汇总指标与汇总费用。
- 项目区域不展示笔记明细；笔记统一进入独立浏览器。
- 任务期内外聚光费用和按发布日期计入的达人费用保持现有公式。

## Open Questions

无；用户已确认“任务”对应现有星河订单。

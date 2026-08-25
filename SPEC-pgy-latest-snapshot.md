# Spec: pgy-latest-snapshot

## Objective

蒲公英在一次任务中采集当前品牌账号全部可用笔记，以最新采集时点形成事实快照；任务日期只作为蒲公英报告的默认发布日期筛选。用户修改报告日期后，客户端从归档事实重新计算全部蒲公英指标，不重新请求平台。

## Tech Stack

- Chrome MV3 扩展与 MAIN-world 白名单桥
- 浏览器/Node 共用的 CommonJS + IIFE 纯 JavaScript 模块
- Node `node:test` 回归测试

## Commands

- Focused: `node --test tests/xhs-pgy-collector.test.js tests/xhs-pgy-report-v2.test.js tests/xhs-report-ui-v2.test.js`
- Full: `node --test tests/*.test.js`
- Syntax: `node --check xhs/pgy-collector.js && node --check xhs/analysis.js && node --check xhs/report-model.js && node --check web-tool/report.js`

## Project Structure

- `xhs/pgy-collector.js`: 全量分页采集和采集范围元数据
- `xhs/analysis.js`: 紧凑事实投影与默认日期聚合
- `xhs/report-model.js`: 浏览器/Node 共用蒲公英日期聚合纯函数
- `web-tool/report.js`: 日期控件与动态渲染
- `tests/`: 采集、聚合、归档兼容和 UI 测试

## Code Style

```js
const filtered = facts.filter((fact) => dateInRange(fact.publishDate, range));
return aggregatePgyFacts({ facts: filtered, asOf: reportGeneratedDate });
```

保持现有 IIFE、纯函数和显式 `null` 空值语义；不引入依赖。

## Testing Strategy

- RED 证明 `notes.sum/list` 不再发送任务日期限制。
- 纯函数测试发布日期闭区间、费用和内容指标重算。
- UI 测试默认范围、筛选更新及旧归档禁用状态。
- 大数据测试确保紧凑快照不突破 8 MiB。

## Boundaries

- Always: 全分页、数量与费用对账；保留任务 `dateRange` 作为三源分析范围。
- Ask first: 改平台端点、增加依赖或改变 8 MiB 归档门禁。
- Never: 上传原始响应、凭据或浏览器认证材料；把采集时间冒充平台更新时间。

## Success Criteria

- `notes.sum/list` 使用空 `startTime/endTime` 并拉完所有页面。
- 采集结果包含 `collectionScope: "all_available"` 和可证明的最新发布日期/采集时间。
- 快照保留紧凑 `pgy.facts`，默认报告指标与任务原范围口径一致。
- 改变发布日期或 SPU 会重算笔记数、星河任务笔记数、超期笔记数、费用、曝光、阅读、互动、月度和粉丝档。
- 星河任务笔记数仅认蒲公英 `starData.thirdBriefId`；超期仅比较 `thirdBriefEndTime < 蒲公英实际采集完成日`，两者均不关联星河采集结果。
- 旧归档继续显示原汇总，并明确禁用日期筛选。

## Open Questions

无；已由用户确认。

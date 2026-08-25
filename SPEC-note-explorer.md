# Spec: note-explorer

## Objective

将星河笔记联表改为可按项目、任务和发布日期筛选的独立浏览器，显示决策所需费用与进店成本，默认按总花费降序展示 Top20，并支持查看更多和收起。

## Tech Stack

共享 XHS 分析快照、原生 DOM 事件委托、现有报告设计系统和 `node:test`。

## Commands

- Focused: `node --test tests/xhs-report-ui-v2.test.js tests/xhs-web-integration.test.js`
- Full: `node --test tests/*.test.js`
- Syntax: `node --check web-tool/report.js`

## Project Structure

- `xhs/analysis.js`: 笔记项目/任务归属和费用字段
- `web-tool/report.js`: allowlist 筛选、排序、Top20 与查看更多
- `web-tool/report.css`: 控件与宽表响应式样式
- `tests/`: 公式、筛选、排序、空态和键盘交互

## Code Style

```js
const visible = filtered.slice(0, expanded ? filtered.length : 20);
```

使用原生 `<label>`、`<select>`、`<input type="date">` 和 `<button>`，所有控件有可访问名称。

## Testing Strategy

- 纯结果测试费用公式、零分母和未知值。
- UI 测试项目/任务/发布日期组合筛选与选项联动。
- 断言默认 Top20、总花费降序、查看更多/收起及结果计数。
- 浏览器验证桌面、窄屏、键盘和控制台。

## Boundaries

- Always: 只使用已归档事实；筛选不发平台请求。
- Ask first: 改默认排序或把筛选扩展到任务原始采集范围之外。
- Never: 用 0 替代未知费用；把任务期外花费计入进店成本分子。

## Success Criteria

- 项目、任务和发布日期可独立或组合筛选；起止日均包含。
- 总花费、任务期内、任务期外、进店成本按批准公式展示。
- 默认显示总花费 Top20，查看更多展示全部筛选结果，收起恢复 Top20。
- 旧归档缺少归属或费用字段时仍可打开并显示明确空值。

## Open Questions

无；已由用户确认。

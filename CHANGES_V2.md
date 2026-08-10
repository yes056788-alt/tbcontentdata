# 淘宝短视频插件 — 第二轮改造总结

## 时间
2026-07-05

## 改动概览
基于用户测试反馈，实施了4项改进：

| 改动 | 文件 | 行数范围 | 目的 |
|------|------|---------|------|
| 页面检测收紧 | content-script.js | 14-19 | 修复误报（button出现在不该出现的页面） |
| 商品分析前置动作 | content-script.js | 500-511 | 点击"内容消费"tab后再下载 |
| 超时时间扩展 | content-script.js | 557 | 20s → 120s，避免大文件超时 |
| 商品ID天猫链接 | content-script.js | 270-271, 282-299, 679-680 | 作品分析面板新增商品ID列，带天猫链接 |

---

## 详细改动

### 改动 1：页面检测收紧（getPageMode 函数）

**修改前：**
```js
function getPageMode() {
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab === 'singleEffect') return 'content';
  if (tab === 'productAnalysis') return 'product';
  return null;
}
```

**修改后：**
```js
function getPageMode() {
  if (!location.pathname.includes('/page/unify/asset-overview')) return null;
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab === 'singleEffect') return 'content';
  if (tab === 'productAnalysis') return 'product';
  return null;
}
```

**作用：** 确保按钮只在资产总览页面（`/page/unify/asset-overview`）下显示，防止在其他带 tab 参数的页面误显。

---

### 改动 2：商品分析前置点击"内容消费"（autoTriggerDownload 函数）

**在函数开头添加：**
```js
// 商品分析模式：先点击"内容消费"tab 切换到商品维度
if (currentMode === 'product') {
  showProgress(1, 4, '切换到内容消费...');
  const contentConsumeTab = findByText('span', '内容消费') || findByText('div', '内容消费');
  if (contentConsumeTab) {
    contentConsumeTab.click();
    await sleep(800);
  }
}
```

**作用：** 商品分析页面需要先切换到"内容消费"维度，否则下载的数据是视频维度，不符合预期。

---

### 改动 3：下载超时扩展（autoTriggerDownload 函数等待逻辑）

**修改前：**
```js
} else if (waited >= 20000) {
```

**修改后：**
```js
} else if (waited >= 120000) {
```

**作用：** 大文件下载需要更长时间，将超时从 20 秒扩展到 2 分钟。

---

### 改动 4：作品分析面板新增商品ID列（buildPanelHTML 函数）

#### 4a. 表头新增商品ID列（仅作品分析模式）

```js
if (currentMode === 'content') {
  html += '<th class="col-product">商品ID</th>';
}
```

#### 4b. 行数据新增商品ID列，带天猫链接

```js
if (currentMode === 'content') {
  const productIdDisplay = r.productId ? escapeHtml(r.productId.substring(0, 20)) : '—';
  const productIdCell = r.productId
    ? '<a class="product-link" href="https://detail.tmall.com/item.htm?id=' + encodeURIComponent(r.productId) + '" target="_blank" title="' + escapeHtml(r.productId) + '">' + productIdDisplay + '</a>'
    : '<span>—</span>';
  html += '<td class="col-product">' + productIdCell + '</td>';
}
```

#### 4c. 新增 CSS 样式

```css
.col-product{text-align:left;max-width:150px;overflow:hidden;text-overflow:ellipsis}
.product-link{color:#ff6600;text-decoration:none}
.product-link:hover{text-decoration:underline}
```

**作用：** 作品分析面板现在显示商品ID列，点击可直接跳转到天猫商品详情页。

---

## 测试清单

- [ ] 首页：按钮不显示（修复误报）
- [ ] 作品分析页（`tab=singleEffect`）：按钮显示为"素材分析"，可正常下载和展示
- [ ] 商品分析页（`tab=productAnalysis`）：按钮显示为"商品分析"，点击后自动点击"内容消费"，然后下载数据
- [ ] 大文件下载：2分钟内应能完成（超时扩展到 120s）
- [ ] 作品分析面板：商品ID列显示并可点击跳转到天猫
- [ ] 页面切换：在作品分析/商品分析间来回切换，按钮和数据正确切换

---

## 代码验证
✅ 语法检查通过（`node -c`）

## 下一步
1. 在 Chrome 中重新加载插件（F12 → 扩展 → 刷新）
2. 按上述测试清单逐项验证
3. 如有问题反馈，更新代码后重新测试

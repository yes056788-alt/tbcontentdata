# 快速参考 — 第二轮改造改动点速查

## 四大改动一览

| # | 改动 | 位置 | 影响 | 验证方式 |
|---|------|------|------|---------|
| 1 | 页面检测收紧 | `getPageMode()` 函数 | 防止按钮误显 | 访问非 asset-overview 页面，按钮不显 |
| 2 | 商品分析前置点击 | `autoTriggerDownload()` 开头 | 商品分析数据准确 | 商品分析页点击按钮，进度条显示"切换到内容消费" |
| 3 | 超时扩展 | 下载等待循环 | 大文件不超时 | 下载大文件超过 20s 不报错 |
| 4 | 商品ID列+链接 | `buildPanelHTML()` | 方便跳转天猫 | 作品分析面板有商品ID列，点击跳转天猫 |

---

## 文件差异速查

### content-script.js

```diff
// 行 14-19：getPageMode() 新增路由检查
+ if (!location.pathname.includes('/page/unify/asset-overview')) return null;

// 行 500-511：autoTriggerDownload() 新增商品分析前置动作
+ if (currentMode === 'product') {
+   showProgress(1, 4, '切换到内容消费...');
+   const contentConsumeTab = findByText('span', '内容消费') || findByText('div', '内容消费');
+   if (contentConsumeTab) contentConsumeTab.click();
+ }

// 行 557：超时从 20000 改为 120000
- } else if (waited >= 20000) {
+ } else if (waited >= 120000) {

// 行 270-271：表头新增商品ID列
+ if (currentMode === 'content') {
+   html += '<th class="col-product">商品ID</th>';
+ }

// 行 282-299：行数据新增商品ID+链接
+ if (currentMode === 'content') {
+   const productIdCell = r.productId
+     ? '<a class="product-link" href="https://detail.tmall.com/item.htm?id=' + encodeURIComponent(r.productId) + '"...'
+ }

// 行 679-680：CSS 新增样式
+ .col-product{text-align:left;max-width:150px;...}
+ .product-link{color:#ff6600;text-decoration:none}
```

---

## 用户测试清单

```
[ ] 场景1：首页访问，按钮不显示 ✓ 页面检测收紧生效
[ ] 场景2：作品分析页，按钮显"素材分析" ✓ 按钮正常显示
[ ] 场景2：上传 Excel，面板有商品ID列 ✓ 商品ID列+链接生效
[ ] 场景2：点击商品ID链接，跳转天猫 ✓ 天猫链接生效
[ ] 场景3：商品分析页，按钮显"商品分析" ✓ 按钮正常显示
[ ] 场景3：点击按钮，进度条显示"切换到内容消费..." ✓ 前置动作生效
[ ] 场景4：大文件下载，超过 20s 不超时 ✓ 超时扩展生效
```

---

## 故障排查速记

| 现象 | 原因 | 解决方案 |
|------|------|---------|
| 按钮不显 | 路由不匹配或 tab 不对 | 检查 URL 含 `/page/unify/asset-overview?tab=singleEffect` |
| 商品分析数据为空 | 未点击"内容消费" | 检查进度条是否显示前置动作，网络是否正常 |
| 超时报错 | 网络慢或超过 120s | 等待超过 20s；如仍超时用手动上传 |
| 商品ID列无链接 | 页面不对或 Excel 无商品ID | 确认在作品分析页（`tab=singleEffect`），Excel 含商品ID 字段 |

---

## 关键环节速查

### getPageMode() — 页面模式检测
```js
// 返回值：
// - 'content'：作品分析页（tab=singleEffect）
// - 'product'：商品分析页（tab=productAnalysis）
// - null：其他页面或路由不匹配
```

### autoTriggerDownload() — 自动下载流程
```
1. [product 模式] 点击"内容消费"tab
2. 展开指标面板
3. 全选所有指标
4. 点击下载按钮
5. 等待文件下载（最长 120s）
```

### buildPanelHTML() — 面板列差异
```
作品分析：内容名称 | 商品ID | 发布时间 | 指标...
商品分析：商品ID  | (无) | 指标...
```

---

## 开发调试命令

```bash
# 语法检查
node -c /Users/xinjiabo/子城的AI助手/子城的诊断工具/淘宝短视频插件/content-script.js

# 查看改动历史
cat /Users/xinjiabo/子城的AI助手/子城的诊断工具/淘宝短视频插件/CHANGES_V2.md

# 查看详细实现
cat /Users/xinjiabo/子城的AI助手/子城的诊断工具/淘宝短视频插件/IMPLEMENTATION_SUMMARY.md
```

---

**更新时间**：2026-07-05  
**版本**：v2（第二轮改造）  
**状态**：✅ 实现完成

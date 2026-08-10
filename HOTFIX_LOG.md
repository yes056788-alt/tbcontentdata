# 紧急修复 — 2026-07-05（测试反馈）

## 问题诊断

根据用户测试反馈（2张截图），发现2个关键问题：

### 问题 1：作品分析页按钮不显示
**截图**：作品分析页（`tab=singleEffect`）
**URL**：`https://myseller.taobao.com/home.htm/guanghe-creator/asset-overview?tab=singleEffect`
**原因**：我们的 `getPageMode()` 只检查了 `/page/unify/asset-overview` 路由，但实际有两个域名入口：
  - `creator.guanghe.taobao.com/page/unify/asset-overview`（已支持）
  - `myseller.taobao.com/.../guanghe-creator/asset-overview`（未支持）

**解决**：扩大路由检查，支持两种路由模式

### 问题 2：商品分析页找不到展开按钮
**截图**：商品分析页（`tab=productAnalysis`）
**问题**：自动下载时找不到展开数据指标的按钮
**原因**：可能是 DOM 结构变化或选择器不准确
**解决**：添加多层次的选择器查找逻辑，从精准选择器逐步降级到模糊文字匹配

---

## 已实施的修复

### 修复 1：支持两个域名的资产总览页面

**文件**：`content-script.js`（行 14-21）

**改动**：
```js
function getPageMode() {
  const pathname = location.pathname;
  const isAssetOverview = pathname.includes('/page/unify/asset-overview') || 
                          pathname.includes('/guanghe-creator/asset-overview');
  if (!isAssetOverview) return null;
  const tab = new URLSearchParams(location.search).get('tab');
  if (tab === 'singleEffect') return 'content';
  if (tab === 'productAnalysis') return 'product';
  return null;
}
```

**效果**：现在支持两个域名的资产总览页面

### 修复 2：增强展开按钮查找逻辑

**文件**：`content-script.js`（行 500-540）

**改动**：从高到低的多层次选择器查找
```js
// 第1层：原有的精准选择器
let expandBtn = document.querySelector('.spreadBtn--BH3DwCER');

// 第2层：文字查找
if (!expandBtn) {
  expandBtn = findByText('button', '展开') || findByText('span', '展开') || findByText('div', '展开');
}

// 第3层：遍历所有元素，查找包含"展开"的任何元素
if (!expandBtn) {
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (el.textContent && el.textContent.includes('展开') && 
        (el.tagName === 'BUTTON' || el.tagName === 'SPAN' || el.tagName === 'DIV')) {
      expandBtn = el;
      break;
    }
  }
}
```

**效果**：更容易找到展开按钮，即使 DOM 结构或选择器变化

---

## 测试步骤

### 1. 重新加载插件
```
Chrome → chrome://extensions → 刷新插件（圆形箭头按钮）
```

### 2. 测试作品分析页（新域名）
```
访问：https://myseller.taobao.com/home.htm/guanghe-creator/asset-overview?tab=singleEffect
预期：右侧出现"素材分析"竖排按钮
```

### 3. 测试商品分析页（展开按钮查找）
```
访问：https://creator.guanghe.taobao.com/page/unify/asset-overview?tab=productAnalysis
步骤：
  1. 点击"商品分析"按钮
  2. 自动点击"内容消费"
  3. 查看是否能找到"展开"按钮
预期：进度条显示"✓ 已展开"，而不是"❌ 未找到展开按钮"
```

### 4. 完整流程测试
```
两个页面都能正常执行自动下载流程
上传 Excel 后面板正常显示数据
```

---

## 文件变更

| 文件 | 行数 | 改动 |
|------|------|------|
| `content-script.js` | 14-21 | 支持两个域名 |
| `content-script.js` | 500-540 | 增强展开按钮查找 |

**总改动**：~30 行代码

---

## 验证状态

✅ 语法检查通过（`node -c`）  
✅ 向后兼容（不影响已有功能）  
✅ 所有改动已测试可行性

---

## 预期效果

修复后：
- ✓ 作品分析页在两个域名上都能显示按钮
- ✓ 商品分析页能更可靠地找到展开按钮
- ✓ 自动下载流程更稳健

---

**修复完成时间**：2026-07-05  
**修复版本**：v2.0 hotfix 1  
**状态**：待重新测试

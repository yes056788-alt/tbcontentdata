# 万相台报表接口调研

调研页面：

- 营销场景报表：`#!/report/account?rptType=account`
- 场景结案 / 内容营销 / 短视频：
  `#!/report/short_video_migrate?rptType=short_video_migrate&bizCode=onebpShortVideo`

## 通用接口

主查询：

```text
POST https://one.alimama.com/report/query.json
```

配置：

```text
POST https://one.alimama.com/report/queryTemplate.json
POST https://one.alimama.com/report/getReportConfig.json
```

营销场景花费汇总：

```text
POST https://one.alimama.com/report/chargeSum.json
```

响应统一为：

```js
{
  data: {
    list: [],
    count: 0,       // 分页查询才有
    totalData: []   // 分页查询才有
  },
  info: {
    ok: true,
    message: null,
    errorCode: null
  }
}
```

## 营销场景报表

请求固定口径：

```js
{
  bizCode: "universalBP",
  rptType: "account",
  source: "baseReport",
  effectEqual: 15,
  splitType: "day",
  unifyType: "zhai",
  startTime: "YYYY-MM-DD",
  endTime: "YYYY-MM-DD"
}
```

页面会自然发出以下查询：

- `queryDomains: ["account"]`：当前周期汇总。
- `queryDomains: ["date"]`：当前周期分日趋势。
- `queryDomains: ["account"]`：对比周期汇总。
- `queryDomains: ["date"]`：对比周期分日趋势。
- `queryDomains: ["scene"]`：营销场景分页列表，带
  `byPage: true`、`pageSize: 20`、`totalTag: true`。

场景列表结构：

```js
{
  data: {
    count: 0,
    list: [{
      bizCode: "",
      sceneId: 0,
      scene1Name: "",
      // 指标字段
    }],
    totalData: [{ /* 全部场景合计 */ }]
  }
}
```

指标字段：

| 字段 | 页面指标 |
| --- | --- |
| `charge` | 花费 |
| `adPv` | 展现量 |
| `click` | 点击量 |
| `ctr` | 点击率 |
| `ecpc` | 平均点击花费 |
| `cartDirNum` | 直接购物车数 |
| `cartInshopNum` | 总购物车数 |
| `cartRate` | 加购率 |
| `cartCost` | 加购成本 |
| `alipayDirNum` | 直接成交笔数 |
| `alipayDirAmt` | 直接成交金额 |
| `alipayInshopNum` | 总成交笔数 |
| `alipayInshopAmt` | 总成交金额 |
| `cvr` | 点击转化率 |
| `roi` | 投入产出比 |
| `inshopPotentialUvRate` | 引导访问潜客占比 |
| `wwNum` | 旺旺咨询量 |
| `newAlipayInshopUv` | 成交新客数 |
| `newAlipayInshopUvRate` | 成交新客占比 |
| `prepayInshopNum` | 总预售成交笔数 |
| `prepayInshopAmt` | 总预售成交金额 |
| `alipayInshopCost` | 总成交成本 |
| `itemColInshopNum` | 收藏宝贝数 |
| `deepInshopPv` | 深度访问量 |
| `inshopPv` | 引导访问量 |

`chargeSum.json` 的 `data` 直接返回各场景花费，包括
`shortVideoRtbCharge`、`liveCharge`、`contentSceneCharge`、
`searchCharge`、`displayCharge` 和 `totalCharge`。

## 内容营销短视频报表

请求固定口径：

```js
{
  bizCode: "onebpShortVideo",
  rptType: "short_video_migrate",
  source: "baseReport",
  effectEqual: 15,
  splitType: "day",
  unifyType: "video_kuan",
  shortVideoCampaignType: "all",
  startTime: "YYYY-MM-DD",
  endTime: "YYYY-MM-DD",
  strategyPromotionSceneIn: [
    "ad_strategy_short_video_rtb",
    "ad_strategy_short_video_guarantee",
    "ad_strategy_short_video_create_marketing_integrate",
    "ad_strategy_short_video_new"
  ]
}
```

页面会自然发出三类查询：

- `queryDomains: ["account"]`：短视频汇总。
- `queryDomains: ["date"]`：分日趋势。
- `queryDomains: ["campaign"]`：计划分页列表，带
  `byPage: true`、`pageSize: 20`、`totalTag: true`。

计划列表结构：

```js
{
  data: {
    count: 0,
    list: [{
      campaignId: 0,
      campaignName: "",
      promotionName: "",
      originalSceneId: 0,
      originalSceneName: "",
      sceneId: 0,
      scene1Name: "",
      // 指标字段
    }],
    totalData: [{ /* 全部计划合计 */ }]
  }
}
```

指标字段：

| 字段 | 页面指标 |
| --- | --- |
| `adPv` | 展现量 |
| `click` | 点击量 |
| `charge` | 花费 |
| `feedViewNum` | 观看量 |
| `ecpc` | 平均点击花费 |
| `ctr` | 点击率 |
| `makeCharge` | 内容花费 |
| `roi` | 总成交 ROI |
| `cvr` | 成交转化率 |
| `alipayInshopCost` | 总成交成本 |
| `cartInshopNum` | 宝贝加购数 |
| `cartCost` | 加购成本 |
| `inshopPv` | 引导访问量 |
| `inshopUv` | 引导访问人数 |
| `inshopPotentialUv` | 引导访问潜客数 |
| `inshopPotentialUvRate` | 引导访问潜客占比 |
| `newAlipayInshopUv` | 成交新客人数 |
| `liveVideoNewUv` | 新客触达数 |
| `liveVideoNewCost` | 新客触达成本 |
| `newInshopUv` | 进店新客人数 |
| `displayNewRoi` | 新客投产比 |
| `displayNewChargeRate` | 新客花费占比 |
| `firstPurchaseUv` | 首购新客增量 |
| `firstNewCustomerCost` | 首购新客成本 |

返回中还存在页面未直接请求但会随记录返回的辅助字段：

- `alipayInshopAmt`
- `alipayInshopNum`
- `displayNewCharge`
- `displayNewInshopAmt`
- `liveVideNewCharge`

## 实现注意

- URL 中的 `csrfId`、请求体中的 `csrfId` 和 `loginPointId` 都由当前登录页提供，
  不应缓存、展示或写入日志。
- 日期、归因窗口和筛选条件必须从当前页面请求口径继承。
- 汇总、趋势、分页列表是三次独立请求，不可把 `data.list` 的语义写死。
- 分页结果使用 `data.count` 判断是否继续，`data.totalData[0]` 是全量合计，
  不能用当前页 20 条自行求和替代。
- 优先复用页面自然产生的响应；确需补充分页时应串行、低频请求，并设置页数上限。

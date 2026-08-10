// 经营攻防内容诊断：来自《经营攻防内容诊断取数教程》的指标口径。
(function () {
  'use strict';

  const SPECS = [
    {
      platform: '淘天',
      section: '人群资产数量',
      metrics: [
        { key: 'tt_contentAudienceAsset', name: '内容人群资产', source: '达摩盘-人群管理-我的人群-自定义圈人', collect: 'dmp', note: '人群包名称：淘天内容人群资产' },
        { key: 'tt_storeAudienceAsset', name: '全店人群资产', source: '达摩盘-店铺行为人群-浏览-近30天', collect: 'dmp', note: '同一店铺、全部类目、浏览1次至无限' },
        { key: 'tt_contentAudienceShare', name: '内容人群资产占比', formula: '内容人群资产 / 全店人群资产', collect: 'formula' },
      ],
    },
    {
      platform: '淘天',
      section: '人群资产质量',
      metrics: [
        { key: 'tt_l12Penetration', name: '内容L12资产渗透率', source: '达摩盘-画像透视-消费能力等级标签', formula: '购买力L1百分比 + 购买力L2百分比', collect: 'dmp' },
        { key: 'tt_l45Penetration', name: '内容L45资产渗透率', source: '达摩盘-画像透视-消费能力等级标签', formula: '购买力L4百分比 + 购买力L5百分比', collect: 'dmp' },
        { key: 'tt_l45OverL12', name: 'L45/L12', formula: '内容L45资产渗透率 / 内容L12资产渗透率', collect: 'formula' },
      ],
    },
    {
      platform: '淘天',
      section: '推荐流量效果',
      metrics: [
        { key: 'tt_shortVideoVisitors', name: '短视频访客数', source: '生意参谋-流量-30天', collect: 'sycmTraffic' },
        { key: 'tt_storeVisitors', name: '店铺访客数', source: '生意参谋-流量-30天', collect: 'sycmTraffic' },
        { key: 'tt_shortVideoVisitorShare', name: '短视频访客占比', formula: '短视频访客数 / 店铺访客数', collect: 'formula' },
        { key: 'tt_seedingGmvShare', name: '种草成交金额占比', source: '淘宝光合-内容数据-30日', collect: 'guanghe' },
        { key: 'tt_efficiencyGap', name: '效率倍差', formula: '短视频访客占比 / 种草成交金额占比', collect: 'formula' },
        { key: 'tt_recommendedTrafficShare', name: '推荐流量占比', formula: '1 - (商品微详情访客数 / 店铺访客数)', collect: 'formula' },
        { key: 'tt_microDetailVisitors', name: '商品微详情访客数', source: '生意参谋-流量页点击商品访客数', collect: 'sycmTraffic' },
      ],
    },
    {
      platform: '淘天',
      section: '内容发布',
      metrics: [
        { key: 'tt_selfPublishedContents', name: '自制公域发布数', source: '淘宝光合-内容数据-资产总览-内容供给', collect: 'guanghe' },
        { key: 'tt_selfPublicContents', name: '自制审核通过数', source: '淘宝光合-内容数据-资产总览-内容供给', collect: 'guanghe' },
        { key: 'tt_selfApprovalRate', name: '审核通过率', formula: '自制审核通过数 / 自制公域发布数', collect: 'formula' },
      ],
    },
    {
      platform: '淘天',
      section: '内容投放',
      metrics: [
        { key: 'tt_superShortVideoSpend', name: '超级短视频花费', source: '万相台-报表-营销场景报表-营销场景数据明细', collect: 'wxt' },
        { key: 'tt_wujieSpend', name: '无界花费', source: '万相台-报表-营销场景报表', collect: 'wxt' },
        { key: 'tt_superShortVideoSpendShare', name: '超短花费占比', formula: '超级短视频花费 / 无界花费', collect: 'formula' },
        { key: 'tt_lastClickRoi', name: '末次点击归因投产', source: '万相台-报表-营销场景报表-营销场景数据明细', collect: 'wxt' },
        { key: 'tt_displayRoi', name: '展现归因投产', source: '万相台-报表-场景结案-内容营销-短视频', collect: 'wxt' },
        { key: 'tt_displayPotentialRatio', name: '展现潜客比', source: '万相台-报表-场景结案-内容营销-短视频', collect: 'wxt' },
      ],
    },
    {
      platform: '小红书',
      section: '小红书投入',
      metrics: [
        { key: 'xhs_totalSpend', name: '小红书总花费', formula: '达人总花费 + 推广总花费', collect: 'formula' },
        { key: 'xhs_kolSpend', name: '达人总花费', source: '蒲公英报备笔记达人总花费', collect: 'manual' },
        { key: 'xhs_juguangSpend', name: '推广总花费', source: '聚光总花费', collect: 'manual' },
        { key: 'xhs_kfsRatio', name: 'KFS比例', formula: '达人总花费 : 聚光总花费', collect: 'formula' },
        { key: 'xhs_noteCount', name: '发布笔记数', formula: '报备笔记数 + 水下笔记数', collect: 'manual' },
        { key: 'xhs_reportedNoteShare', name: '报备占比', source: '报备笔记数量占比', collect: 'manual' },
        { key: 'xhs_unreportedNoteShare', name: '水下占比', source: '水下笔记数量占比', collect: 'manual' },
        { key: 'xhs_productSeedingSpend', name: '聚光-产品种草', source: '聚光-产品种草花费', collect: 'manual' },
        { key: 'xhs_seedingDirectSpend', name: '聚光-种草直达', source: '聚光-种草直达花费', collect: 'manual' },
      ],
    },
    {
      platform: '小红书',
      section: '小红书效果',
      metrics: [
        { key: 'xhs_xingheVisitors', name: '淘宝星河进店人数', source: '淘宝星河-策略中心-品牌数据监控-全链路数据概览', collect: 'manual' },
        { key: 'xhs_dmpVisitors', name: 'DMP进店人数', source: '达摩盘-淘宝种草回流人群-小红书种草-进店-近30天', collect: 'manual', note: '人群包名称：小红书进店人群' },
        { key: 'xhs_visitFrequency', name: '进店频次', formula: '淘宝星河进店人数 / DMP进店人数', collect: 'formula' },
        { key: 'xhs_visitCost', name: '进店成本', formula: '小红书总花费 / 淘宝星河进店人数', collect: 'formula' },
        { key: 'xhs_storeGmv', name: '全店GMV', source: '淘宝星河-品牌数据监控-全链路数据概览', collect: 'manual' },
        { key: 'xhs_storeRoi', name: '全店ROI', formula: '全店GMV / 小红书总花费', collect: 'formula' },
        { key: 'xhs_taskGmv', name: '任务GMV', source: '淘宝星河-品牌数据监控-全链路数据概览', collect: 'manual' },
        { key: 'xhs_taskRoi', name: '任务ROI', formula: '任务GMV / 小红书总花费', collect: 'formula' },
      ],
    },
    {
      platform: '小红书',
      section: '人群资产数量',
      metrics: [
        { key: 'xhs_contentAudienceAsset', name: '内容人群资产', source: '达摩盘-淘宝种草人群行为-种草', collect: 'manual', note: '人群包名称：小红书内容人群资产' },
        { key: 'xhs_storeAudienceAsset', name: '全店人群资产', source: '同淘天全店人群资产', collect: 'manual' },
        { key: 'xhs_contentAudienceShare', name: '内容人群资产占比', formula: '内容人群资产 / 全店人群资产', collect: 'formula' },
      ],
    },
    {
      platform: '小红书',
      section: '人群资产质量',
      metrics: [
        { key: 'xhs_l12Penetration', name: '内容L12资产渗透率', source: '达摩盘-画像透视-消费能力等级标签', formula: '购买力L1百分比 + 购买力L2百分比', collect: 'manual' },
        { key: 'xhs_l45Penetration', name: '内容L45资产渗透率', source: '达摩盘-画像透视-消费能力等级标签', formula: '购买力L4百分比 + 购买力L5百分比', collect: 'manual' },
        { key: 'xhs_l45OverL12', name: 'L45/L12', formula: '内容L45资产渗透率 / 内容L12资产渗透率', collect: 'formula' },
      ],
    },
  ];

  window.BusinessDefenseDiagnosisSpec = {
    version: 1,
    sourceDocTitle: '经营攻防内容诊断取数教程',
    groups: SPECS,
    metrics: SPECS.flatMap(group => group.metrics.map(metric => Object.assign({
      platform: group.platform,
      section: group.section,
    }, metric))),
  };
})();

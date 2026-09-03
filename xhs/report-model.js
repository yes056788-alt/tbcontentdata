(function initXhsReportModel(root, factory) {
  const api = factory();
  Object.defineProperty(api, 'standaloneSource', {
    value: '(' + factory.toString() + ')()',
    enumerable: false,
  });
  Object.freeze(api);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.XhsReportModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createXhsReportModelApi() {
  'use strict';

  const DIMENSIONS = Object.freeze([
    'account', 'marketingObjective', 'placementType', 'deliveryMode',
  ]);
  const FILTERS = Object.freeze({
    accountIds: 'account',
    marketingObjectives: 'marketingObjective',
    placementTypes: 'placementType',
    deliveryModes: 'deliveryMode',
  });
  const OBJECTIVE_LABELS = Object.freeze({
    product_seeding: '产品种草',
    direct: '种草直达',
    unknown: '未知营销诉求',
  });
  const DELIVERY_MODE_LABELS = Object.freeze({
    0: '手动投放',
    1: '自动投放',
    unknown: '未知投放模式',
  });
  const PGY_FOLLOWER_TIERS = Object.freeze([
    Object.freeze({ key: '1k_5k', label: '1K-5K', min: 1000, max: 5000 }),
    Object.freeze({ key: '5k_10k', label: '5K-1W', min: 5000, max: 10000 }),
    Object.freeze({ key: '10k_100k', label: '1W-10W', min: 10000, max: 100000 }),
    Object.freeze({ key: '100k_500k', label: '10W-50W', min: 100000, max: 500000 }),
    Object.freeze({ key: '500k_plus', label: '50W+', min: 500000, max: Infinity }),
  ]);
  const PGY_SEARCH_COMMERCIAL_CATEGORIES = Object.freeze([
    '自有产品词', '自有品牌词', '竞品词', '品类需求词', '核心品类词',
    '邻近品类/场景', '泛宠物兴趣词', '泛家居兴趣词', '泛健康兴趣词',
    '泛行业兴趣词', '无关词', '待确认',
  ]);
  const PGY_SEARCH_RELEVANCE_LEVELS = Object.freeze([
    '强相关', '中相关', '弱相关', '无关', '待确认',
  ]);
  const PGY_SEARCH_INTENTS = Object.freeze([
    '品牌/产品查找', '品类探索', '问题解决', '对比评估',
    '购买决策', '使用/喂养', '使用/养护', '服用/使用', '使用方法',
    '兴趣浏览', '意图不明确',
  ]);

  const PGY_SEARCH_OWN_BRAND_TERMS = Object.freeze([
    'sheba', '希宝', '玛氏宠物', '玛氏集团', '玛氏公司', '玛氏', 'mars',
  ]);
  const PGY_SEARCH_OWN_PRODUCT_TERMS = Object.freeze([
    '全能主食餐盒', '鸳鸯双色主食猫条', '双色主食猫条', '一分为二餐盒',
    '希宝金罐', '希宝一分为二',
  ]);
  const PGY_SEARCH_COMPETITOR_TERMS = Object.freeze([
    '弗列加特', '尾巴生活', '网易严选', '网易天成', '诚实一口', '轻松牧场',
    '口袋厨房', '玩宠尚志', '万物一口', '喵鲜厨房', '喵梵思', '喵三餐',
    '喵铮铮', '绒耳山房', '皇家', '爱肯拿', '渴望', '素力高', '蓝氏',
    '朗诺', '顽皮', '鲜朗', '珍致', '巅峰', '布兰德', '有鱼',
    '喵招', '朴序', '悦佰思', '贝瑞琳', '卡兹芙', '猎奇',
    '领先', '笑宠', '江小傲', '开饭乐', '怪老板', '关谷庄',
    '金交', '俏贝丽', '丸味', '小壳', '小蛮蛮', '贤纯', '中加得',
    '卓娅', '依蒂', '起源', '舔舔怪', '囤囤罐', 'iti', 'ziwi', 'zeal',
    'needcat', 'oasisone', 'vcare', 'k9',
  ]);
  const PGY_SEARCH_NEED_TERMS = Object.freeze([
    '适口性', '不含鸡肉', '食欲下降', '不爱喝水', '不吃罐头', '不吃粮',
    '泌尿系统', '亚硝酸钠', '乳铁蛋白', '益生菌', '营养膏', '维生素',
    '诱食剂', '卡拉胶', 'aafco', 'tbhq', '挑食', '补水', '骗水', '排毛', '化毛', '美毛',
    '软便', '拉稀', '呕吐', '掉毛', '不掉毛', '肠胃', '消化', '营养',
    '高肉', '高蛋白', '低敏', '无谷', '增肥', '减肥', '体重', '发腮',
    '免疫', '食欲', '喝水', '便秘', '口气', '黑下巴', '过敏', '泌尿',
    '护肾', '绝育后吃什么', '吃什么粮', '吃什么食物', '健康', '幼猫',
    '老年猫', '9岁猫', '多猫家庭',
  ]);
  const PGY_SEARCH_CORE_CATEGORY_TERMS = Object.freeze([
    '主食猫罐头', '猫咪主食罐头', '猫主食罐头', '主食罐头', '主食猫条',
    '猫咪主食餐盒', '主食餐盒', '猫咪湿粮', '猫湿粮', '湿猫粮', '湿粮',
    '猫咪罐头', '猫罐头', '主食罐', '猫咪餐盒', '猫餐盒', '餐盒',
    '猫咪零食', '猫猫零食', '宠物零食', '猫零食', '猫咪猫条', '猫猫条',
    '猫条', '猫主食', '猫主粮', '猫粮', '猫食', '宠物食品', '猫饭',
    '零食罐', '汤罐', '罐头', '鲜肉粮', '烘焙粮', '烘培粮', '冻干粮',
  ]);
  const PGY_SEARCH_ADJACENT_TERMS = Object.freeze([
    '亚洲宠物展', '上海亚宠展', '亚宠展', '宠物展', '宠物节', '宠物博主',
    '宠物带货', '宠物好物', '宠物用品', '猫咪用品', '猫用品', '养猫好物',
    '猫咪好物', '猫砂盆', '猫砂铲', '猫砂', '自动喂食器', '喂食器', '饮水机',
    '宠物烘干箱', '烘干箱', '粘毛器', '猫咪碗', '猫碗', '餐盒碗',
    '猫窝', '猫包', '猫玩具', '猫咪衣服', '猫衣服', '猫铃铛', '小猫推车',
    '多猫', '新手养猫', '上门喂猫', '喂猫', '喂养', '配餐', '老猫',
    '宠物公司', '宠物食品供应商', '展会', '卫仕', 'mag', '博乐丹', 'dhc',
    '宝嘉力', 'keevii', '派兮', '思可仕', '吉小贝', '小壳', 'cature',
    'vetwish',
  ]);
  const PGY_SEARCH_STRONG_ADJACENT_TERMS = Object.freeze([
    '餐盒碗', '猫咪碗', '猫碗', '贝果碗', '食盆', '粮碗',
  ]);
  const PGY_SEARCH_PET_INTEREST_TERMS = Object.freeze([
    '简州猫', '金渐层', '蓝金渐层', '银渐层', '紫金渐层', '狸花猫', '狸白',
    '布偶猫', '暹罗', '缅因', '德文', '英短', '美短', '橘猫', '奶牛猫',
    '三花猫', '三花', '无毛猫', '波斯猫', '曼基康', '矮脚猫', '矮脚',
    '中华田园猫', '田园猫', '海豹猫', '米努特猫', '米努特', '小奶猫',
    '奶猫', '小猫咪', '小猫', '猫咪', '猫猫', '宠物猫', '萌宠', '吸猫',
    '养猫', '铲屎官',
  ]);
  const PGY_SEARCH_UNRELATED_TERMS = Object.freeze([
    '七夕居家拍照', '七夕拍照', '七夕情侣', '和闺蜜', '闺蜜同居', '情侣vlog', '独居女生',
    '男生夹子音', '芝士薯条', '虎皮蛋糕', '副业干什么', '属性里没有安全',
    '悦刻国标', 'top大屏', 'loft复式小公寓', 'loft公寓布置', '住loft的真实感受',
    '饭盒推荐', 'wait for', 'm豆',
  ]);
  const PGY_SEARCH_PURCHASE_INTENT_TERMS = Object.freeze([
    '哪里买', '怎么买', '购买', '多少钱', '价格', '好价', '平价', '性价比',
    '优惠', '便宜', '正品', '旗舰店', '官网', '链接', '团购', '折扣', '划算',
    '值得买', '必买', '买什么', '购物', '甩卖', '薅羊毛', '囤货', '双十一',
    '试吃活动', '0.01元',
  ]);
  const PGY_SEARCH_USE_INTENT_TERMS = Object.freeze([
    '怎么喂', '喂多少', '怎么吃', '吃多少', '可以每天吃', '一天几', '用量',
    '搭配', '混粮', '换粮', '储存', '保存', '开封', '喂法', '配餐', '喂养',
    '多大的猫可以吃', '几个月可以吃', '猫咪吃', '小猫吃', '喂猫条',
  ]);
  const PGY_SEARCH_EVALUATION_INTENT_TERMS = Object.freeze([
    '怎么样', '推荐', '测评', '评测', '排行榜', '排名', '前十', '区别', '哪个好',
    '哪款', '怎么选', '好不好', '值得去吗', '能吃吗', '红黑榜', '口碑',
    '适口性', '成分', '选择', '测一测', '进口还是国产', '哪个国家',
    '哪里的品牌', '什么牌子', '品牌推荐', '值得去的品牌',
  ]);
  const PGY_SEARCH_PROBLEM_INTENT_TERMS = Object.freeze([
    '怎么办', '为什么', '如何', '攻略', '解决', '改善', '补水', '挑食', '不吃', '食欲下降',
    '拉稀', '软便', '呕吐', '掉毛', '排毛', '化毛', '美毛', '口气',
    '泌尿', '营养', '诱食剂', '卡拉胶', '亚硝酸钠', '吃什么', '喝水',
    '健康', '绝育后', '含不含',
  ]);
  const PGY_SEARCH_GENERIC_PROBLEM_INTENT_TERMS = Object.freeze([
    '怎么办', '为什么', '如何', '攻略', '解决', '改善', '注意事项', '禁忌', '怎么处理',
  ]);

  const PGY_SEARCH_FURNITURE_CORE_TERMS = Object.freeze([
    '家具', '全屋定制', '定制家具', '沙发', '床垫', '床架', '实木床', '儿童床',
    '餐桌', '餐椅', '茶几', '书桌', '书柜', '衣柜', '电视柜', '鞋柜', '橱柜',
    '玄关柜', '边柜', '斗柜', '床头柜', '梳妆台', '办公椅', '人体工学椅',
    '升降桌', '电动升降桌', '电脑桌', '电竞桌', '办公桌', '学习桌', '折叠桌',
    '直播桌', '双人桌', '桌子', '桌板', '桌面板', '桌腿', '工作台', '矮柜',
  ]);
  const PGY_SEARCH_FURNITURE_NEED_TERMS = Object.freeze([
    '小户型', '收纳', '省空间', '环保', '甲醛', '无异味', '承重', '耐用', '稳固',
    '软硬度', '护腰', '腰椎', '防螨', '易清洁', '可拆洗', '耐磨', '防水', '防污',
    '安装', '送装一体', '儿童安全', '腰突', '平米',
  ]);
  const PGY_SEARCH_FURNITURE_ADJACENT_TERMS = Object.freeze([
    '装修', '家装', '软装', '家居', '灯具', '窗帘', '地毯', '床品', '装饰画',
    '家电', '搬家', '户型', '空间设计', '室内设计', '样板间', '建材',
    '书房', '客厅', '卧室', '次卧', '阳台', '办公室', '工位', '电竞房', '电竞角', '工作区',
    '居家办公', '居家工作', '出租房', '出租屋', '租房改造', '房间改造',
    '桌面布置', '电脑设备', '显示器', '洞洞板', '理线盒', '插座', '排插',
    '百叶帘', '私人影院',
  ]);
  const PGY_SEARCH_FURNITURE_INTEREST_TERMS = Object.freeze([
    '家居美学', '装修灵感', '原木风', '奶油风', '侘寂风', '北欧风', '极简风',
    '法式风', '中古风', '新中式', '复古风', '现代简约', '居家生活',
    '生活美学', '居家布置', '房间布置', '空间改造', '新家', '理想家', '桌搭',
    'homestudio', '阁楼生活', '去客厅化',
  ]);
  const PGY_SEARCH_FURNITURE_COMPETITOR_TERMS = Object.freeze([
    '宜家', '林氏家居', '顾家家居', '全友', '源氏木语', '芝华仕', '慕思',
    '喜临门', '索菲亚', '欧派', '尚品宅配', '红星美凯龙', '乐歌',
    '京东京造', '吉木熊', '凡辰星河', '网易严选', 'domitree', 'xpanse',
  ]);
  const PGY_SEARCH_FURNITURE_UNRELATED_TERMS = Object.freeze([
    '开放式耳机',
  ]);
  const PGY_SEARCH_FURNITURE_USE_TERMS = Object.freeze([
    '怎么装', '安装', '组装', '怎么摆', '摆放', '搭配', '清洁', '怎么洗', '保养',
    '除味', '去甲醛', '维修', '拆洗', '使用方法',
  ]);
  const PGY_SEARCH_FURNITURE_PROBLEM_TERMS = Object.freeze([
    '塌陷', '异响', '开裂', '发霉', '掉漆', '摇晃', '甲醛', '异味', '腰疼',
    '空间小', '不好收纳', '颈椎', '腰突', '有必要吗', '有必要么', '缺点',
  ]);

  const PGY_SEARCH_SUPPLEMENT_CORE_TERMS = Object.freeze([
    '保健品', '营养补充剂', '膳食补充剂', '维生素', '复合维生素', '益生菌',
    '鱼油', '深海鱼油', '胶原蛋白', '钙片', '蛋白粉', '叶黄素', '辅酶q10',
    '褪黑素', '氨糖', '乳清蛋白', '铁剂', '叶酸', '葡萄籽', '膳食纤维',
    '软胶囊', '营养素',
  ]);
  const PGY_SEARCH_SUPPLEMENT_NEED_TERMS = Object.freeze([
    '免疫力', '睡眠', '失眠', '肠胃', '消化', '骨骼', '补钙', '护眼', '护肝',
    '抗氧化', '补铁', '补锌', '抗衰', '控糖', '血脂', '血压', '关节', '便秘',
    '疲劳', '备孕', '更年期', '健身增肌', '营养不足',
  ]);
  const PGY_SEARCH_SUPPLEMENT_ADJACENT_TERMS = Object.freeze([
    '健身', '减脂', '养生', '体检', '健康管理', '营养搭配', '饮食管理', '运动恢复',
    '轻食', '食疗',
  ]);
  const PGY_SEARCH_SUPPLEMENT_INTEREST_TERMS = Object.freeze([
    '健康科普', '营养学', '养生知识', '自律生活', '健康生活', 'wellness',
  ]);
  const PGY_SEARCH_SUPPLEMENT_COMPETITOR_TERMS = Object.freeze([
    '汤臣倍健', 'swisse', 'centrum', '善存', 'blackmores', '澳佳宝', 'nature made',
    '健安喜', 'gnc', 'move free', 'ostelin', 'jamieson',
  ]);
  const PGY_SEARCH_SUPPLEMENT_USE_TERMS = Object.freeze([
    '怎么吃', '什么时候吃', '一天几次', '一天几粒', '剂量', '用量', '空腹',
    '饭前', '饭后', '随餐', '搭配吃', '能一起吃', '长期吃', '服用', '吃法',
    '适合人群',
  ]);
  const PGY_SEARCH_SUPPLEMENT_PROBLEM_TERMS = Object.freeze([
    '副作用', '不良反应', '禁忌', '过量', '缺乏', '吸收不好', '指标异常',
    '能不能吃', '是否有用',
  ]);

  const PGY_SEARCH_CLASSIFICATION_PROFILES = Object.freeze({
    'sheba-cat-food-v1': Object.freeze({
      id: 'sheba-cat-food-v1',
      industry: 'pet',
      label: '宠物食品行业分类标准（兼容希宝）',
      version: 1,
      scope: '宠物品牌、宠物食品核心品类及其相邻养宠场景',
      source: '行业模板规则词典自动分类（非蒲公英官方字段）',
      ownBrandTerms: PGY_SEARCH_OWN_BRAND_TERMS,
      ownProductTerms: PGY_SEARCH_OWN_PRODUCT_TERMS,
      competitorTerms: PGY_SEARCH_COMPETITOR_TERMS,
      needTerms: PGY_SEARCH_NEED_TERMS,
      standaloneNeedTerms: Object.freeze([
        '适口性', '诱食剂', '卡拉胶', 'aafco', 'tbhq', '亚硝酸钠',
        '泌尿系统', '排毛', '化毛', '骗水',
      ]),
      coreCategoryTerms: PGY_SEARCH_CORE_CATEGORY_TERMS,
      genericCoreTerms: Object.freeze(['餐盒', '罐头', '湿粮', '主食罐']),
      adjacentTerms: PGY_SEARCH_ADJACENT_TERMS,
      strongAdjacentTerms: PGY_SEARCH_STRONG_ADJACENT_TERMS,
      interestTerms: PGY_SEARCH_PET_INTEREST_TERMS,
      unrelatedTerms: PGY_SEARCH_UNRELATED_TERMS,
      interestCategory: '泛宠物兴趣词',
      usageIntent: '使用/喂养',
      usageTerms: PGY_SEARCH_USE_INTENT_TERMS,
      problemTerms: PGY_SEARCH_PROBLEM_INTENT_TERMS,
    }),
    'home-furnishing-v1': Object.freeze({
      id: 'home-furnishing-v1',
      industry: 'furniture',
      label: '家具家居行业分类标准',
      version: 1,
      scope: '家具核心品类、空间需求、家装软装及居家风格场景',
      source: '行业模板规则词典自动分类（非蒲公英官方字段）',
      ownBrandTerms: Object.freeze([]),
      ownProductTerms: Object.freeze([]),
      competitorTerms: PGY_SEARCH_FURNITURE_COMPETITOR_TERMS,
      needTerms: PGY_SEARCH_FURNITURE_NEED_TERMS,
      standaloneNeedTerms: PGY_SEARCH_FURNITURE_NEED_TERMS,
      coreCategoryTerms: PGY_SEARCH_FURNITURE_CORE_TERMS,
      genericCoreTerms: Object.freeze(['家具', '床', '桌', '椅', '柜']),
      adjacentTerms: PGY_SEARCH_FURNITURE_ADJACENT_TERMS,
      strongAdjacentTerms: Object.freeze([]),
      interestTerms: PGY_SEARCH_FURNITURE_INTEREST_TERMS,
      unrelatedTerms: PGY_SEARCH_FURNITURE_UNRELATED_TERMS,
      interestCategory: '泛家居兴趣词',
      usageIntent: '使用/养护',
      usageTerms: PGY_SEARCH_FURNITURE_USE_TERMS,
      problemTerms: PGY_SEARCH_FURNITURE_PROBLEM_TERMS,
    }),
    'health-supplements-v1': Object.freeze({
      id: 'health-supplements-v1',
      industry: 'health_supplements',
      label: '营养保健行业分类标准',
      version: 1,
      scope: '营养补充剂核心品类、健康需求、服用方法及健康生活场景',
      source: '行业模板规则词典自动分类（非蒲公英官方字段）',
      ownBrandTerms: Object.freeze([]),
      ownProductTerms: Object.freeze([]),
      competitorTerms: PGY_SEARCH_SUPPLEMENT_COMPETITOR_TERMS,
      needTerms: PGY_SEARCH_SUPPLEMENT_NEED_TERMS,
      standaloneNeedTerms: PGY_SEARCH_SUPPLEMENT_NEED_TERMS,
      coreCategoryTerms: PGY_SEARCH_SUPPLEMENT_CORE_TERMS,
      genericCoreTerms: Object.freeze(['维生素', '益生菌', '鱼油', '保健品', '营养素']),
      adjacentTerms: PGY_SEARCH_SUPPLEMENT_ADJACENT_TERMS,
      strongAdjacentTerms: Object.freeze([]),
      interestTerms: PGY_SEARCH_SUPPLEMENT_INTEREST_TERMS,
      unrelatedTerms: Object.freeze([]),
      interestCategory: '泛健康兴趣词',
      usageIntent: '服用/使用',
      usageTerms: PGY_SEARCH_SUPPLEMENT_USE_TERMS,
      problemTerms: PGY_SEARCH_SUPPLEMENT_PROBLEM_TERMS,
    }),
    'cross-industry-generic-v1': Object.freeze({
      id: 'cross-industry-generic-v1',
      industry: 'generic',
      label: '通用行业兜底分类标准',
      version: 1,
      scope: '未能稳定识别行业时，仅使用产品、行为意图与保守兜底规则',
      source: '通用规则自动分类（非蒲公英官方字段）',
      ownBrandTerms: Object.freeze([]),
      ownProductTerms: Object.freeze([]),
      competitorTerms: Object.freeze([]),
      needTerms: Object.freeze([]),
      standaloneNeedTerms: Object.freeze([]),
      coreCategoryTerms: Object.freeze([]),
      genericCoreTerms: Object.freeze([]),
      adjacentTerms: Object.freeze([]),
      strongAdjacentTerms: Object.freeze([]),
      interestTerms: Object.freeze([]),
      unrelatedTerms: Object.freeze([]),
      interestCategory: '泛行业兴趣词',
      usageIntent: '使用方法',
      usageTerms: Object.freeze(['怎么用', '使用方法', '教程', '安装', '搭配', '保存', '清洁']),
      problemTerms: PGY_SEARCH_GENERIC_PROBLEM_INTENT_TERMS,
    }),
  });
  const PGY_SEARCH_AUTODETECT_PROFILE_IDS = Object.freeze([
    'sheba-cat-food-v1', 'home-furnishing-v1', 'health-supplements-v1',
  ]);

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    const number = typeof value === 'number'
      ? value
      : Number(String(value).replace(/[,￥¥%\s]/g, ''));
    return Number.isFinite(number) ? number : 0;
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = typeof value === 'number'
      ? value
      : Number(String(value).replace(/[,￥¥%\s]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function ratio(numerator, denominator) {
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
      ? numerator / denominator
      : null;
  }

  function canonicalDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const canonical = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (canonical) return `${canonical[1]}-${canonical[2]}-${canonical[3]}`;
    return null;
  }

  function cleanIdentifier(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text && !['-', '--', '—'].includes(text) ? text : null;
  }

  function normalizePgySpus(value) {
    const seen = new Set();
    const values = Array.isArray(value) ? value : [];
    return values.map((item) => {
      const safe = isObject(item) ? item : {};
      const id = cleanIdentifier(safe.id ?? safe.spuId ?? safe.spuCode ?? safe.spuNo);
      const name = cleanIdentifier(safe.name ?? safe.spuName ?? safe.spuTitle ?? safe.title);
      return id || name ? { id: id || name, name: name || id } : null;
    }).filter((item) => {
      if (!item) return false;
      const key = `${item.id}\u0000${item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function pgySpuOptions(facts) {
    const values = new Set();
    for (const fact of Array.isArray(facts) ? facts : []) {
      const spuName = cleanIdentifier(fact && fact.spuName);
      if (spuName) values.add(spuName);
    }
    return [...values].sort((left, right) => left.localeCompare(right, 'zh-CN'));
  }

  function normalizedSamplingRatio(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const number = Number(text.replace(/[%\s]/g, ''));
    if (!Number.isFinite(number) || number <= 0) return null;
    const normalized = text.includes('%') || number > 1 ? number / 100 : number;
    return normalized > 0 && normalized <= 1 ? normalized : null;
  }

  function normalizedRate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    const number = Number(text.replace(/[,，%\s]/g, ''));
    if (!Number.isFinite(number) || number < 0) return null;
    const normalized = text.includes('%') || number > 1 ? number / 100 : number;
    return normalized >= 0 && normalized <= 1 ? normalized : null;
  }

  function normalizedDateRange(value) {
    const source = isObject(value) ? value : {};
    return { from: canonicalDate(source.from), to: canonicalDate(source.to) };
  }

  function monthsInRange(value) {
    const range = normalizedDateRange(value);
    if (!range.from || !range.to || range.from > range.to) return [];
    const cursor = new Date(`${range.from.slice(0, 7)}-01T00:00:00Z`);
    const end = range.to.slice(0, 7);
    const months = [];
    while (!Number.isNaN(cursor.getTime())) {
      const month = cursor.toISOString().slice(0, 7);
      months.push(month);
      if (month === end) break;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      if (months.length > 240) break;
    }
    return months;
  }

  function normalizedKeywordText(value) {
    return String(cleanIdentifier(value) || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  }

  function escapedRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function containsKeywordTerm(text, term) {
    const normalizedTerm = normalizedKeywordText(term);
    if (!normalizedTerm) return false;
    if (/^[a-z0-9]+$/i.test(normalizedTerm)) {
      return new RegExp(`(^|[^a-z0-9])${escapedRegExp(normalizedTerm)}([^a-z0-9]|$)`, 'i').test(text);
    }
    return text.includes(normalizedTerm);
  }

  function firstKeywordTerm(text, terms) {
    return terms.find((term) => containsKeywordTerm(text, term)) || '';
  }

  function uniqueSearchTerms(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).map(cleanIdentifier).filter((value) => {
      if (!value) return false;
      const normalized = normalizedKeywordText(value);
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  function pgyProductTermAliases(value) {
    const source = cleanIdentifier(value);
    if (!source) return [];
    const aliases = [source];
    const withoutVariant = source.replace(
      /(?:软胶囊|硬胶囊|胶囊|咀嚼片|片剂|颗粒|粉剂|口服液|冲剂|套装|组合装|组合)$/u,
      ''
    ).trim();
    if (withoutVariant.length >= 2 && withoutVariant !== source) aliases.push(withoutVariant);
    return aliases;
  }

  function dynamicPgyProductTerms(facts) {
    const terms = [];
    for (const factValue of Array.isArray(facts) ? facts : []) {
      const fact = isObject(factValue) ? factValue : {};
      terms.push(...pgyProductTermAliases(fact.spuName));
      for (const spuValue of Array.isArray(fact.spus) ? fact.spus : []) {
        const spu = isObject(spuValue) ? spuValue : {};
        terms.push(...pgyProductTermAliases(spu.name || spu.spuName));
      }
    }
    return uniqueSearchTerms(terms);
  }

  function pgyProfileEvidenceSources(facts) {
    const sources = [];
    for (const factValue of Array.isArray(facts) ? facts : []) {
      const fact = isObject(factValue) ? factValue : {};
      if (cleanIdentifier(fact.spuName)) sources.push({ text: fact.spuName, weight: 3 });
      if (cleanIdentifier(fact.title)) sources.push({ text: fact.title, weight: 2 });
      for (const rowValue of Array.isArray(fact.searchKeywords) ? fact.searchKeywords : []) {
        const row = isObject(rowValue) ? rowValue : {};
        if (cleanIdentifier(row.keyword)) sources.push({ text: row.keyword, weight: 2 });
      }
    }
    return sources;
  }

  function scorePgySearchProfile(profile, facts) {
    const matched = new Set();
    let score = 0;
    const groups = [
      { terms: profile.ownBrandTerms, weight: 4 },
      { terms: profile.ownProductTerms, weight: 4 },
      { terms: profile.coreCategoryTerms, weight: 4 },
      { terms: profile.interestTerms, weight: 3 },
      { terms: profile.adjacentTerms, weight: 2 },
      { terms: profile.needTerms, weight: 1 },
    ];
    for (const source of pgyProfileEvidenceSources(facts)) {
      const text = normalizedKeywordText(source.text);
      for (const group of groups) {
        for (const term of group.terms || []) {
          if (!containsKeywordTerm(text, term)) continue;
          const key = `${profile.id}\u0000${normalizedKeywordText(term)}\u0000${text}`;
          if (matched.has(key)) continue;
          matched.add(key);
          score += group.weight * source.weight;
        }
      }
      if (profile.industry === 'pet' && /猫(?!超)|宠物|萌宠/u.test(text)) score += 4 * source.weight;
    }
    const evidenceTerms = [...new Set([...matched].map((value) => value.split('\u0000')[1]))]
      .filter(Boolean).slice(0, 8);
    return { score, evidenceTerms };
  }

  function resolvePgySearchProfile(facts, optionsValue) {
    const options = isObject(optionsValue) ? optionsValue : {};
    const explicitId = cleanIdentifier(options.profileId);
    if (explicitId && PGY_SEARCH_CLASSIFICATION_PROFILES[explicitId]) {
      return {
        profile: PGY_SEARCH_CLASSIFICATION_PROFILES[explicitId],
        selection: 'explicit',
        score: null,
        evidenceTerms: [],
      };
    }
    if (explicitId) throw new Error(`Unknown PGY search classification profile: ${explicitId}.`);
    const ranked = PGY_SEARCH_AUTODETECT_PROFILE_IDS.map((id, orderIndex) => ({
      profile: PGY_SEARCH_CLASSIFICATION_PROFILES[id],
      orderIndex,
      ...scorePgySearchProfile(PGY_SEARCH_CLASSIFICATION_PROFILES[id], facts),
    })).sort((left, right) => right.score - left.score || left.orderIndex - right.orderIndex);
    if (ranked[0] && ranked[0].score >= 4) {
      return { ...ranked[0], selection: 'auto' };
    }
    return {
      profile: PGY_SEARCH_CLASSIFICATION_PROFILES['cross-industry-generic-v1'],
      selection: 'fallback',
      score: ranked[0] ? ranked[0].score : 0,
      evidenceTerms: ranked[0] ? ranked[0].evidenceTerms : [],
    };
  }

  function publicPgySearchProfile(resolution) {
    const profile = resolution.profile;
    const confidenceScore = resolution.score === null
      ? 1
      : Math.min(1, Math.max(0, Number(resolution.score) || 0) / 24);
    return {
      id: profile.id,
      industry: profile.industry,
      label: profile.label,
      version: profile.version,
      scope: profile.scope,
      source: profile.source,
      selection: resolution.selection,
      confidenceScore,
      confidence: classificationConfidence(confidenceScore),
      evidenceTerms: resolution.evidenceTerms || [],
      interestCategory: profile.interestCategory,
      usageIntent: profile.usageIntent,
    };
  }

  function pgySearchClassificationContext(facts, optionsValue, resolution) {
    const options = isObject(optionsValue) ? optionsValue : {};
    const profile = resolution.profile;
    const factsConfigured = Object.prototype.hasOwnProperty.call(options, 'factsConfigured')
      ? options.factsConfigured === true
      : ['ownBrandTerms', 'ownProductTerms', 'competitorTerms'].some((key) => (
        Object.prototype.hasOwnProperty.call(options, key)
      ));
    return {
      profile,
      factsConfigured,
      ownBrandTerms: uniqueSearchTerms((profile.ownBrandTerms || []).concat(
        options.brandName || [], options.ownBrandTerms || []
      )),
      ownProductTerms: uniqueSearchTerms((profile.ownProductTerms || []).concat(
        factsConfigured ? [] : dynamicPgyProductTerms(facts), options.ownProductTerms || []
      )),
      competitorTerms: uniqueSearchTerms((profile.competitorTerms || []).concat(
        options.competitorTerms || []
      )),
    };
  }

  function hasIndustrySignal(value, profile) {
    const text = normalizedKeywordText(value);
    if (!text || (profile.industry === 'pet' && text === '猫超')) return false;
    if (firstKeywordTerm(text, profile.coreCategoryTerms || []) ||
        firstKeywordTerm(text, profile.adjacentTerms || []) ||
        firstKeywordTerm(text, profile.interestTerms || [])) return true;
    if (profile.industry === 'pet') {
      if (['猫', '宠物', '动物', '萌宠'].includes(text)) return true;
      return /^猫(?!超)/.test(text) || /猫$/.test(text) || text.includes('宠物');
    }
    return false;
  }

  function classificationConfidence(score) {
    return score >= 0.8 ? '高' : score >= 0.5 ? '中' : '低';
  }

  function commercialClassification(commercialCategory, relevance, confidenceScore, classificationReason) {
    return {
      commercialCategory,
      relevance,
      confidenceScore,
      confidence: classificationConfidence(confidenceScore),
      classificationReason,
    };
  }

  function classifyPgyKeywordCommercial(keyword, noteTitleContext, classificationContext) {
    const text = normalizedKeywordText(keyword);
    const context = normalizedKeywordText(noteTitleContext);
    const profile = classificationContext.profile;
    const strongAdjacentMatch = firstKeywordTerm(text, profile.strongAdjacentTerms || []);
    const brandMatch = firstKeywordTerm(text, classificationContext.ownBrandTerms);
    const ownProductMatch = firstKeywordTerm(text, classificationContext.ownProductTerms);
    const coreMatch = firstKeywordTerm(text, profile.coreCategoryTerms || []);
    if (brandMatch) {
      return commercialClassification('自有品牌词', '强相关', 0.98,
        `命中自有品牌/母公司词：${brandMatch}`);
    }

    const competitorMatch = firstKeywordTerm(text, classificationContext.competitorTerms || []);
    const contextualCompetitors = ['皇家', '领先', '有鱼', '起源', '猎奇', '顽皮'];
    const competitorProductContext = firstKeywordTerm(text, ['白金罐', '金罐']);
    if (competitorMatch && (
      profile.industry !== 'pet' || !contextualCompetitors.includes(competitorMatch) ||
      hasIndustrySignal(text, profile) || competitorProductContext
    )) {
      return commercialClassification('竞品词', '强相关', 0.9, `命中竞品词：${competitorMatch}`);
    }

    if (ownProductMatch) {
      return commercialClassification('自有产品词', '强相关', 0.95,
        `命中自有产品规则：${ownProductMatch}`);
    }

    if (strongAdjacentMatch) {
      return commercialClassification('邻近品类/场景', '中相关', 0.88,
        `命中明确用品词：${strongAdjacentMatch}`);
    }

    const unrelatedMatch = firstKeywordTerm(text, profile.unrelatedTerms || []);
    if (unrelatedMatch) {
      return commercialClassification('无关词', '无关', 0.92, `命中明确无关规则：${unrelatedMatch}`);
    }

    const needMatch = firstKeywordTerm(text, profile.needTerms || []);
    if (needMatch && (
      hasIndustrySignal(text, profile) || (profile.standaloneNeedTerms || []).includes(needMatch)
    )) {
      return commercialClassification('品类需求词', '强相关', 0.84,
        `命中品类需求词：${needMatch}`);
    }
    if (needMatch && hasIndustrySignal(context, profile)) {
      return commercialClassification('品类需求词', '强相关', 0.62,
        `关键词命中“${needMatch}”，并由关联笔记标题确认${profile.label}语境`);
    }

    if (coreMatch) {
      const score = (profile.genericCoreTerms || []).includes(coreMatch) && text === coreMatch
        ? 0.7
        : 0.88;
      return commercialClassification('核心品类词', '强相关', score,
        `命中核心品类词：${coreMatch}`);
    }

    const adjacentMatch = firstKeywordTerm(text, profile.adjacentTerms || []);
    if (adjacentMatch) {
      return commercialClassification('邻近品类/场景', '中相关', 0.75,
        `命中邻近品类或场景词：${adjacentMatch}`);
    }
    if (profile.industry === 'pet' && text === '猫超') {
      return commercialClassification('待确认', '待确认', 0.35,
        '“猫超”可能指购物渠道缩写，保留待确认');
    }
    const interestMatch = firstKeywordTerm(text, profile.interestTerms || []);
    if (interestMatch || hasIndustrySignal(text, profile)) {
      return commercialClassification(profile.interestCategory, '弱相关', 0.65,
        `命中${profile.label}兴趣规则：${interestMatch || '行业内容信号'}`);
    }
    if (hasIndustrySignal(context, profile)) {
      return commercialClassification(profile.interestCategory, '弱相关', 0.55,
        `关键词本身语义不明确，依据关联笔记标题推断为${profile.label}兴趣`);
    }
    return commercialClassification('待确认', '待确认', 0.35,
      '未命中稳定词典；保留待确认，避免误判为无关');
  }

  function classifyPgyKeywordIntent(keyword, commercial, classificationContext) {
    const text = normalizedKeywordText(keyword);
    const category = commercial.commercialCategory;
    const profile = classificationContext.profile;
    const brandInformationMatch = firstKeywordTerm(text, [
      '进口还是国产', '哪里的品牌', '哪个国家', '是哪国', '什么牌子',
    ]);
    if (brandInformationMatch && ['自有产品词', '自有品牌词', '竞品词'].includes(category)) {
      return { intent: '品牌/产品查找', intentReason: `命中品牌信息查找词：${brandInformationMatch}` };
    }
    const purchaseMatch = firstKeywordTerm(text, PGY_SEARCH_PURCHASE_INTENT_TERMS);
    if (purchaseMatch) return { intent: '购买决策', intentReason: `命中购买决策词：${purchaseMatch}` };
    const evaluationMatch = firstKeywordTerm(text, PGY_SEARCH_EVALUATION_INTENT_TERMS);
    if (evaluationMatch) return { intent: '对比评估', intentReason: `命中对比评估词：${evaluationMatch}` };
    const useMatch = firstKeywordTerm(text, profile.usageTerms || []);
    if (useMatch) {
      return { intent: profile.usageIntent, intentReason: `命中${profile.usageIntent}词：${useMatch}` };
    }
    const problemMatch = firstKeywordTerm(text, PGY_SEARCH_GENERIC_PROBLEM_INTENT_TERMS.concat(
      profile.problemTerms || [], [
      '是什么', '入口', '位置', '停车', '排队', '地铁站', '人多吗', '带什么',
      ]
    ));
    if (problemMatch) return { intent: '问题解决', intentReason: `命中问题解决词：${problemMatch}` };
    if (['自有产品词', '自有品牌词', '竞品词'].includes(category)) {
      return { intent: '品牌/产品查找', intentReason: '品牌或产品实体词，默认判为定向查找' };
    }
    if (['品类需求词', '核心品类词', '邻近品类/场景'].includes(category)) {
      return { intent: '品类探索', intentReason: '无更强动作词，按品类/场景探索处理' };
    }
    if (category === profile.interestCategory) {
      return { intent: '兴趣浏览', intentReason: `${profile.interestCategory}，默认判为兴趣浏览` };
    }
    return { intent: '意图不明确', intentReason: '关键词缺少足够的行为意图信号' };
  }

  function classifyPgySearchKeyword(keyword, noteTitleContext, classificationContext) {
    const commercial = classifyPgyKeywordCommercial(
      keyword, noteTitleContext, classificationContext
    );
    return {
      ...commercial,
      ...classifyPgyKeywordIntent(keyword, commercial, classificationContext),
    };
  }

  const PGY_SEARCH_ENTITY_LEGACY_LABELS = Object.freeze({
    own_product: '自有产品词',
    own_brand: '自有品牌词',
    competitor: '竞品词',
    adjacent: '邻近品类/场景',
    industry_interest: '泛行业兴趣词',
    irrelevant: '无关词',
    unknown: '待确认',
  });
  const PGY_SEARCH_TOPIC_LEGACY_LABELS = Object.freeze({
    need_pain_point: '品类需求词',
    safety_adverse_effect: '品类需求词',
    core_category: '核心品类词',
    usage_scenario: '邻近品类/场景',
    adjacent_category: '邻近品类/场景',
    industry_interest: '泛行业兴趣词',
    unrelated: '无关词',
    irrelevant: '无关词',
    unclear: '待确认',
  });
  const PGY_SEARCH_RELEVANCE_LEGACY_LABELS = Object.freeze({
    strong: '强相关', medium: '中相关', weak: '弱相关', none: '无关',
    unrelated: '无关', review: '待确认',
  });
  const PGY_SEARCH_INTENT_LEGACY_LABELS = Object.freeze({
    brand_product_lookup: '品牌/产品查找',
    category_exploration: '品类探索',
    problem_solving: '问题解决',
    comparison: '对比评估',
    purchase_decision: '购买决策',
    usage: '使用方法',
    interest_browsing: '兴趣浏览',
    unclear: '意图不明确',
  });
  const PGY_SEARCH_ARCHIVED_TOPIC_PRIORITY = Object.freeze([
    'safety_adverse_effect', 'need_pain_point', 'core_category', 'usage_scenario',
    'adjacent_category', 'industry_interest', 'unrelated',
  ]);
  const PGY_SEARCH_ARCHIVED_INTENT_PRIORITY = Object.freeze([
    'purchase_decision', 'comparison', 'problem_solving', 'usage',
    'brand_product_lookup', 'category_exploration', 'interest_browsing', 'unclear',
  ]);

  function archivedPgyPriorityItem(value, priority) {
    const candidates = new Map();
    for (const raw of Array.isArray(value) ? value : []) {
      const item = isObject(raw) ? raw : {};
      const id = cleanIdentifier(item.id);
      if (!id || !priority.includes(id) || candidates.has(id)) continue;
      candidates.set(id, item);
    }
    const selectedId = priority.find((id) => candidates.has(id));
    return selectedId ? { ...candidates.get(selectedId), id: selectedId } : null;
  }

  function archivedPgySearchClassification(keyword, optionsValue) {
    const options = isObject(optionsValue) ? optionsValue : {};
    const archive = isObject(options.classificationArchive)
      ? options.classificationArchive
      : isObject(options.searchClassificationArchive)
        ? options.searchClassificationArchive
        : {};
    const entries = Array.isArray(archive.entries) ? archive.entries : [];
    const normalizedKeyword = normalizedKeywordText(keyword);
    const requestedScope = cleanIdentifier(options.scopeKey) || '';
    const entry = entries.find((value) => {
      const candidate = isObject(value) ? value : {};
      const candidateScope = cleanIdentifier(candidate.scopeKey) || '';
      return normalizedKeywordText(candidate.normalizedKeyword || candidate.keyword) === normalizedKeyword &&
        (!requestedScope || !candidateScope || candidateScope === requestedScope);
    });
    const effective = isObject(entry && entry.effective) ? entry.effective : null;
    if (!effective || Number(effective.schemaVersion) !== 2) return null;
    const entity = isObject(effective.entity) ? effective.entity : {};
    const selectedTopic = archivedPgyPriorityItem(
      effective.topicTags, PGY_SEARCH_ARCHIVED_TOPIC_PRIORITY
    );
    const selectedIntent = archivedPgyPriorityItem(
      effective.intents, PGY_SEARCH_ARCHIVED_INTENT_PRIORITY
    );
    const topicTags = selectedTopic ? [selectedTopic] : [];
    const intents = selectedIntent ? [{ ...selectedIntent, isPrimary: true }] : [];
    const primaryIntent = intents[0] || {};
    const relevanceValue = isObject(effective.relevance) ? effective.relevance : {};
    const entityRelation = cleanIdentifier(entity.relation) || 'unknown';
    let commercialCategory = PGY_SEARCH_ENTITY_LEGACY_LABELS[entityRelation];
    if (!commercialCategory && entityRelation === 'generic_category') {
      commercialCategory = topicTags.map((tag) => (
        PGY_SEARCH_TOPIC_LEGACY_LABELS[cleanIdentifier(tag.id)]
      )).find(Boolean) || '核心品类词';
    }
    if (!commercialCategory) commercialCategory = '待确认';
    if (commercialCategory === '泛行业兴趣词') {
      const profile = options.profile || {};
      commercialCategory = cleanIdentifier(profile.interestCategory) || commercialCategory;
    }
    const confidenceScore = Math.min(1, Math.max(0, Number(effective.confidenceScore) || 0));
    const source = ['rule', 'qwen', 'hybrid', 'override', 'manual', 'fact'].includes(
      String(effective.source || '')
    ) ? String(effective.source) : 'rule';
    const sourceLabel = source === 'override' || source === 'manual'
      ? '人工纠正'
      : source === 'qwen'
        ? '千问语义分类'
        : source === 'hybrid'
          ? '规则与千问语义联合分类'
          : source === 'fact'
            ? '店铺事实分类'
            : '确定性规则分类';
    const intent = PGY_SEARCH_INTENT_LEGACY_LABELS[cleanIdentifier(primaryIntent.id)] ||
      cleanIdentifier(primaryIntent.label) || '意图不明确';
    const normalizedEffective = {
      ...effective,
      entity: { ...entity, relation: entityRelation },
      topicTags,
      intents,
      relevance: { ...relevanceValue },
      source,
      confidenceScore,
    };
    return {
      commercialCategory,
      relevance: PGY_SEARCH_RELEVANCE_LEGACY_LABELS[cleanIdentifier(relevanceValue.id)] ||
        cleanIdentifier(relevanceValue.label) || '待确认',
      intent,
      confidenceScore,
      confidence: classificationConfidence(confidenceScore),
      classificationReason: sourceLabel,
      intentReason: `${sourceLabel}主意图：${intent}`,
      classificationV2: normalizedEffective,
      classificationSource: source,
      needsReview: effective.needsReview === true,
      appliedOverrideId: cleanIdentifier(entry && entry.appliedOverrideId),
    };
  }

  function aggregatePgySearchDimension(keywords, key, label, order) {
    const groups = new Map(order.map((value, orderIndex) => [value, {
      value,
      orderIndex,
      keywordCount: 0,
      impressions: 0,
      impressionsComplete: true,
      reads: 0,
      readsComplete: true,
      noteIds: new Set(),
      keywordNotePairs: 0,
    }]));
    const totalNoteIds = new Set();
    let totalKeywordNotePairs = 0;
    for (const keyword of keywords) {
      const value = cleanIdentifier(keyword && keyword[key]) || '未分类';
      if (!groups.has(value)) {
        groups.set(value, {
          value,
          orderIndex: groups.size,
          keywordCount: 0,
          impressions: 0,
          impressionsComplete: true,
          reads: 0,
          readsComplete: true,
          noteIds: new Set(),
          keywordNotePairs: 0,
        });
      }
      const group = groups.get(value);
      group.keywordCount += 1;
      if (optionalNumber(keyword.impressions) === null) group.impressionsComplete = false;
      else group.impressions += keyword.impressions;
      if (optionalNumber(keyword.reads) === null) group.readsComplete = false;
      else group.reads += keyword.reads;
      for (const note of Array.isArray(keyword.notes) ? keyword.notes : []) {
        const noteId = cleanIdentifier(note && note.noteId);
        if (noteId) {
          group.noteIds.add(noteId);
          totalNoteIds.add(noteId);
        }
        group.keywordNotePairs += 1;
        totalKeywordNotePairs += 1;
      }
    }
    const totalImpressionsComplete = keywords.every((row) => optionalNumber(row.impressions) !== null);
    const totalReadsComplete = keywords.every((row) => optionalNumber(row.reads) !== null);
    const totalImpressions = totalImpressionsComplete
      ? keywords.reduce((sum, row) => sum + row.impressions, 0)
      : null;
    const totalReads = totalReadsComplete
      ? keywords.reduce((sum, row) => sum + row.reads, 0)
      : null;
    const rows = [...groups.values()].map((group) => {
      const impressions = group.impressionsComplete ? group.impressions : null;
      const reads = group.readsComplete ? group.reads : null;
      return {
        value: group.value,
        keywordCount: group.keywordCount,
        keywordShare: keywords.length ? group.keywordCount / keywords.length : 0,
        impressions,
        exposureShare: impressions !== null && totalImpressions !== null && totalImpressions > 0
          ? impressions / totalImpressions
          : null,
        reads,
        readShare: reads !== null && totalReads !== null && totalReads > 0
          ? reads / totalReads
          : null,
        clickRate: impressions !== null && reads !== null
          ? (impressions > 0 ? reads / impressions : reads === 0 ? 0 : null)
          : null,
        noteCount: group.noteIds.size,
        keywordNotePairs: group.keywordNotePairs,
        orderIndex: group.orderIndex,
      };
    }).sort((left, right) => {
      const leftImpressions = left.impressions === null ? -1 : left.impressions;
      const rightImpressions = right.impressions === null ? -1 : right.impressions;
      return rightImpressions - leftImpressions || left.orderIndex - right.orderIndex;
    }).map(({ orderIndex, ...row }) => row);
    return {
      key,
      label,
      totalKeywords: keywords.length,
      totalImpressions,
      totalReads,
      totalClickRate: totalImpressions !== null && totalReads !== null && totalImpressions > 0
        ? totalReads / totalImpressions
        : null,
      totalNoteCount: totalNoteIds.size,
      totalKeywordNotePairs,
      rows,
    };
  }

  function pgySearchKeywordSummaries(keywords) {
    return {
      commercialCategory: aggregatePgySearchDimension(
        keywords, 'commercialCategory', '商业分类', PGY_SEARCH_COMMERCIAL_CATEGORIES
      ),
      relevance: aggregatePgySearchDimension(
        keywords, 'relevance', '品类相关度', PGY_SEARCH_RELEVANCE_LEVELS
      ),
      intent: aggregatePgySearchDimension(
        keywords, 'intent', '搜索意图', PGY_SEARCH_INTENTS
      ),
    };
  }

  function normalizedPgySearchKeywordFilters(value) {
    const source = isObject(value) ? value : {};
    return {
      commercialCategory: cleanIdentifier(source.commercialCategory),
      relevance: cleanIdentifier(source.relevance),
      intent: cleanIdentifier(source.intent),
      topicTagId: cleanIdentifier(source.topicTagId),
      classificationSource: cleanIdentifier(source.classificationSource),
      reviewRequired: typeof source.reviewRequired === 'boolean' ? source.reviewRequired : null,
    };
  }

  function summarizePgySearchKeywords(keywordsValue) {
    const keywords = Array.isArray(keywordsValue) ? keywordsValue.filter(isObject) : [];
    return pgySearchKeywordSummaries(keywords);
  }

  function filterPgySearchKeywords(keywordsValue, filtersValue) {
    const sourceKeywords = Array.isArray(keywordsValue) ? keywordsValue.filter(isObject) : [];
    const filters = normalizedPgySearchKeywordFilters(filtersValue);
    const keywords = sourceKeywords.filter((row) => (
      (!filters.commercialCategory || cleanIdentifier(row.commercialCategory) === filters.commercialCategory) &&
      (!filters.relevance || cleanIdentifier(row.relevance) === filters.relevance) &&
      (!filters.intent || cleanIdentifier(row.intent) === filters.intent) &&
      (!filters.topicTagId || (Array.isArray(row.classificationV2 && row.classificationV2.topicTags) &&
        row.classificationV2.topicTags.some((tag) => cleanIdentifier(tag && tag.id) === filters.topicTagId))) &&
      (!filters.classificationSource || cleanIdentifier(row.classificationSource) === filters.classificationSource) &&
      (filters.reviewRequired === null || Boolean(row.needsReview) === filters.reviewRequired)
    ));
    const summaries = pgySearchKeywordSummaries(keywords);
    const total = summaries.commercialCategory;
    return {
      filters,
      keywords,
      summaries,
      total: {
        keywordCount: keywords.length,
        impressions: total.totalImpressions,
        reads: total.totalReads,
        clickRate: total.totalClickRate,
        noteCount: total.totalNoteCount,
        keywordNotePairs: total.totalKeywordNotePairs,
      },
    };
  }

  function aggregatePgySearchKeywords(factsValue, limitValue, optionsValue) {
    const facts = Array.isArray(factsValue) ? factsValue : [];
    const options = isObject(limitValue)
      ? limitValue
      : isObject(optionsValue) ? optionsValue : {};
    const requestedLimit = Math.floor(Number(isObject(limitValue) ? options.limit : limitValue));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? requestedLimit
      : Number.POSITIVE_INFINITY;
    const profileResolution = resolvePgySearchProfile(facts, options);
    const classificationContext = pgySearchClassificationContext(
      facts, options, profileResolution
    );
    const byKeyword = new Map();
    let completeNoteCount = 0;
    let emptyNoteCount = 0;
    let failedNoteCount = 0;
    const failureCodeCounts = {};
    let unavailableNoteCount = 0;
    let invalidCompleteNoteCount = 0;

    for (const factValue of facts) {
      const fact = isObject(factValue) ? factValue : {};
      const status = Object.prototype.hasOwnProperty.call(fact, 'searchKeywordFetchStatus')
        ? String(fact.searchKeywordFetchStatus || '')
        : '';
      const rows = Array.isArray(fact.searchKeywords) ? fact.searchKeywords : [];
      if (status === 'empty') {
        emptyNoteCount += 1;
        continue;
      }
      if (status === 'failed') {
        failedNoteCount += 1;
        const requestedCode = cleanIdentifier(fact.searchKeywordErrorCode);
        const failureCode = requestedCode && /^[A-Za-z0-9_:-]{1,128}$/.test(requestedCode)
          ? requestedCode
          : 'unknown';
        failureCodeCounts[failureCode] = (failureCodeCounts[failureCode] || 0) + 1;
        continue;
      }
      if (status !== 'complete') {
        unavailableNoteCount += 1;
        continue;
      }
      if (rows.length === 0) {
        invalidCompleteNoteCount += 1;
        unavailableNoteCount += 1;
        continue;
      }
      completeNoteCount += 1;
      for (const rowValue of rows) {
        const row = isObject(rowValue) ? rowValue : {};
        const keyword = cleanIdentifier(row.keyword);
        if (!keyword) continue;
        const rawImpressions = optionalNumber(row.impressions);
        const impressions = rawImpressions !== null && rawImpressions >= 0 ? rawImpressions : null;
        const rawReads = optionalNumber(row.reads);
        const reads = rawReads !== null && rawReads >= 0 ? rawReads : null;
        const rawSearchScore = optionalNumber(row.searchScore);
        const searchScore = rawSearchScore !== null && rawSearchScore >= 0
          ? rawSearchScore
          : null;
        const clickRate = normalizedRate(row.clickRate);
        if (!byKeyword.has(keyword)) {
          byKeyword.set(keyword, {
            keyword,
            noteCount: 0,
            impressions: 0,
            impressionsComplete: true,
            reads: 0,
            readsComplete: true,
            weightedClickRate: 0,
            weightedClickRateDenominator: 0,
            fallbackClickRate: null,
            searchScores: new Set(),
            notes: [],
          });
        }
        const state = byKeyword.get(keyword);
        state.noteCount += 1;
        state.notes.push({
          noteId: cleanIdentifier(fact.noteId),
          title: cleanIdentifier(fact.title),
          publishDate: canonicalDate(fact.publishDate),
          noteUrl: cleanIdentifier(fact.noteUrl),
          impressions,
          reads,
          clickRate,
        });
        if (impressions === null) state.impressionsComplete = false;
        else state.impressions += impressions;
        if (reads === null) state.readsComplete = false;
        else state.reads += reads;
        if (searchScore !== null) state.searchScores.add(searchScore);
        if (clickRate !== null) {
          state.fallbackClickRate = state.fallbackClickRate === null
            ? clickRate
            : state.fallbackClickRate;
          if (impressions !== null && impressions > 0) {
            state.weightedClickRate += clickRate * impressions;
            state.weightedClickRateDenominator += impressions;
          }
        }
      }
    }

    const allKeywords = [...byKeyword.values()].map((state) => {
      const impressions = state.impressionsComplete ? state.impressions : null;
      const reads = state.readsComplete ? state.reads : null;
      let clickRate = null;
      if (impressions !== null && reads !== null) {
        clickRate = impressions > 0 ? reads / impressions : reads === 0 ? 0 : null;
      } else if (state.weightedClickRateDenominator > 0) {
        clickRate = state.weightedClickRate / state.weightedClickRateDenominator;
      } else {
        clickRate = state.fallbackClickRate;
      }
      const searchScore = state.searchScores.size === 1
        ? [...state.searchScores][0]
        : null;
      const notes = state.notes.sort((left, right) => {
        const leftImpressions = left.impressions === null ? -1 : left.impressions;
        const rightImpressions = right.impressions === null ? -1 : right.impressions;
        if (rightImpressions !== leftImpressions) return rightImpressions - leftImpressions;
        return String(right.publishDate || '').localeCompare(String(left.publishDate || ''));
      }).map((note) => ({
        ...note,
        impressionContribution: impressions !== null && impressions > 0 && note.impressions !== null
          ? note.impressions / impressions
          : null,
      }));
      const titleContext = notes.map((note) => note.title || '').join(' ');
      const ruleClassification = classifyPgySearchKeyword(
        state.keyword, titleContext, classificationContext
      );
      const archivedClassification = archivedPgySearchClassification(state.keyword, {
        ...options,
        profile: classificationContext.profile,
      });
      return {
        keyword: state.keyword,
        searchScore,
        impressions,
        reads,
        clickRate,
        noteCount: notes.length,
        notes,
        ...ruleClassification,
        ...(archivedClassification || {}),
      };
    }).sort((left, right) => {
      const leftImpressions = left.impressions === null ? -1 : left.impressions;
      const rightImpressions = right.impressions === null ? -1 : right.impressions;
      if (rightImpressions !== leftImpressions) return rightImpressions - leftImpressions;
      const leftReads = left.reads === null ? -1 : left.reads;
      const rightReads = right.reads === null ? -1 : right.reads;
      if (rightReads !== leftReads) return rightReads - leftReads;
      return left.keyword.localeCompare(right.keyword, 'zh-CN');
    }).map((row, index) => ({ ...row, rank: index + 1 }));
    const keywords = allKeywords.slice(0, limit);
    const coveredNoteCount = completeNoteCount + emptyNoteCount;
    return {
      profile: publicPgySearchProfile(profileResolution),
      keywords,
      summaries: pgySearchKeywordSummaries(allKeywords),
      totalKeywordCount: allKeywords.length,
      truncated: allKeywords.length > keywords.length,
      coverage: {
        totalNoteCount: facts.length,
        coveredNoteCount,
        completeNoteCount,
        emptyNoteCount,
        failedNoteCount,
        failureCodeCounts,
        unavailableNoteCount,
        invalidCompleteNoteCount,
        status: facts.length === 0
          ? 'empty'
          : coveredNoteCount === facts.length
            ? 'complete'
            : coveredNoteCount > 0
              ? 'partial'
              : 'unavailable',
      },
    };
  }

  function aggregatePgyFacts(input) {
    const source = isObject(input) ? input : {};
    if (!Array.isArray(source.facts)) throw new Error('PGY facts must be an array.');
    const range = normalizedDateRange(source.dateRange);
    const asOf = canonicalDate(source.asOf);
    const selectedSpuName = cleanIdentifier(source.spuName);
    if (!range.from || !range.to || range.from > range.to) {
      throw new Error('PGY dateRange must be a valid closed interval.');
    }
    const notes = [];
    let invalidPublishDate = 0;
    let outsideRange = 0;
    for (const rawFact of source.facts) {
      const fact = isObject(rawFact) ? rawFact : {};
      const publishDate = canonicalDate(fact.publishDate);
      if (!publishDate) {
        invalidPublishDate += 1;
        continue;
      }
      if (publishDate < range.from || publishDate > range.to) {
        outsideRange += 1;
        continue;
      }
      const spuName = cleanIdentifier(fact.spuName);
      if (selectedSpuName && spuName !== selectedSpuName) continue;
      notes.push({ ...fact, publishDate, spuName });
    }

    const costs = notes.reduce((result, note) => {
      const values = isObject(note.costs) ? note.costs : {};
      result.cooperation += finiteNumber(values.cooperation);
      result.platformFee += finiteNumber(values.platformFee);
      result.total = result.cooperation + result.platformFee;
      return result;
    }, { cooperation: 0, platformFee: 0, total: 0 });
    const metrics = notes.reduce((result, note) => {
      const values = isObject(note.metrics) ? note.metrics : {};
      result.impressions += finiteNumber(values.impressions);
      result.reads += finiteNumber(values.reads);
      result.interactions += finiteNumber(values.interactions);
      return result;
    }, { impressions: 0, reads: 0, interactions: 0 });
    metrics.readRate = ratio(metrics.reads, metrics.impressions);
    metrics.engagementRate = ratio(metrics.interactions, metrics.reads);
    const taobaoAccumulator = notes.reduce((result, note) => {
      const values = isObject(note.metrics) ? note.metrics : {};
      const sampling = normalizedSamplingRatio(note.taobaoSamplingRatio);
      const activeUv = optionalNumber(values.taobaoOffsiteActiveUv15d);
      const activeCost = optionalNumber(values.taobaoOffsiteActiveCost15d);
      const dealUv = optionalNumber(values.taobaoDealUv15d);
      const addCartUv = optionalNumber(values.taobaoAddCartUv15d);
      result.offsiteActiveUv += activeUv === null ? 0 : activeUv;
      result.dealUv += dealUv === null ? 0 : dealUv;
      result.addCartUv += addCartUv === null ? 0 : addCartUv;
      if (sampling !== null) {
        const adjustedActive = activeUv === null ? null : activeUv / sampling;
        if (adjustedActive !== null) {
          result.adjustedActiveUv += adjustedActive;
          if (activeCost !== null) result.activeCostNumerator += activeCost * adjustedActive;
          else result.activeCostComplete = false;
        }
        if (dealUv !== null) result.adjustedDealUv += dealUv / sampling;
        if (addCartUv !== null) result.adjustedAddCartUv += addCartUv / sampling;
      } else if (activeUv !== null || dealUv !== null || addCartUv !== null) {
        result.samplingComplete = false;
      }
      return result;
    }, {
      offsiteActiveUv: 0,
      dealUv: 0,
      addCartUv: 0,
      adjustedActiveUv: 0,
      adjustedDealUv: 0,
      adjustedAddCartUv: 0,
      activeCostNumerator: 0,
      activeCostComplete: true,
      samplingComplete: true,
    });
    const taobao15d = {
      offsiteActiveUv: taobaoAccumulator.offsiteActiveUv,
      offsiteActiveCost: taobaoAccumulator.samplingComplete && taobaoAccumulator.activeCostComplete
        ? ratio(taobaoAccumulator.activeCostNumerator, taobaoAccumulator.adjustedActiveUv)
        : null,
      dealUv: taobaoAccumulator.dealUv,
      addCartUv: taobaoAccumulator.addCartUv,
      addCartRate: taobaoAccumulator.samplingComplete
        ? ratio(taobaoAccumulator.adjustedAddCartUv, metrics.reads)
        : null,
      purchaseRate: taobaoAccumulator.samplingComplete
        ? ratio(taobaoAccumulator.adjustedDealUv, metrics.reads)
        : null,
    };
    const stableProfile = resolvePgySearchProfile(source.facts, source.searchClassification);
    const searchKeywordSummary = aggregatePgySearchKeywords(notes, {
      ...(isObject(source.searchClassification) ? source.searchClassification : {}),
      profileId: stableProfile.profile.id,
    });

    const monthCounts = new Map(monthsInRange(range).map((month) => [month, 0]));
    for (const note of notes) {
      const month = note.publishDate.slice(0, 7);
      if (monthCounts.has(month)) monthCounts.set(month, monthCounts.get(month) + 1);
    }

    const tierState = new Map(PGY_FOLLOWER_TIERS.map((tier) => [tier.key, {
      noteCount: 0, authorKeys: new Set(), cooperationCost: 0,
    }]));
    const excludedTiers = {
      below1k: { noteCount: 0, authorKeys: new Set() },
      unknown: { noteCount: 0, authorKeys: new Set() },
    };
    for (const note of notes) {
      const author = isObject(note.author) ? note.author : {};
      const followerCount = optionalNumber(author.followerCount);
      const authorKey = String(author.id || author.name || `note:${String(note.noteId || '')}`);
      if (followerCount === null) {
        excludedTiers.unknown.noteCount += 1;
        excludedTiers.unknown.authorKeys.add(authorKey);
        continue;
      }
      if (followerCount < 1000) {
        excludedTiers.below1k.noteCount += 1;
        excludedTiers.below1k.authorKeys.add(authorKey);
        continue;
      }
      const tier = PGY_FOLLOWER_TIERS.find((item) => (
        followerCount >= item.min && followerCount < item.max
      ));
      if (!tier) continue;
      const state = tierState.get(tier.key);
      state.noteCount += 1;
      state.authorKeys.add(authorKey);
      state.cooperationCost += finiteNumber(note.costs && note.costs.cooperation);
    }
    return {
      noteCount: notes.length,
      reportedNoteCount: notes.length,
      selectedSpuName,
      spuOptions: pgySpuOptions(source.facts),
      facts: notes,
      asOf,
      starTaskNoteCount: notes.reduce((count, note) => (
        count + (cleanIdentifier(note.taobaoTaskId) ? 1 : 0)
      ), 0),
      overdueNoteCount: asOf
        ? notes.reduce((count, note) => {
          const taskEndDate = canonicalDate(note.taskEndDate);
          return count + (taskEndDate && asOf > taskEndDate ? 1 : 0);
        }, 0)
        : null,
      costs,
      metrics,
      taobao15d,
      searchKeywords: searchKeywordSummary.keywords,
      searchKeywordCoverage: searchKeywordSummary.coverage,
      searchKeywordProfile: searchKeywordSummary.profile,
      searchKeywordSummaries: searchKeywordSummary.summaries,
      searchKeywordTotalCount: searchKeywordSummary.totalKeywordCount,
      searchKeywordTruncated: searchKeywordSummary.truncated,
      monthly: [...monthCounts.entries()].map(([month, noteCount]) => ({ month, noteCount })),
      followerTiers: PGY_FOLLOWER_TIERS.map((tier) => {
        const state = tierState.get(tier.key);
        return {
          key: tier.key,
          label: tier.label,
          noteCount: state.noteCount,
          authorCount: state.authorKeys.size,
          cooperationCost: state.cooperationCost,
          averageCooperationCost: ratio(state.cooperationCost, state.noteCount),
        };
      }),
      followerTierExcluded: {
        below1k: {
          noteCount: excludedTiers.below1k.noteCount,
          authorCount: excludedTiers.below1k.authorKeys.size,
        },
        unknown: {
          noteCount: excludedTiers.unknown.noteCount,
          authorCount: excludedTiers.unknown.authorKeys.size,
        },
      },
      excluded: { invalidPublishDate, outsideRange },
    };
  }

  function normalizeObjective(value) {
    if (value === null || value === undefined || value === '') return 'unknown';
    const text = String(value).trim();
    const compact = text.toLowerCase().replace(/[\s_-]/g, '');
    if (text === '4' || compact === '产品种草' || compact === 'productseeding') {
      return 'product_seeding';
    }
    if (text === '13' || compact === '种草直达' || compact === 'direct') return 'direct';
    return text || 'unknown';
  }

  function normalizeDeliveryMode(value) {
    if (value === null || value === undefined || value === '') return 'unknown';
    const text = String(value).trim();
    if (text === '0' || text === '手动投放') return 0;
    if (text === '1' || text === '自动投放') return 1;
    return value;
  }

  function normalizePlacementType(value) {
    if (value === null || value === undefined || value === '') return 'unknown';
    return typeof value === 'string' ? value.trim() || 'unknown' : value;
  }

  function dimensionValue(row, dimension) {
    const source = isObject(row) ? row : {};
    if (dimension === 'account') {
      const key = source.accountId === null || source.accountId === undefined || source.accountId === ''
        ? 'unknown'
        : String(source.accountId);
      const label = source.accountName === null || source.accountName === undefined || source.accountName === ''
        ? (key === 'unknown' ? '未知广告账户' : key)
        : String(source.accountName);
      return { key, label };
    }
    if (dimension === 'marketingObjective') {
      const key = normalizeObjective(source.marketingObjective);
      return { key, label: OBJECTIVE_LABELS[key] || String(key) };
    }
    if (dimension === 'placementType') {
      const key = normalizePlacementType(source.placementType);
      return { key, label: key === 'unknown' ? '未知投放位置' : String(key) };
    }
    if (dimension === 'deliveryMode') {
      const key = normalizeDeliveryMode(source.deliveryMode);
      return { key, label: DELIVERY_MODE_LABELS[key] || String(key) };
    }
    throw new Error(`Unsupported Spotlight dimension: ${String(dimension)}`);
  }

  function comparable(value, dimension) {
    if (dimension === 'marketingObjective') return String(normalizeObjective(value));
    if (dimension === 'placementType') return String(normalizePlacementType(value));
    if (dimension === 'deliveryMode') return String(normalizeDeliveryMode(value));
    return value === null || value === undefined || value === '' ? 'unknown' : String(value);
  }

  function validateGroupBy(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
      throw new Error('Spotlight groupBy must contain 1-3 dimensions.');
    }
    const groupBy = value.map((dimension) => String(dimension));
    if (new Set(groupBy).size !== groupBy.length) {
      throw new Error('Spotlight groupBy dimensions must not contain duplicates.');
    }
    for (const dimension of groupBy) {
      if (!DIMENSIONS.includes(dimension)) {
        throw new Error(`Spotlight groupBy dimension is not allowlisted: ${dimension}`);
      }
    }
    return groupBy;
  }

  function normalizedFilters(value) {
    const source = value === undefined || value === null ? {} : value;
    if (!isObject(source)) throw new Error('Spotlight filters must be an object.');
    for (const key of Object.keys(source)) {
      if (!Object.prototype.hasOwnProperty.call(FILTERS, key)) {
        throw new Error(`Spotlight filter is not allowlisted: ${key}`);
      }
      if (!Array.isArray(source[key])) throw new Error(`Spotlight filter ${key} must be an array.`);
    }
    return Object.fromEntries(Object.entries(FILTERS).map(([filter, dimension]) => [
      filter,
      new Set((source[filter] || []).map((item) => comparable(item, dimension))),
    ]));
  }

  function matchesFilters(row, filters) {
    for (const [filter, dimension] of Object.entries(FILTERS)) {
      const accepted = filters[filter];
      if (!accepted.size) continue;
      const actual = dimensionValue(row, dimension).key;
      if (!accepted.has(comparable(actual, dimension))) return false;
    }
    return true;
  }

  function summarizeRows(rows) {
    const summary = {
      rowCount: rows.length,
      noteCount: 0,
      spend: { total: 0, inTask: 0, outsideTask: 0, unknown: 0 },
      impressions: 0,
      clicks: 0,
      interactions: 0,
      seedUsers: 0,
      deepSeedUsers: 0,
      seedingExternal15: {
        observability: 'none',
        seedingSpend: 0,
        activeUv: null,
        calculatedCost: null,
      },
      conversion15: {
        observability: 'none',
        directSpend: 0,
        storeVisits: null,
        orders: null,
        gmv: null,
        calculatedRoi15: null,
        // externalRoi15 is non-additive. The exact platform value remains on
        // each daily fact row and must never be averaged into a group.
        platformRoi15: null,
      },
    };
    const noteIds = new Set();
    let observableDirectRows = 0;
    let unobservableDirectRows = 0;
    let unknownObjectiveRows = 0;
    const platformRoiValues = [];
    let observableSeedingRows = 0;
    let unobservableSeedingRows = 0;
    let seedingActiveUv = 0;

    for (const rawRow of rows) {
      const row = isObject(rawRow) ? rawRow : {};
      if (row.noteId !== null && row.noteId !== undefined && row.noteId !== '') {
        noteIds.add(String(row.noteId));
      }
      const spend = finiteNumber(row.spend);
      summary.spend.total += spend;
      if (row.taskStatus === 'in_task') summary.spend.inTask += spend;
      else if (row.taskStatus === 'out_of_task' || row.taskStatus === 'no_task') {
        summary.spend.outsideTask += spend;
      } else {
        summary.spend.unknown += spend;
      }
      summary.impressions += finiteNumber(row.impressions);
      summary.clicks += finiteNumber(row.clicks);
      summary.interactions += finiteNumber(row.interactions);
      summary.seedUsers += finiteNumber(row.seedUsers);
      summary.deepSeedUsers += finiteNumber(row.deepSeedUsers);

      const objective = normalizeObjective(row.marketingObjective);
      if (objective === 'product_seeding') {
        summary.seedingExternal15.seedingSpend += spend;
        const external = isObject(row.seedingExternal15) ? row.seedingExternal15 : {};
        const activeUv = optionalNumber(external.activeUv);
        if (external.observable === true && activeUv !== null && activeUv >= 0) {
          observableSeedingRows += 1;
          seedingActiveUv += activeUv;
        } else {
          unobservableSeedingRows += 1;
        }
      }
      const conversion = isObject(row.conversion) ? row.conversion : {};
      if (objective === 'direct') summary.conversion15.directSpend += spend;
      if (objective === 'direct' && conversion.observable === true) {
        observableDirectRows += 1;
        summary.conversion15.storeVisits = (summary.conversion15.storeVisits ?? 0) +
          finiteNumber(conversion.storeVisits);
        summary.conversion15.orders = (summary.conversion15.orders ?? 0) +
          finiteNumber(conversion.orders);
        summary.conversion15.gmv = (summary.conversion15.gmv ?? 0) + finiteNumber(conversion.gmv);
        const platformRoi = optionalNumber(conversion.platformRoi15);
        if (platformRoi !== null) platformRoiValues.push(platformRoi);
      } else {
        if (objective === 'direct') unobservableDirectRows += 1;
        if (objective === 'unknown') unknownObjectiveRows += 1;
      }
    }

    summary.noteCount = noteIds.size;
    summary.seedingExternal15.observability = observableSeedingRows && unobservableSeedingRows
      ? 'partial'
      : observableSeedingRows
        ? 'observable'
        : unobservableSeedingRows
          ? 'unobservable'
          : 'none';
    if (unobservableSeedingRows === 0 && observableSeedingRows > 0) {
      summary.seedingExternal15.activeUv = seedingActiveUv;
      summary.seedingExternal15.calculatedCost = ratio(
        summary.seedingExternal15.seedingSpend,
        seedingActiveUv
      );
    }
    summary.conversion15.observability = observableDirectRows && unobservableDirectRows
      ? 'partial'
      : observableDirectRows
        ? 'observable'
        : unobservableDirectRows
          ? 'unobservable'
          : unknownObjectiveRows
            ? 'unknown'
            : rows.length
              ? 'unobservable'
              : 'none';
    if (unobservableDirectRows > 0) {
      summary.conversion15.storeVisits = null;
      summary.conversion15.orders = null;
      summary.conversion15.gmv = null;
    }
    summary.conversion15.calculatedRoi15 = unobservableDirectRows > 0
      ? null
      : ratio(summary.conversion15.gmv, summary.conversion15.directSpend);
    if (observableDirectRows > 0 && unobservableDirectRows === 0 &&
        platformRoiValues.length === observableDirectRows) {
      const uniquePlatformRois = [...new Set(platformRoiValues.map(String))];
      if (uniquePlatformRois.length === 1) {
        summary.conversion15.platformRoi15 = platformRoiValues[0];
      }
    }
    return summary;
  }

  function buildGroups(rows, groupBy, depth) {
    const dimension = groupBy[depth];
    const grouped = new Map();
    for (const row of rows) {
      const value = dimensionValue(row, dimension);
      const identity = `${typeof value.key}:${String(value.key)}`;
      if (!grouped.has(identity)) grouped.set(identity, { ...value, rows: [] });
      grouped.get(identity).rows.push(row);
    }
    const nodes = [...grouped.values()].map((group) => ({
      dimension,
      key: group.key,
      label: group.label,
      level: depth + 1,
      summary: summarizeRows(group.rows),
      children: depth + 1 < groupBy.length
        ? buildGroups(group.rows, groupBy, depth + 1)
        : [],
    }));
    return nodes.sort((left, right) => (
      right.summary.spend.total - left.summary.spend.total ||
      String(left.label).localeCompare(String(right.label), 'zh-CN')
    ));
  }

  function aggregateSpotlight(input) {
    const source = isObject(input) ? input : {};
    if (!Array.isArray(source.rows)) throw new Error('Spotlight rows must be an array.');
    const groupBy = validateGroupBy(source.groupBy);
    const filters = normalizedFilters(source.filters);
    const rows = source.rows.filter((row) => matchesFilters(row, filters));
    return {
      groupBy,
      summary: summarizeRows(rows),
      groups: buildGroups(rows, groupBy, 0),
    };
  }

  return {
    DIMENSIONS,
    aggregatePgyFacts,
    aggregatePgySearchKeywords,
    aggregateSpotlight,
    filterPgySearchKeywords,
    summarizePgySearchKeywords,
  };
});

/**
 * Rental OS 2.0 copy and language preferences.
 * Text-only bindings preserve the existing media, carousel nodes and animation state.
 * To edit copy, update index.html's Chinese fallback and the matching entry below.
 */
(() => {
  "use strict";

  const copy = {
    "demo.close": { zh: "关闭预约表单", en: "Close demo request" },
    "demo.intro": {
      zh: "留下联系方式，我们与你沟通业务需求和演示安排。",
      en: "Leave your contact details so we can discuss your business and arrange a demo.",
    },
    "demo.name": { zh: "姓名（必填）", en: "Name (required)" },
    "demo.type": { zh: "联系类型", en: "Contact method" },
    "demo.phone": { zh: "手机", en: "Phone" },
    "demo.email": { zh: "邮箱", en: "Email" },
    "demo.wechat": { zh: "微信", en: "WeChat" },
    "demo.contact": {
      zh: "联系方式（必填）",
      en: "Contact details (required)",
    },
    "demo.company": {
      zh: "公司 / 门店名称（选填）",
      en: "Company / store (optional)",
    },
    "demo.message": {
      zh: "想了解什么？（选填）",
      en: "What would you like to explore? (optional)",
    },
    "demo.privacy": {
      zh: "提交即表示你同意 Rental OS 使用以上信息联系你，沟通本次演示；不会自动注册账号或订阅营销消息。",
      en: "By submitting, you agree that Rental OS may use these details to contact you about this demo. This does not create an account or subscribe you to marketing.",
    },
    "demo.submit": { zh: "提交预约", en: "Request a demo" },
    "demo.submitting": { zh: "正在提交…", en: "Sending…" },
    "demo.successTitle": { zh: "预约已收到", en: "Request received" },
    "demo.successBody": {
      zh: "我们会通过你留下的联系方式与你沟通，确定演示时间。",
      en: "We will contact you using the details you provided to arrange a demo time.",
    },
    "demo.done": { zh: "完成", en: "Done" },
    "demo.requiredName": { zh: "请填写姓名。", en: "Enter your name." },
    "demo.invalidContact": {
      zh: "请检查联系方式：手机需 7–20 位数字，邮箱需完整地址，微信需 3–80 位字母、数字、下划线或短横线。",
      en: "Check your contact details: phone numbers need 7–20 digits; email needs a full address; WeChat IDs need 3–80 letters, digits, underscores or hyphens.",
    },
    "demo.invalidFields": {
      zh: "请检查填写内容和长度后重试。",
      en: "Check the form fields and their length, then try again.",
    },
    "demo.unconfigured": {
      zh: "预约服务尚未配置，请稍后再试。",
      en: "Demo requests are not configured yet. Please try again later.",
    },
    "demo.networkError": {
      zh: "暂时无法确认提交结果，请重试；重复点击不会重复登记同一份预约。",
      en: "We could not confirm your submission. Please retry; retrying this request will not create a duplicate.",
    },
    "demo.rateLimited": {
      zh: "提交过于频繁，请 10 分钟后重试。",
      en: "Too many requests. Please try again in 10 minutes.",
    },
    "demo.conflict": {
      zh: "提交标识已更新，请再次提交。",
      en: "The request reference has been renewed. Please submit again.",
    },

    skip: {
      zh: "跳到主要内容",
      en: "Skip to content",
    },
    "nav.products": {
      zh: "产品能力",
      en: "Capabilities",
    },
    "product.booking": {
      zh: "预约与库存",
      en: "Booking & inventory",
    },
    "product.fulfillment": {
      zh: "订单与履约",
      en: "Orders & fulfillment",
    },
    "nav.more": {
      zh: "多门店与经营协同",
      en: "Multi-location operations",
    },
    "nav.plans": {
      zh: "版本与定价",
      en: "Plans & pricing",
    },
    "nav.security": {
      zh: "权限与数据",
      en: "Permissions & data",
    },
    "nav.resources": {
      zh: "资源中心",
      en: "Resources",
    },
    "nav.blog": {
      zh: "产品动态",
      en: "Product updates",
    },
    "nav.cases": {
      zh: "业务场景",
      en: "Use cases",
    },
    "nav.helpBooking": {
      zh: "预约使用指南",
      en: "Booking guide",
    },
    "nav.helpOrders": {
      zh: "履约使用指南",
      en: "Fulfillment guide",
    },
    "nav.company": {
      zh: "关于我们",
      en: "Company",
    },
    "nav.about": {
      zh: "关于 Rental OS",
      en: "About Rental OS",
    },
    "nav.careers": {
      zh: "加入我们",
      en: "Careers",
    },
    "nav.contact": {
      zh: "联系我们",
      en: "Contact us",
    },
    "nav.signIn": {
      zh: "登录后台",
      en: "Sign in",
    },
    "cta.demo": {
      zh: "预约演示",
      en: "Book a demo",
    },
    "hero.platform1": {
      zh: "让租赁更简单。",
      en: "Make rental simpler.",
    },
    "hero.platform2": {
      zh: "让经营更高效。",
      en: "Make operations smarter.",
    },
    "hero.platformBody1": {
      zh: "预约、订单、库存、履约与结算，在同一个平台协同。",
      en: "Booking, orders, inventory, fulfillment and settlement. Connected in one platform.",
    },
    "hero.platformBody2": {
      zh: "一套底座，适配多种租赁业务。",
      en: "One foundation for every rental category.",
    },
    "cta.how": {
      zh: "了解平台",
      en: "Explore the platform",
    },
    "hero.booking1": {
      zh: "看清可租库存，",
      en: "Know what is available.",
    },
    "hero.booking2": {
      zh: "掌握每个档期。",
      en: "Stay on top of every booking.",
    },
    "hero.booking3": {
      zh: "预约更从容。",
      en: "Book with confidence.",
    },
    "hero.bookingBody": {
      zh: "连接商品、库存与可租日历，减少档期冲突和反复沟通。",
      en: "Connect inventory and availability calendars. Reduce booking conflicts and back-and-forth.",
    },
    "cta.booking": {
      zh: "查看预约能力",
      en: "Explore booking",
    },
    "hero.order1": {
      zh: "从下单到归还，",
      en: "From booking to return.",
    },
    "hero.order2": {
      zh: "全程有迹可循。",
      en: "Every step, traceable.",
    },
    "hero.orderBody": {
      zh: "交付、租用、归还与结算，串起完整的租赁履约流程。",
      en: "Keep delivery, rental, return and settlement connected throughout the rental lifecycle.",
    },
    "cta.orders": {
      zh: "查看履约能力",
      en: "Explore fulfillment",
    },
    "hero.platformTab": {
      zh: "Rental OS 平台",
      en: "Rental OS",
    },
    "product.more": {
      zh: "多门店与经营协同",
      en: "Multi-location operations",
    },
    "hero.pause": {
      zh: "暂停首屏轮播",
      en: "Pause autoplay",
    },
    "flow.eyebrow": {
      zh: "预约。交付。归还。",
      en: "Book. Deliver. Return.",
    },
    "flow.heading1": {
      zh: "连接租赁业务的",
      en: "Connect every step",
    },
    "flow.heading2": {
      zh: "每一个环节。",
      en: "of the rental lifecycle.",
    },
    "products.eyebrow": {
      zh: "一个平台，连接经营全流程。",
      en: "One platform. Your entire operation.",
    },
    "products.heading1": {
      zh: "把繁琐的租赁，",
      en: "Turn rental complexity",
    },
    "products.heading2": {
      zh: "变成有序的经营。",
      en: "into connected operations.",
    },
    "products.body": {
      zh: "不同品类、门店与团队，共享一套灵活的租赁业务底座。",
      en: "Different categories, locations and teams. One flexible rental foundation.",
    },
    "product.bookingStatus": {
      zh: "商品 · 库存 · 可租日历",
      en: "Catalog · Inventory · Availability",
    },
    "product.surveyTitle": {
      zh: "让客户更方便地预约。",
      en: "Make booking easier for customers.",
    },
    "product.surveyBody": {
      zh: "展示可租商品与档期，让客户在线预约，让门店清晰安排。",
      en: "Show available products and dates. Help customers book and teams plan ahead.",
    },
    "product.bookingBody": {
      zh: "商品、库存与可租日历统一管理，支持套装与配件租赁，让预约安排更清晰。",
      en: "Manage products, inventory and availability in one place. Keep kits, accessories and bookings organized.",
    },
    "cta.explore": {
      zh: "了解更多",
      en: "Explore",
    },
    "product.orderStatus": {
      zh: "订单 · 交付 · 归还 · 结算",
      en: "Orders · Delivery · Return · Settlement",
    },
    "order.previewName": {
      zh: "租赁订单示例",
      en: "Sample rental order",
    },
    "order.leased": {
      zh: "租用中",
      en: "In use",
    },
    "order.renew": {
      zh: "租期与归还时间可追踪",
      en: "Rental dates and returns tracked",
    },
    "order.location": {
      zh: "门店配送 · 到店归还",
      en: "Store delivery · In-store return",
    },
    "order.risk": {
      zh: "归还验收",
      en: "Return inspection",
    },
    "order.flag": {
      zh: "待处理",
      en: "Pending",
    },
    "product.orderBody": {
      zh: "从下单、出库到配送、归还与费用结算，每个状态都可追踪。",
      en: "Track each stage from order and dispatch to delivery, return and settlement.",
    },
    "product.multi": {
      zh: "多门店协同",
      en: "Multi-location operations",
    },
    "product.multiStatus": {
      zh: "门店 · 仓库 · 经营空间",
      en: "Locations · Warehouses · Workspaces",
    },
    "story.camera": {
      zh: "“拍摄档期、套装与配件，在同一张可租日历里安排。”",
      en: "“Keep shoot schedules, kits and accessories on one availability calendar.”",
    },
    "story.cameraName": {
      zh: "摄影设备租赁",
      en: "Camera rentals",
    },
    "story.cameraRole": {
      zh: "业务场景示例 · 档期与套装",
      en: "Illustrative workflow · Availability & kits",
    },
    "story.equipment": {
      zh: "“设备在哪里、何时归还、是否待检，业务状态一目了然。”",
      en: "“Know where equipment is, when it returns and whether inspection is due.”",
    },
    "story.equipmentName": {
      zh: "工程设备租赁",
      en: "Equipment rentals",
    },
    "story.equipmentRole": {
      zh: "业务场景示例 · 资产与调度",
      en: "Illustrative workflow · Assets & dispatch",
    },
    "story.outdoor": {
      zh: "“从露营套装预约到归还清洁，让旺季安排更有序。”",
      en: "“From camping-kit bookings to returns and cleaning. Keep peak seasons organized.”",
    },
    "story.outdoorName": {
      zh: "露营装备租赁",
      en: "Outdoor rentals",
    },
    "story.outdoorRole": {
      zh: "业务场景示例 · 预约与归还",
      en: "Illustrative workflow · Booking & return",
    },
    "story.vehicle": {
      zh: "“车辆档期、租期与费用记录，连接每一次交付和归还。”",
      en: "“Connect fleet availability, rental periods and charges with every handover and return.”",
    },
    "story.vehicleName": {
      zh: "车辆载具租赁",
      en: "Vehicle rentals",
    },
    "story.vehicleRole": {
      zh: "业务场景示例 · 交付与结算",
      en: "Illustrative workflow · Delivery & settlement",
    },
    "story.pause": {
      zh: "暂停业务场景轮播",
      en: "Pause workflow carousel",
    },
    "solutions.eyebrow": {
      zh: "行业解决方案",
      en: "Industry solutions",
    },
    "solutions.heading": {
      zh: "为不同租赁业务而建。",
      en: "Built for every rental business.",
    },
    "team.camera": {
      zh: "摄影器材租赁",
      en: "Camera & production rentals",
    },
    "team.cameraBody": {
      zh: "从单机到完整套装，统一管理器材、配件与拍摄档期。",
      en: "Manage cameras, accessories and complete production kits with clear availability.",
    },
    "team.outdoor": {
      zh: "露营装备租赁",
      en: "Outdoor equipment rentals",
    },
    "team.outdoorBody": {
      zh: "帐篷、睡袋与户外家具，连接预约、配送和归还。",
      en: "Connect bookings, delivery and returns for tents, sleeping gear and outdoor furniture.",
    },
    "team.vehicle": {
      zh: "车辆载具租赁",
      en: "Vehicle rentals",
    },
    "team.vehicleBody": {
      zh: "掌握车辆档期与租期，让交付、续租和归还更清晰。",
      en: "Keep fleet availability, handovers, renewals and returns in one clear workflow.",
    },
    "team.equipment": {
      zh: "工程设备租赁",
      en: "Construction equipment rentals",
    },
    "team.equipmentBody": {
      zh: "围绕项目管理设备，记录调度、使用与检修状态。",
      en: "Organize equipment by project and track dispatch, usage and service status.",
    },
    "team.locations": {
      zh: "多门店经营",
      en: "Multi-location operations",
    },
    "team.locationsBody": {
      zh: "门店、仓库与经营空间协同，团队共享清晰的业务视图。",
      en: "Connect locations, warehouses and workspaces with a shared view of operations.",
    },
    "trust.eyebrow": {
      zh: "权限与数据",
      en: "Permissions & data",
    },
    "trust.heading": {
      zh: "让协同有边界，让业务可追溯。",
      en: "Clear boundaries. Traceable operations.",
    },
    "trust.body": {
      zh: "按角色与经营空间组织业务，保留完整流程记录，让团队协同更清晰。",
      en: "Organize access by role and workspace. Keep rental workflows recorded and teams aligned.",
    },
    "trust.access": {
      zh: "角色与权限",
      en: "Roles & permissions",
    },
    "trust.accessBody": {
      zh: "根据岗位配置操作权限，让不同成员在各自职责内协作。",
      en: "Configure access by role so each team member works within their responsibilities.",
    },
    "trust.trace": {
      zh: "业务记录可追踪",
      en: "Traceable business records",
    },
    "trust.traceBody": {
      zh: "订单、交付、归还与结算串联记录，业务状态与处理过程可查。",
      en: "Connect order, delivery, return and settlement records. Keep status and handling history visible.",
    },
    "trust.workspace": {
      zh: "独立经营空间",
      en: "Separate workspaces",
    },
    "trust.workspaceBody": {
      zh: "按经营空间组织库存与订单，保持业务范围清晰。",
      en: "Organize inventory and orders by workspace, with clear operational boundaries.",
    },
    "outcomes.eyebrow": {
      zh: "平台能力",
      en: "Platform foundation",
    },
    "outcomes.heading1": {
      zh: "不同租赁业务，",
      en: "Different rental businesses.",
    },
    "outcomes.heading2": {
      zh: "同一套经营底座。",
      en: "One operating foundation.",
    },
    "outcomes.body": {
      zh: "围绕行业、流程与协同，组织你的租赁经营。",
      en: "Build your rental operation around categories, workflows and connected teams.",
    },
    "outcomes.categories": {
      zh: "四个场景只是示例，Rental Core 支持快速新增品类。",
      en: "Four examples. Add new rental categories quickly with Rental Core.",
    },
    "outcomes.categoriesNote": {
      zh: "摄影 · 露营 · 车辆 · 工程设备等",
      en: "Camera · Outdoor · Vehicle · Equipment and more",
    },
    "outcomes.flows": {
      zh: "预约、履约与经营协同，串起租赁业务。",
      en: "Booking, fulfillment and operations. Connected throughout the rental lifecycle.",
    },
    "outcomes.flowsNote": {
      zh: "预约 · 履约 · 经营",
      en: "Booking · Fulfillment · Operations",
    },
    "outcomes.ends": {
      zh: "经营端与用户端，连接团队和客户。",
      en: "Operations and customer experiences. Connected in one platform.",
    },
    "outcomes.endsNote": {
      zh: "管理后台 · 用户端",
      en: "Admin console · Customer experience",
    },
    "outcomes.platform": {
      zh: "一个平台，统一管理租赁全流程。",
      en: "One platform to manage the entire rental lifecycle.",
    },
    "cta.heading1": {
      zh: "让租赁更简单。",
      en: "Make rental simpler.",
    },
    "cta.heading2": {
      zh: "从 Rental OS 开始。",
      en: "Start with Rental OS.",
    },
    "cta.body1": {
      zh: "带上你的业务场景，",
      en: "Tell us how your rental business works.",
    },
    "cta.body2": {
      zh: "一起找到更合适的经营方式。",
      en: "Find an approach that fits your operation.",
    },
    "footer.tagline": {
      zh: "让租赁更简单，让世界更高效。",
      en: "Make rental simpler. Make the world more efficient.",
    },
    "footer.newsletter": {
      zh: "了解 Rental OS 的产品更新。",
      en: "Stay up to date with Rental OS.",
    },
    "footer.email": {
      zh: "邮箱地址",
      en: "Email address",
    },
    "footer.subscribe": {
      zh: "订阅动态",
      en: "Subscribe",
    },
    "footer.how": {
      zh: "平台介绍",
      en: "Platform overview",
    },
    "footer.helpBooking": {
      zh: "预约使用指南",
      en: "Booking guide",
    },
    "footer.helpOrders": {
      zh: "履约使用指南",
      en: "Fulfillment guide",
    },
    "footer.about": {
      zh: "关于 Rental OS",
      en: "About Rental OS",
    },
    "footer.copyright": {
      zh: "© 2026 Rental OS. 保留所有权利。",
      en: "© 2026 Rental OS. All rights reserved.",
    },
    "footer.imprint": {
      zh: "网站声明",
      en: "Site information",
    },
    "footer.privacy": {
      zh: "隐私政策",
      en: "Privacy policy",
    },
    "footer.terms": {
      zh: "服务条款",
      en: "Terms of service",
    },
    "cookie.settings": {
      zh: "偏好设置",
      en: "Preference settings",
    },
    "footer.hosting": {
      zh: "构建租赁世界。",
      en: "Build a Rental World.",
    },
    "cookie.body": {
      zh: "本地保存语言与网站偏好，方便你下次继续浏览。",
      en: "We save language and website preferences locally for your next visit.",
    },
    "cookie.essential": {
      zh: "必要偏好",
      en: "Essential preferences",
    },
    "cookie.analytics": {
      zh: "统计偏好（预留）",
      en: "Analytics preference (reserved)",
    },
    "cookie.reject": {
      zh: "仅保留必要项",
      en: "Essential only",
    },
    "cookie.accept": {
      zh: "接受全部",
      en: "Accept all",
    },
    "cookie.save": {
      zh: "保存设置",
      en: "Save settings",
    },
    "cookie.customize": {
      zh: "自定义",
      en: "Customize",
    },
    "aria.home": {
      zh: "Rental OS 首页",
      en: "Rental OS home",
    },
    "aria.mainNav": {
      zh: "主导航",
      en: "Main navigation",
    },
    "menu.open": {
      zh: "打开菜单",
      en: "Open menu",
    },
    "aria.mobileNav": {
      zh: "移动端导航",
      en: "Mobile navigation",
    },
    "aria.hero": {
      zh: "平台能力展示",
      en: "Featured platform capabilities",
    },
    "aria.heroPrev": {
      zh: "上一张首屏",
      en: "Previous slide",
    },
    "aria.heroNext": {
      zh: "下一张首屏",
      en: "Next slide",
    },
    "aria.heroSlides": {
      zh: "首屏展示选项",
      en: "Featured slides",
    },
    "aria.clients": {
      zh: "Rental OS 平台与行业场景",
      en: "Rental OS platform and industry scenarios",
    },
    "marquee.booking": { zh: "预约与库存", en: "Booking & inventory" },
    "marquee.orders": { zh: "订单与履约", en: "Orders & fulfillment" },
    "marquee.locations": { zh: "门店与团队", en: "Locations & teams" },
    "marquee.assets": { zh: "资产与设备", en: "Assets & equipment" },
    "marquee.term": { zh: "租期管理", en: "Rental periods" },
    "marquee.finance": { zh: "财务结算", en: "Settlement" },
    "marquee.camera": { zh: "摄影器材", en: "Camera equipment" },
    "marquee.outdoor": { zh: "露营装备", en: "Outdoor equipment" },
    "marquee.vehicle": { zh: "车辆载具", en: "Vehicle rentals" },
    "marquee.equipment": { zh: "工程设备", en: "Construction equipment" },
    "aria.flow": {
      zh: "从预约、下单到交付、归还与结算的租赁业务流程示意。",
      en: "Illustration of the rental workflow from booking and ordering to delivery, return and settlement.",
    },
    "aria.stories": {
      zh: "租赁业务场景示例",
      en: "Illustrative rental workflows",
    },
    "aria.storyPrev": {
      zh: "上一个业务场景",
      en: "Previous workflow",
    },
    "aria.storyNext": {
      zh: "下一个业务场景",
      en: "Next workflow",
    },
    "aria.storySelect": {
      zh: "选择业务场景",
      en: "Select workflow",
    },
    "aria.story1": {
      zh: "摄影租赁场景",
      en: "Camera rental workflow",
    },
    "aria.story2": {
      zh: "设备租赁场景",
      en: "Equipment rental workflow",
    },
    "aria.story3": {
      zh: "露营租赁场景",
      en: "Outdoor rental workflow",
    },
    "aria.story4": {
      zh: "车辆租赁场景",
      en: "Vehicle rental workflow",
    },
    "aria.teamPrev": {
      zh: "上一个行业方案",
      en: "Previous industry",
    },
    "aria.teamNext": {
      zh: "下一个行业方案",
      en: "Next industry",
    },
    "aria.teams": {
      zh: "行业解决方案",
      en: "Industry solutions",
    },
    "aria.trust": {
      zh: "角色权限、流程记录与经营空间的协同示意。",
      en: "Illustration of roles, workflow records and separate workspaces.",
    },
    "aria.footer": {
      zh: "页脚导航",
      en: "Footer navigation",
    },
    "aria.email": {
      zh: "电子邮箱",
      en: "Email",
    },
    "cookie.close": {
      zh: "关闭偏好设置",
      en: "Close preference settings",
    },
    title: {
      zh: "Rental OS｜面向多品类租赁业务的经营平台",
      en: "Rental OS | One platform for rental operations",
    },
    description: {
      zh: "Rental OS 是面向多品类租赁业务的一体化经营平台，连接预约、订单、库存、门店、履约与结算。",
      en: "Rental OS connects booking, orders, inventory, locations, fulfillment and settlement on one platform for multi-category rental businesses.",
    },
    "menu.close": {
      zh: "关闭菜单",
      en: "Close menu",
    },
    "hero.resume": {
      zh: "继续首屏轮播",
      en: "Resume autoplay",
    },
    "story.resume": {
      zh: "继续业务场景轮播",
      en: "Resume workflow carousel",
    },
    "newsletter.preview": {
      zh: "仅为页面演示，尚未提交订阅。",
      en: "Preview only — no subscription has been sent.",
    },
    "metric.replay": {
      zh: "重播数字动效",
      en: "Replay number animation",
    },
    "language.choose": {
      zh: "选择语言",
      en: "Choose language",
    },
    "language.options": {
      zh: "语言选项",
      en: "Language options",
    },
    "newsletter.placeholder": {
      zh: "请输入邮箱地址",
      en: "you@company.com",
    },
  };
  const storageKey = "rental-os-language";
  const picker = document.querySelector(".language-picker");
  const trigger = document.getElementById("languageTrigger");
  const menu = document.getElementById("languageMenu");
  const current = document.getElementById("languageCurrent");
  const options = [...menu.querySelectorAll("[data-language]")];
  const valid = (language) => language === "zh" || language === "en";
  const browserLanguage = () =>
    String(navigator.languages?.[0] || navigator.language || "")
      .toLowerCase()
      .startsWith("zh")
      ? "zh"
      : "en";

  let saved = null;
  try {
    saved = localStorage.getItem(storageKey);
  } catch {
    /* optional */
  }
  const requested = new URLSearchParams(location.search).get("lang");
  let explicit = valid(requested) || valid(saved);
  let language = valid(requested)
    ? requested
    : valid(saved)
      ? saved
      : browserLanguage();

  const text = (key) => copy[key]?.[language] ?? key;
  // Existing interactions use this to translate messages without rebuilding UI.
  window.RentalOSCopy = {
    text,
    get language() {
      return language;
    },
  };

  function setLanguage(next, persist = false) {
    if (!valid(next)) return;
    language = next;
    document.documentElement.lang = next === "en" ? "en" : "zh-CN";
    document.title = text("title");
    document.querySelector('meta[name="description"]').content =
      text("description");
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.dataset.i18n;
      if (copy[key]) element.textContent = text(key);
    });
    for (const [attribute, dataKey] of [
      ["aria-label", "i18nAria"],
      ["placeholder", "i18nPlaceholder"],
    ]) {
      const binding =
        attribute === "aria-label" ? "data-i18n-aria" : "data-i18n-placeholder";
      document.querySelectorAll("[" + binding + "]").forEach((element) => {
        const key = element.dataset[dataKey];
        if (copy[key]) element.setAttribute(attribute, text(key));
      });
    }
    current.textContent = next === "en" ? "English" : "简体中文";
    options.forEach((option) => {
      option.setAttribute(
        "aria-selected",
        String(option.dataset.language === next),
      );
      option.tabIndex = option.dataset.language === next ? 0 : -1;
    });
    if (persist) {
      explicit = true;
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* private mode */
      }
    }
    document.dispatchEvent(
      new CustomEvent("rentalos:languagechange", {
        detail: { language: next },
      }),
    );
    // Text can wrap differently; existing layout handlers remeasure, not reset carousels.
    window.dispatchEvent(new Event("resize"));
  }

  function setMenu(open, focus = false) {
    menu.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open && focus)
      options.find((option) => option.dataset.language === language)?.focus();
  }
  trigger.addEventListener("click", () => setMenu(menu.hidden));
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setMenu(true, true);
    }
  });
  options.forEach((option, index) => {
    option.addEventListener("click", () => {
      setLanguage(option.dataset.language, true);
      setMenu(false);
      trigger.focus({ preventScroll: true });
    });
    option.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
              options.length;
      options.forEach((item, i) => (item.tabIndex = i === next ? 0 : -1));
      options[next].focus();
    });
  });
  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target)) setMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      setMenu(false);
      trigger.focus({ preventScroll: true });
    }
  });
  // Browser language changes apply only without a manual preference.
  window.addEventListener("languagechange", () => {
    if (!explicit) setLanguage(browserLanguage());
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    explicit = valid(event.newValue);
    setLanguage(explicit ? event.newValue : browserLanguage());
  });
  setLanguage(language);
})();

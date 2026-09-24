const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");

// 与其它客户端专项一致：始终解析到本 checkout 的 shared 构建产物。
const root = path.resolve(__dirname, "..");
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return request === "@rental-os/shared" ? path.join(root, "packages/shared/dist/index.js") : resolveFilename.call(this, request, ...args);
};
require("ts-node").register({ project: path.join(root, "apps/api/tsconfig.json"), transpileOnly: true });

const { ClientApiService } = require("../apps/api/src/modules/client/client-api.service");
const { ClientChannelProfileService } = require("../apps/api/src/modules/client/client-channel-profile.service");
const { WebsiteChannelProfileService } = require("../apps/api/src/modules/client/website-channel-profile.service");
const { WebsiteAssetService } = require("../apps/api/src/modules/client/website-asset.service");
const { OPENAPI_DOCUMENT } = require("../apps/api/src/contracts/openapi-document");

const status = (value) => (error) => error?.getStatus?.() === value;

/** 构造一个只实现本用例所需方法的 prisma 替身。 */
function buildPrisma({ tenant, profile, wechatChannel, workspaces = [], websiteProfile = null }) {
  return {
    tenant: { findFirst: async () => tenant },
    clientChannelProfile: { findUnique: async () => profile },
    websiteChannelProfile: { findUnique: async () => websiteProfile },
    miniProgramChannel: { findFirst: async () => wechatChannel },
    businessWorkspace: { findMany: async () => workspaces }
  };
}

function bootstrapService(overrides) {
  return Object.assign(Object.create(ClientApiService.prototype), {
    prisma: buildPrisma(overrides),
    tenantIntegrations: { catalog: async () => ({ configs: overrides.integrationConfigs ?? [] }) },
    // 品类名字典与员工端同源：替身返回四品类定义（名称取自 RENTAL_CATEGORY_DEFINITIONS 口径）。
    core: { listCategories: () => overrides.categories ?? [{ code: "camera", name: "摄影器材" }, { code: "camping", name: "露营装备" }, { code: "vehicle", name: "车辆" }, { code: "construction", name: "工程设备" }] },
    // 配送开关：直接替身，避免拉起 core/runWithRequestIdentity。
    anyWorkspaceEnablesDelivery: async () => overrides.deliveryEnabled ?? false
  });
}

const tenant = { id: "t1", code: "demo", name: "演示租户" };
const publishedProfile = {
  tenantId: "t1", revision: 3,
  brandName: "光影租赁", brandLogoUrl: "https://cdn.example.invalid/logo.png", customerServicePhone: "021-000", customerServiceHours: "9-18",
  userAgreementName: "用户服务协议", userAgreementVersion: "2026-09", userAgreementUrl: null, userAgreementBody: "协议正文",
  privacyPolicyName: "隐私政策", privacyPolicyVersion: "2026-09", privacyPolicyUrl: null, privacyPolicyBody: "隐私正文",
  helpIntro: "帮助说明", helpFaqJson: [{ question: "怎么租", answer: "选设备下单" }], bannerTitle: "去露营", bannerSubtitle: "装备齐全", themeColor: "#FF6600",
  smsLoginEnabled: true, passwordLoginEnabled: true, defaultWorkspaceId: "w-cam",
  updatedAt: new Date("2026-09-19T00:00:00Z"),
  publishedWorkspaces: [{ workspaceId: "w-cam", enabled: true, workspace: { code: "camera", name: "摄影器材", categoryCode: "camera", isDefault: true, status: "ACTIVE" } }]
};

test("bootstrap: 微信渠道就绪时小程序开放微信一键登录与微信支付；APP 端同一份配置但不开放微信能力", async () => {
  const base = { tenant, profile: publishedProfile, wechatChannel: { appSecretEncrypted: "enc" },
    integrationConfigs: [{ capability: "payment", provider: "wechat_pay", enabled: true, isDefault: true, lastTestStatus: "passed", lastTestMode: "live" }, { capability: "sms", enabled: true, isDefault: true }] };

  const mp = await bootstrapService(base).channelBootstrap("demo", "wechat_miniprogram");
  assert.equal(mp.client, "wechat_miniprogram");
  assert.equal(mp.source, "channel");
  assert.equal(mp.merchant.name, "光影租赁");
  assert.deepEqual(mp.banner, { title: "去露营", subtitle: "装备齐全" });
  assert.equal(mp.themeColor, "#FF6600", "启动配置带出租户主题色");
  assert.equal(mp.help.available, true);
  assert.equal(mp.help.faqCount, 1);
  assert.equal(mp.agreements.userAgreement.hasBody, true);
  assert.ok(mp.loginMethods.includes("wechat_phone"), "小程序应开放微信一键登录");
  assert.equal(mp.capabilities.wechatPay, true);
  assert.equal(mp.defaultServiceCode, "camera");
  assert.deepEqual(mp.categories.find((c) => c.code === "camera"), { code: "camera", name: "摄影器材" }, "bootstrap 下发品类名字典，客户端不再本地维护映射");

  // APP 渠道：读同一份品牌/协议，但不查微信凭证、不开放微信登录/支付。
  const app = await bootstrapService(base).channelBootstrap("demo", "app");
  assert.equal(app.client, "app");
  assert.equal(app.merchant.name, "光影租赁");
  assert.equal(app.agreements.userAgreement.hasBody, true);
  assert.equal(app.loginMethods.includes("wechat_phone"), false, "APP 不做微信一键登录");
  assert.equal(app.capabilities.wechatPay, false, "APP 不走小程序 JSAPI 支付");
});

test("bootstrap: 未配置渠道或无发布服务时回退到启用空间目录，只带租户名，不冒充品牌/协议", async () => {
  const svc = bootstrapService({ tenant, profile: null, wechatChannel: null, workspaces: [{ code: "camera", name: "摄影", categoryCode: "camera", isDefault: true }] });
  const result = await svc.channelBootstrap("demo", "wechat_miniprogram");
  assert.equal(result.source, "workspace_directory");
  assert.equal(result.merchant.name, "演示租户");
  assert.equal(result.agreements, undefined);
  assert.equal(result.help.available, false);
  assert.equal(result.capabilities.publicCatalog, false);
  assert.equal(result.capabilities.wechatPay, false);
  assert.deepEqual(result.services.map((s) => s.code), ["camera"]);
});

test("bootstrap: 微信凭证缺失时小程序也不开放微信登录/支付，短信/密码按配置开放", async () => {
  const svc = bootstrapService({ tenant, profile: publishedProfile, wechatChannel: null, integrationConfigs: [{ capability: "sms", enabled: true, isDefault: true }] });
  const result = await svc.channelBootstrap("demo", "wechat_miniprogram");
  assert.equal(result.loginMethods.includes("wechat_phone"), false);
  assert.equal(result.capabilities.wechatPay, false);
  assert.ok(result.loginMethods.includes("sms"));
  assert.ok(result.loginMethods.includes("password"));
});

test("public documents: 协议返回正文，帮助返回 FAQ，未提供时 404", async () => {
  const withDoc = bootstrapService({ tenant, profile: publishedProfile, wechatChannel: null });
  const agreement = await withDoc.publicDocument("demo", "user_agreement");
  assert.equal(agreement.kind, "user_agreement");
  assert.equal(agreement.body, "协议正文");
  assert.equal(agreement.version, "2026-09");
  const help = await withDoc.publicDocument("demo", "help");
  assert.deepEqual(help.faq, [{ question: "怎么租", answer: "选设备下单" }]);

  const noBody = bootstrapService({ tenant, profile: { ...publishedProfile, userAgreementVersion: null }, wechatChannel: null });
  await assert.rejects(noBody.publicDocument("demo", "user_agreement"), status(404));
  const noProfile = bootstrapService({ tenant, profile: null, wechatChannel: null });
  await assert.rejects(noProfile.publicDocument("demo", "help"), status(404));
});

test("profile save: 就绪判定要求品牌/客服/两份协议正文/至少一个发布服务；发布服务必须属于本租户且启用", async () => {
  const calls = { upserts: [], deletes: 0, written: null };
  const tx = {
    clientChannelProfile: { update: async ({ data }) => { calls.written = data; return { id: "p1", ...data }; }, create: async ({ data }) => { calls.written = data; return { id: "p1", ...data }; } },
    clientChannelWorkspace: { deleteMany: async () => { calls.deletes += 1; }, upsert: async ({ create }) => { calls.upserts.push(create.workspaceId); } }
  };
  let stored = null;
  const prisma = {
    clientChannelProfile: { findUnique: async () => stored, update: tx.clientChannelProfile.update, create: tx.clientChannelProfile.create },
    businessWorkspace: { findMany: async ({ where }) => (where?.id?.in ? where.id.in.filter((id) => id === "w-cam").map((id) => ({ id, status: "ACTIVE" })) : [{ id: "w-cam", code: "camera", name: "摄影", categoryCode: "camera", status: "ACTIVE" }]) },
    clientChannelWorkspace: tx.clientChannelWorkspace,
    $transaction: async (fn) => fn(tx)
  };
  const svc = Object.assign(Object.create(ClientChannelProfileService.prototype), { prisma, operationLog: { record: async () => {} } });
  const user = { tenantId: "t1", isSaasAdmin: false };

  // 非本租户空间被拒。
  await assert.rejects(svc.save({ smsLoginEnabled: true, passwordLoginEnabled: true, publishedWorkspaceIds: ["w-other"] }, user), status(400));

  // 完整配置 → ready。
  stored = { id: "p1", tenantId: "t1", revision: 0, publishedWorkspaces: [{ workspaceId: "w-cam", enabled: true }],
    brandName: "光影", customerServicePhone: "021", userAgreementVersion: "1", userAgreementBody: "a", privacyPolicyVersion: "1", privacyPolicyBody: "p", updatedAt: new Date() };
  const summary = await svc.save({
    smsLoginEnabled: true, passwordLoginEnabled: true, publishedWorkspaceIds: ["w-cam"], defaultWorkspaceId: "w-cam",
    brandName: "光影", customerServicePhone: "021",
    userAgreement: { name: "用户服务协议", version: "1", body: "a" }, privacyPolicy: { name: "隐私政策", version: "1", body: "p" }
  }, user);
  assert.equal(summary.readiness.ready, true);
  assert.deepEqual(summary.readiness.missing, []);
  assert.deepEqual(calls.upserts, ["w-cam"]);

  // 主题色：#RGB 展开为大写 #RRGGBB 落库。
  await svc.save({ smsLoginEnabled: true, passwordLoginEnabled: true, publishedWorkspaceIds: ["w-cam"], brandName: "光影", customerServicePhone: "021", themeColor: "#f60" }, user);
  assert.equal(calls.written.themeColor, "#FF6600", "主题色 #RGB 归一化为大写 #RRGGBB");
  // 留空 → null（回退系统色）。
  await svc.save({ smsLoginEnabled: true, passwordLoginEnabled: true, publishedWorkspaceIds: ["w-cam"], brandName: "光影", customerServicePhone: "021" }, user);
  assert.equal(calls.written.themeColor, null, "未设主题色落 null");
  // 非法色拒绝。
  await assert.rejects(svc.save({ smsLoginEnabled: true, passwordLoginEnabled: true, publishedWorkspaceIds: ["w-cam"], themeColor: "red" }, user), status(400));

  // 默认服务不在已发布集合内 → 拒绝。
  await assert.rejects(svc.save({ smsLoginEnabled: true, passwordLoginEnabled: true, publishedWorkspaceIds: ["w-cam"], defaultWorkspaceId: "w-nope" }, user), status(400));
});

test("OpenAPI: 渠道配置与公开文档契约齐全，凭证 schema 不再含品牌/协议字段", () => {
  const paths = OPENAPI_DOCUMENT.paths;
  assert.ok(paths["/api/platform/client-channel"].get, "缺 GET /platform/client-channel");
  assert.ok(paths["/api/platform/client-channel"].put, "缺 PUT /platform/client-channel");
  assert.deepEqual(paths["/api/platform/client-channel"].get["x-requiredPermissions"], ["system:integration:manage"]);
  assert.ok(paths["/api/client/v1/public/documents/{kind}"].get, "缺 GET /public/documents/{kind}");
  const bootstrap = paths["/api/client/v1/public/bootstrap"].get;
  assert.ok(bootstrap.parameters.some((p) => p.name === "client"), "bootstrap 应带 client 参数");
  const schemas = OPENAPI_DOCUMENT.components.schemas;
  assert.equal(schemas.SaveMiniProgramChannelRequest.properties.brandName, undefined, "凭证请求不应再含 brandName");
  assert.ok(schemas.ClientChannelProfileSummary.properties.readiness, "缺 profile readiness");
  assert.ok(schemas.ClientPublicDocumentResponse.properties.body, "缺文档 body");
});

const websiteProfileRow = {
  id: "web1", tenantId: "t1", revision: 2, enabled: true,
  slogan: "好物相伴，更好生活", heroTitle: "面向多行业的租赁解决方案", heroDescription: "覆盖多元租赁场景", heroImageUrl: null,
  secondaryColor: "#0A5CFF", footerText: "按需租用，让每一次体验都恰到好处。", contactAddress: "上海市 XX 路 1 号",
  ctaTitle: "开始租赁吧", ctaDescription: "海量好物，灵活租期", seoTitle: "租赁官网", seoDescription: "多行业租赁", seoKeywords: "相机,露营,租赁",
  categoryImagesJson: [{ code: "camera", imageUrl: "https://cdn.example.invalid/cam.webp" }],
  advantagesJson: [{ icon: "authentic", title: "正品保障", description: "严格甄选" }],
  stepsJson: [{ title: "选商品", description: "浏览下单" }],
  testimonialsJson: [{ name: "陈女士", context: "周末摄影", text: "取还方便" }],
  showPoweredBy: false, updatedAt: new Date("2026-09-22T00:00:00Z")
};

test("bootstrap: web 官网渠道叠加官网特有配置；未启用或非 web 渠道不返回 website", async () => {
  const base = { tenant, profile: publishedProfile, wechatChannel: null,
    integrationConfigs: [{ capability: "sms", enabled: true, isDefault: true }], websiteProfile: websiteProfileRow };

  const web = await bootstrapService(base).channelBootstrap("demo", "web");
  assert.equal(web.client, "web");
  assert.equal(web.source, "channel");
  assert.equal(web.merchant.name, "光影租赁", "web 渠道复用通用品牌");
  assert.equal(web.themeColor, "#FF6600", "主色仍取通用配置");
  assert.ok(web.website, "web 渠道应返回官网特有配置");
  assert.equal(web.website.heroTitle, "面向多行业的租赁解决方案");
  assert.equal(web.website.secondaryColor, "#0A5CFF");
  assert.equal(web.website.showPoweredBy, false);
  assert.deepEqual(web.website.categoryImages, [{ code: "camera", imageUrl: "https://cdn.example.invalid/cam.webp" }], "web 渠道带出品类入口图");
  assert.deepEqual(web.website.advantages, [{ icon: "authentic", title: "正品保障", description: "严格甄选" }], "web 渠道带出卖点");
  assert.deepEqual(web.website.steps, [{ title: "选商品", description: "浏览下单" }], "web 渠道带出流程");
  assert.deepEqual(web.website.testimonials, [{ name: "陈女士", context: "周末摄影", text: "取还方便" }], "web 渠道带出评价");
  assert.equal(web.loginMethods.includes("wechat_phone"), false, "web 不做微信一键登录");
  assert.ok(web.loginMethods.includes("sms") && web.loginMethods.includes("password"));

  // 非 web 渠道恒不返回 website。
  const mp = await bootstrapService(base).channelBootstrap("demo", "wechat_miniprogram");
  assert.equal(mp.website, undefined, "小程序渠道不带官网配置");

  // 官网渠道未启用 → website 省略。
  const disabled = await bootstrapService({ ...base, websiteProfile: { ...websiteProfileRow, enabled: false } }).channelBootstrap("demo", "web");
  assert.equal(disabled.website, undefined, "未启用官网渠道时不返回 website");

  // 未配置官网 → website 省略。
  const none = await bootstrapService({ ...base, websiteProfile: null }).channelBootstrap("demo", "web");
  assert.equal(none.website, undefined);
});

test("website profile save: 辅助色归一化、就绪判定要求启用+Hero 标题、revision 乐观锁", async () => {
  const calls = { written: null };
  let stored = null;
  const prisma = {
    websiteChannelProfile: {
      findUnique: async () => stored,
      update: async ({ data }) => { calls.written = data; return { id: "web1", tenantId: "t1", revision: 3, ...data, updatedAt: new Date() }; },
      create: async ({ data }) => { calls.written = data; return { id: "web1", ...data, revision: 1, updatedAt: new Date() }; }
    },
    businessWorkspace: { findMany: async () => [{ code: "camera", name: "摄影器材", isDefault: true }, { code: "camping", name: "露营装备", isDefault: false }] }
  };
  const svc = Object.assign(Object.create(WebsiteChannelProfileService.prototype), { prisma, operationLog: { record: async () => {} } });
  const user = { tenantId: "t1", isSaasAdmin: false };

  // 首次保存：启用 + Hero 标题 → ready；辅助色 #RGB 归一化为大写 #RRGGBB。
  const summary = await svc.save({ enabled: true, showPoweredBy: true, heroTitle: "标题", secondaryColor: "#0af" }, user);
  assert.equal(summary.readiness.ready, true);
  assert.deepEqual(summary.readiness.missing, []);
  assert.equal(calls.written.secondaryColor, "#00AAFF", "辅助色 #RGB 归一化为大写 #RRGGBB");
  assert.equal(summary.enabled, true);
  assert.deepEqual(summary.categories, [{ code: "camera", name: "摄影器材" }, { code: "camping", name: "露营装备" }], "返回可配置品类列表");

  // 品类入口图：只接受本租户已启用品类，按 code 去重、丢弃空图。
  await svc.save({ enabled: true, showPoweredBy: true, heroTitle: "标题", categoryImages: [
    { code: "camera", imageUrl: "https://cdn.example.invalid/a.webp" },
    { code: "camera", imageUrl: "https://cdn.example.invalid/dup.webp" },
    { code: "camping", imageUrl: "" }
  ] }, user);
  assert.deepEqual(calls.written.categoryImagesJson, [{ code: "camera", imageUrl: "https://cdn.example.invalid/a.webp" }], "去重取首个、丢弃空图");
  // 内容块：卖点/流程/评价裁剪空项与超限，缺必填项丢弃。
  await svc.save({ enabled: true, showPoweredBy: true, heroTitle: "标题",
    advantages: [{ icon: "authentic", title: "正品", description: "严选" }, { title: "" }],
    steps: [{ title: "选货" }, { title: "", description: "x" }],
    testimonials: [{ name: "陈", context: "周末", text: "很好" }, { name: "", text: "丢" }, { name: "李", text: "" }] }, user);
  assert.deepEqual(calls.written.advantagesJson, [{ icon: "authentic", title: "正品", description: "严选" }], "卖点丢弃空标题项");
  assert.deepEqual(calls.written.stepsJson, [{ title: "选货" }], "流程丢弃空标题项");
  assert.deepEqual(calls.written.testimonialsJson, [{ name: "陈", context: "周末", text: "很好" }], "评价要求 name+text");
  await assert.rejects(svc.save({ enabled: true, showPoweredBy: true, advantages: [{ title: "x".repeat(41) }] }, user), status(400));
  await assert.rejects(svc.save({ enabled: true, showPoweredBy: true, categoryImages: [{ code: "not-mine", imageUrl: "https://cdn.example.invalid/x.webp" }] }, user), status(400));

  // 未启用 / 缺 Hero 标题 → 未就绪。
  const draft = await svc.save({ enabled: false, showPoweredBy: true }, user);
  assert.equal(draft.readiness.ready, false);
  assert.ok(draft.readiness.missing.length >= 1);

  // 非法辅助色拒绝。
  await assert.rejects(svc.save({ enabled: true, showPoweredBy: true, secondaryColor: "blue" }, user), status(400));

  // revision 不一致 → 冲突。
  stored = { id: "web1", tenantId: "t1", revision: 5, enabled: true, showPoweredBy: true, updatedAt: new Date() };
  await assert.rejects(svc.save({ enabled: true, showPoweredBy: true, expectedRevision: 2 }, user), status(409));
});

test("OpenAPI: web 官网渠道配置与 bootstrap website 契约齐全", () => {
  const paths = OPENAPI_DOCUMENT.paths;
  assert.ok(paths["/api/platform/website-channel"].get, "缺 GET /platform/website-channel");
  assert.ok(paths["/api/platform/website-channel"].put, "缺 PUT /platform/website-channel");
  assert.deepEqual(paths["/api/platform/website-channel"].get["x-requiredPermissions"], ["system:integration:manage"]);
  const schemas = OPENAPI_DOCUMENT.components.schemas;
  assert.ok(schemas.WebsiteChannelProfileSummary.properties.heroTitle, "缺 website summary heroTitle");
  assert.ok(schemas.SaveWebsiteChannelProfileRequest.properties.secondaryColor, "缺 save website secondaryColor");
  assert.ok(schemas.ClientWebsiteConfig.properties.showPoweredBy, "缺 ClientWebsiteConfig");
  assert.ok(schemas.ClientChannelBootstrapResponse.properties.website, "bootstrap 响应应含 website");
  const clientEnum = paths["/api/client/v1/public/bootstrap"].get.parameters.find((p) => p.name === "client").schema.enum;
  assert.ok(clientEnum.includes("web"), "bootstrap client 参数应支持 web");
});

test("website 自定义域名：归一化、按 Host 反查租户、全局唯一冲突 409", async () => {
  // 归一化：粘贴带 http(s):// / 路径 / 端口 / 大写都收敛为纯小写 host；非法域名拒绝。
  const calls = { written: null };
  let stored = null;
  const prisma = {
    websiteChannelProfile: {
      findUnique: async () => stored,
      update: async ({ data }) => { calls.written = data; return { id: "web1", tenantId: "t1", revision: 3, ...data, updatedAt: new Date() }; },
      create: async ({ data }) => { calls.written = data; return { id: "web1", ...data, revision: 1, updatedAt: new Date() }; }
    },
    businessWorkspace: { findMany: async () => [{ code: "camera", name: "摄影器材", isDefault: true }] }
  };
  const svc = Object.assign(Object.create(WebsiteChannelProfileService.prototype), { prisma, operationLog: { record: async () => {} } });
  const user = { tenantId: "t1", isSaasAdmin: false };
  await svc.save({ enabled: true, showPoweredBy: true, heroTitle: "标题", customDomain: "HTTPS://WWW.Brand.com/home" }, user);
  assert.equal(calls.written.customDomain, "www.brand.com", "自定义域名归一化为小写纯 host");
  await svc.save({ enabled: true, showPoweredBy: true, heroTitle: "标题", customDomain: "www.brand.com." }, user);
  assert.equal(calls.written.customDomain, "www.brand.com", "去掉 FQDN 末尾点，避免 Host 带点匹配不上");
  await svc.save({ enabled: true, showPoweredBy: true, heroTitle: "标题", customDomain: "" }, user);
  assert.equal(calls.written.customDomain, null, "空域名落 null（不绑定）");
  await assert.rejects(svc.save({ enabled: true, showPoweredBy: true, customDomain: "not a domain" }, user), status(400));

  // 唯一冲突：Prisma P2002 → 409。
  const conflictPrisma = { websiteChannelProfile: { findUnique: async () => null, create: async () => { const e = new Error("Unique constraint"); e.code = "P2002"; throw e; } }, businessWorkspace: { findMany: async () => [] } };
  const conflictSvc = Object.assign(Object.create(WebsiteChannelProfileService.prototype), { prisma: conflictPrisma, operationLog: { record: async () => {} } });
  await assert.rejects(conflictSvc.save({ enabled: true, showPoweredBy: true, customDomain: "taken.com" }, user), status(409));

  // 按 Host 反查：启用且域名精确匹配 → tenantCode；未启用/未命中/非 ACTIVE → null。
  const api = (row) => Object.assign(Object.create(ClientApiService.prototype), { prisma: { websiteChannelProfile: { findFirst: async ({ where }) => (where.customDomain === "www.brand.com" && where.enabled ? row : null) } } });
  assert.deepEqual(await api({ tenant: { code: "demo", status: "ACTIVE" } }).resolveWebsiteHost("HTTPS://www.Brand.com:443/x"), { tenantCode: "demo" }, "带协议/端口/路径/大写的 Host 也能命中");
  assert.deepEqual(await api({ tenant: { code: "demo", status: "SUSPENDED" } }).resolveWebsiteHost("www.brand.com"), { tenantCode: null }, "租户非 ACTIVE 不返回");
  assert.deepEqual(await api(null).resolveWebsiteHost("other.com"), { tenantCode: null }, "未绑定返回 null");
  assert.deepEqual(await api({ tenant: { code: "demo", status: "ACTIVE" } }).resolveWebsiteHost(""), { tenantCode: null }, "空 Host 返回 null");
});

test("OpenAPI + 鉴权：site-resolve 是公开客户端路由、契约齐全", () => {
  const paths = OPENAPI_DOCUMENT.paths;
  const op = paths["/api/client/v1/public/site-resolve"].get;
  assert.ok(op, "缺 GET /public/site-resolve");
  assert.ok(op.parameters.some((p) => p.name === "host" && p.required), "site-resolve 需要必填 host 参数");
  assert.ok(OPENAPI_DOCUMENT.components.schemas.ClientWebsiteHostResolution.properties.tenantCode, "缺 ClientWebsiteHostResolution");
  assert.ok(OPENAPI_DOCUMENT.components.schemas.WebsiteChannelProfileSummary.properties.customDomain, "缺 summary customDomain");
  assert.ok(OPENAPI_DOCUMENT.components.schemas.SaveWebsiteChannelProfileRequest.properties.customDomain, "缺 save customDomain");
  const { isClientPublicRoute } = require("../apps/api/src/common/api-auth.guard");
  assert.equal(isClientPublicRoute("GET", "/client/v1/public/site-resolve"), true, "site-resolve 必须是公开路由（游客可访问）");
});

test("website assets: 上传校验图片类型/大小/魔数并回传公开 URL；公开读取按租户隔离", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const created = [];
  const prisma = {
    tenant: { findFirst: async ({ where }) => (where.code ? { id: "t1" } : { code: "demo" }) },
    websiteAsset: {
      create: async ({ data }) => { created.push(data); return { id: "asset-1" }; },
      findFirst: async ({ where }) => (where.id === "asset-1" && where.tenantId === "t1" ? { data: png, mimeType: "image/png" } : null)
    }
  };
  const svc = Object.assign(Object.create(WebsiteAssetService.prototype), { prisma });
  const user = { tenantId: "t1", isSaasAdmin: false };
  const file = (mimetype, buffer) => ({ originalname: "x", mimetype, size: buffer.length, buffer });

  // 合法 PNG → 入库并回传公开 URL（含 tenantCode 与 assetId）。
  const up = await svc.upload(user, "hero", file("image/png", png));
  assert.equal(up.url, "/api/client/v1/public/website-assets/demo/asset-1");
  assert.equal(up.mimeType, "image/png");
  assert.equal(created[0].scene, "hero");

  // 非图片类型、超大、魔数不符都拒绝。
  await assert.rejects(svc.upload(user, "hero", file("application/pdf", png)), status(400));
  await assert.rejects(svc.upload(user, "hero", file("image/png", Buffer.alloc(3 * 1024 * 1024, 1))), (e) => e?.getStatus?.() === 413);
  await assert.rejects(svc.upload(user, "hero", file("image/png", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))), status(400));
  // SaaS 平台账号不能上传租户图片。
  await assert.rejects(svc.upload({ isSaasAdmin: true }, "hero", file("image/png", png)), status(400));

  // 公开读取：命中返回内容；未知/跨租户 404（tenantId 过滤在 where 内）。
  const read = await svc.read("demo", "asset-1");
  assert.equal(read.mimeType, "image/png");
  assert.ok(Buffer.isBuffer(read.content));
  await assert.rejects(svc.read("demo", "nope"), status(404));
});

test("OpenAPI + 鉴权：website-assets 上传与公开读取契约齐全", () => {
  const paths = OPENAPI_DOCUMENT.paths;
  assert.ok(paths["/api/platform/website-channel/assets"].post, "缺 POST /platform/website-channel/assets");
  assert.deepEqual(paths["/api/platform/website-channel/assets"].post["x-requiredPermissions"], ["system:integration:manage"]);
  assert.ok(paths["/api/client/v1/public/website-assets/{tenantCode}/{assetId}"].get, "缺公开图片读取路由");
  assert.ok(paths["/api/client/v1/public/catalog/items/{itemGroupId}/images/{imageId}"].get, "既有商品图路由不应丢失");
  const { isClientPublicRoute } = require("../apps/api/src/common/api-auth.guard");
  assert.equal(isClientPublicRoute("GET", "/client/v1/public/website-assets/demo/asset-1"), true, "官网图片必须游客可读");
});

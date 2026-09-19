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
const { OPENAPI_DOCUMENT } = require("../apps/api/src/contracts/openapi-document");

const status = (value) => (error) => error?.getStatus?.() === value;

/** 构造一个只实现本用例所需方法的 prisma 替身。 */
function buildPrisma({ tenant, profile, wechatChannel, workspaces = [] }) {
  return {
    tenant: { findFirst: async () => tenant },
    clientChannelProfile: { findUnique: async () => profile },
    miniProgramChannel: { findFirst: async () => wechatChannel },
    businessWorkspace: { findMany: async () => workspaces }
  };
}

function bootstrapService(overrides) {
  return Object.assign(Object.create(ClientApiService.prototype), {
    prisma: buildPrisma(overrides),
    tenantIntegrations: { catalog: async () => ({ configs: overrides.integrationConfigs ?? [] }) },
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
  helpIntro: "帮助说明", helpFaqJson: [{ question: "怎么租", answer: "选设备下单" }], bannerTitle: "去露营", bannerSubtitle: "装备齐全",
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
  assert.equal(mp.help.available, true);
  assert.equal(mp.help.faqCount, 1);
  assert.equal(mp.agreements.userAgreement.hasBody, true);
  assert.ok(mp.loginMethods.includes("wechat_phone"), "小程序应开放微信一键登录");
  assert.equal(mp.capabilities.wechatPay, true);
  assert.equal(mp.defaultServiceCode, "camera");

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
  const calls = { upserts: [], deletes: 0 };
  const tx = {
    clientChannelProfile: { update: async ({ data }) => ({ id: "p1", ...data }), create: async ({ data }) => ({ id: "p1", ...data }) },
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

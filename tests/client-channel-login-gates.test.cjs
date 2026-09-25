const assert = require("node:assert/strict");
const { validateSync } = require("class-validator");
const { ClientAuthService } = require("../apps/api/dist/modules/client/client-auth.service.js");
const { TenantIntegrationRouteDto } = require("../apps/api/dist/modules/integrations/tenant-integration-request.dto.js");

const forbidden = (status) => (error) => error?.status === status;

async function main() {
  const stripeRoute = Object.assign(new TenantIntegrationRouteDto(), { capability: "payment", provider: "stripe" });
  assert.deepEqual(validateSync(stripeRoute), [], "共享服务商注册表中的 Stripe 必须通过租户配置路由 DTO");

  let accountReads = 0;
  const prisma = {
    tenant: { findFirst: async () => ({ id: "tenant-1" }) },
    clientChannelProfile: { findUnique: async () => ({ passwordLoginEnabled: false, smsLoginEnabled: false }) },
    customerAccount: { findFirst: async () => { accountReads += 1; return null; } }
  };
  const service = new ClientAuthService(prisma, {});
  service.target = async () => ({ tenant: { id: "tenant-1" }, workspace: { id: "workspace-1" } });

  await assert.rejects(
    () => service.login({ tenantCode: "tenant", loginIdentifier: "13800000000", password: "guess" }),
    forbidden(403),
    "关闭密码登录后，直调密码登录 API 必须在读取账号前拒绝"
  );
  await assert.rejects(
    () => service.createChallenge({ tenantCode: "tenant", method: "sms", identifier: "13800000000", idempotencyKey: "challenge-one", purpose: "login" }),
    forbidden(403),
    "关闭短信登录后，不能通过登录用途验证码挑战 API 绕过页面开关"
  );
  await assert.rejects(
    () => service.smsLogin({ tenantCode: "tenant", loginIdentifier: "13800000000", verificationToken: "unused" }),
    forbidden(403),
    "关闭短信登录后，已持有旧验证码也不能调用短信登录 API"
  );
  assert.equal(accountReads, 0, "关闭登录方式时不应触碰或泄露账号存在性");
  console.log("client channel login gate tests passed: password, SMS challenge, SMS login all fail closed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

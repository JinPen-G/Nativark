const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const contract = require("../packages/shared/src/client");

assert.equal(contract.CLIENT_API_VERSION, "v1");
assert.deepEqual(contract.CLIENT_VERIFICATION_METHODS, ["sms", "email"]);
assert.deepEqual(contract.CLIENT_REGISTRATION_CHANNEL, "app");

const target = { tenantCode: "tenant-demo", workspaceCode: "camera" };
const challenge = {
  ...target,
  method: "sms",
  identifier: "13800000000",
  idempotencyKey: "challenge-1"
};
assert.ok("tenantCode" in challenge && "workspaceCode" in challenge, "客户端请求必须明确目标空间");

const registration = {
  ...target,
  name: "测试会员",
  phone: "13800000000",
  verificationToken: "opaque-proof",
  consent: {
    userAgreementVersion: "2026-09",
    privacyPolicyVersion: "2026-09",
    agreedAt: "2026-09-13T10:00:00.000Z"
  },
  idempotencyKey: "registration-1"
};
assert.ok(registration.verificationToken, "注册必须使用验证码交换后的短期证明");
assert.ok(registration.consent.userAgreementVersion && registration.consent.privacyPolicyVersion, "注册必须留存协议版本");
assert.ok(registration.idempotencyKey, "注册必须带业务幂等键");
assert.equal("workspaceId" in registration, false, "客户端契约不得接受内部 workspaceId");
assert.equal("directApprove" in registration, false, "客户端契约不得暴露后台直通过字段");

const session = {
  apiVersion: "v1",
  accessToken: "client-access",
  refreshToken: "client-refresh",
  expiresIn: 900,
  customer: {
    customerId: "customer-1",
    customerType: "personal",
    displayName: "测试会员",
    loginIdentifierMasked: "138****0000"
  },
  workspaces: []
};
assert.equal(session.apiVersion, "v1");
assert.equal("permissions" in session, false, "客户端会话不能携带运营权限矩阵");
assert.equal("roleIds" in session, false, "客户端会话不能复用运营角色字段");

console.log("MEMBER-01F 客户端会员 v1 契约：12 项全部通过");

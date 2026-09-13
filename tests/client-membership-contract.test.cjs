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

const profileUpdate = { name: "移动端会员", email: "member@example.com" };
assert.equal("phone" in profileUpdate, false, "客户端资料更新不能直接改手机号");
assert.equal("identityNo" in profileUpdate, false, "客户端资料更新不能直接改证件号");

const contact = { kind: "emergency", name: "紧急联系人", phone: "13900000000", isPrimary: true };
assert.equal(contact.kind, "emergency");
assert.equal("phoneMasked" in contact, false, "客户端写联系人使用明文输入，响应必须由服务端脱敏");

const benefitsQuery = { corporateCustomerId: "corporate-1" };
assert.ok(benefitsQuery.corporateCustomerId, "企业权益解析必须使用服务端校验的企业标识");

const payment = {
  apiVersion: "v1",
  mode: "simulation_only",
  realPaymentEnabled: false,
  methods: ["simulation"],
  instruments: ["rental", "deposit", "preauthorization"]
};
assert.equal(payment.realPaymentEnabled, false, "客户端 v1 不得伪装已接入真实支付");
assert.deepEqual(payment.instruments, ["rental", "deposit", "preauthorization"]);

console.log("MEMBER-01F/CLIENT-01 客户端会员 v1 契约：20 项全部通过");

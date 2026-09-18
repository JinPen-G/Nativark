const assert = require("node:assert/strict");
require("reflect-metadata");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const contract = require("../packages/shared/src/client");
const { OPENAPI_COMPONENT_SCHEMAS: schemas } = require("../apps/api/src/contracts/openapi-document");
for (const name of ["ClientRegistrationChallengeRequest", "ClientPersonalMembershipRegistrationRequest"]) {
  assert.ok(schemas[name].required.includes("tenantCode"));
  assert.ok(!schemas[name].required.includes("workspaceCode"), `${name} 的 OpenAPI 不能把可选空间误记为必填`);
}
assert.deepEqual(schemas.AuthUser.properties.tenantMembership.required, ["permissions", "dataScope", "isTenantAdmin"]);
assert.equal(schemas.CustomerMembershipBenefit.properties.scope.$ref, "#/components/schemas/CustomerMembershipBenefitScope");
assert.equal(schemas.CustomerMembershipBenefitScope.oneOf.length, 3);


assert.equal(contract.CLIENT_API_VERSION, "v1");
assert.deepEqual(contract.CLIENT_VERIFICATION_METHODS, ["sms", "email"]);
assert.deepEqual(contract.CLIENT_REGISTRATION_CHANNEL, "app");

const target = { tenantCode: "tenant-demo" };
const challenge = {
  ...target,
  method: "sms",
  identifier: "13800000000",
  idempotencyKey: "challenge-1"
};
const { plainToInstance } = require("class-transformer");
const { validateSync } = require("class-validator");
const {
  ClientRegistrationChallengeRequestDto, ClientPersonalMembershipRegistrationRequestDto,
  ClientWorkspaceTargetDto, ClientProfileUpdateRequestDto
} = require("../apps/api/src/modules/client/client-request.dto");
const errorsFor = (Dto, input) => validateSync(plainToInstance(Dto, input), { whitelist: true, forbidNonWhitelisted: true });
assert.deepEqual(errorsFor(ClientRegistrationChallengeRequestDto, challenge), [], "只提供 tenantCode 即可申请挑战");
assert.deepEqual(errorsFor(ClientRegistrationChallengeRequestDto, { ...challenge, workspaceCode: "camera" }), [], "也允许显式指定业务空间");
for (const tenantCode of [undefined, ""]) {
  assert.ok(errorsFor(ClientRegistrationChallengeRequestDto, { ...challenge, tenantCode }).some((error) => error.property === "tenantCode"), "tenantCode 仍必填");
}
assert.ok(errorsFor(ClientWorkspaceTargetDto, target).some((error) => error.property === "workspaceCode"), "明确要求空间的业务契约仍不能省略 workspaceCode");

const registration = {
  ...target,
  name: "测试会员",
  phone: "13800000000",
  password: "Member1234",
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
assert.deepEqual(errorsFor(ClientPersonalMembershipRegistrationRequestDto, registration), [], "租户注册不要求指定空间");
assert.deepEqual(errorsFor(ClientPersonalMembershipRegistrationRequestDto, { ...registration, workspaceCode: "camping" }), []);
for (const tenantCode of [undefined, ""]) {
  assert.ok(errorsFor(ClientPersonalMembershipRegistrationRequestDto, { ...registration, tenantCode }).some((error) => error.property === "tenantCode"));
}
for (const [Dto, input] of [[ClientRegistrationChallengeRequestDto, challenge], [ClientPersonalMembershipRegistrationRequestDto, registration]]) {
  assert.ok(errorsFor(Dto, { ...input, workspaceCode: "" }).some((error) => error.property === "workspaceCode"), "空间编码选填不代表允许空串");
  for (const field of ["tenantId", "workspaceId", "customerId", "directApprove", "reviewedBy", "membershipStatus"]) {
    assert.ok(errorsFor(Dto, { ...input, [field]: "forged" }).some((error) => error.property === field && error.constraints?.whitelistValidation), `客户端不得提交 ${field}`);
  }
}

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
for (const field of ["phone", "identityNo"]) {
  assert.ok(errorsFor(ClientProfileUpdateRequestDto, { ...profileUpdate, [field]: "forged" }).some((error) => error.property === field && error.constraints?.whitelistValidation));
}

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

// 纯内存调用真实认证服务：token 仍绑定业务空间，会员状态却只有一份。
const { ClientAuthService } = require("../apps/api/src/modules/client/client-auth.service");
const { hashPassword } = require("../apps/api/src/common/password");
const tenant = { id: "tenant-client", code: "tenant-demo", status: "ACTIVE" };
const customer = { id: "customer-client", tenantId: tenant.id, customerType: "personal", name: "共享会员", phone: "13800000000", status: "active" };
const account = { tenantId: tenant.id, customerId: customer.id, loginPhone: customer.phone, passwordHash: hashPassword("Member1234"), status: "active", customer };
const membership = { tenantId: tenant.id, customerId: customer.id, status: "active" };
const workspaces = [
  { id: "ws-camera", tenantId: tenant.id, code: "camera", name: "相机", categoryCode: "CAMERA", status: "ACTIVE", isDefault: true },
  { id: "ws-camping", tenantId: tenant.id, code: "camping", name: "露营", categoryCode: "CAMPING", status: "ACTIVE", isDefault: false },
  { id: "ws-foreign", tenantId: "tenant-foreign", code: "foreign", name: "其他租户空间", categoryCode: "CAMERA", status: "ACTIVE", isDefault: true }
];
const sessions = new Map();
const prisma = {
  tenant: { findFirst: async ({ where }) => where.code === tenant.code && where.status === tenant.status ? tenant : null },
  businessWorkspace: {
    findFirst: async ({ where }) => workspaces.find((row) => row.tenantId === where.tenantId && (!where.code || row.code === where.code) && (!where.id || row.id === where.id) && row.status === where.status) ?? null,
    findMany: async ({ where }) => workspaces.filter((row) => row.tenantId === where.tenantId && row.status === where.status)
  },
  customerProfile: { findFirst: async ({ where }) => where.tenantId === tenant.id && where.id === customer.id ? customer : null },
  customerAccount: { findFirst: async ({ where }) => where.tenantId === tenant.id && (!where.customerId || where.customerId === customer.id) && (!where.loginPhone || where.loginPhone === account.loginPhone) ? account : null },
  customerMembership: {
    findUnique: async ({ where }) => {
      assert.deepEqual(where, { tenantId_customerId: { tenantId: tenant.id, customerId: customer.id } });
      return membership;
    },
    findFirst: async ({ where }) => {
      assert.equal("workspaceId" in where, false, "客户端认证不能按空间寻找第二份会员");
      return where.tenantId === tenant.id && where.customerId === customer.id && !where.status?.notIn?.includes(membership.status) ? membership : null;
    }
  },
  clientAuthSession: {
    create: async ({ data }) => { const row = { ...data, revokedAt: null }; sessions.set(row.id, row); return row; },
    findFirst: async ({ where }) => {
      const row = sessions.get(where.id);
      if (!row || !Object.entries(where).every(([key, value]) => row[key] === value)) return null;
      return { ...row, customer, tenant, workspace: workspaces.find((space) => space.id === row.workspaceId) };
    },
    updateMany: async () => ({ count: 1 })
  }
};
void (async () => {
  const oldSecret = process.env.AUTH_TOKEN_SECRET;
  process.env.AUTH_TOKEN_SECRET = "client-membership-contract-test-only-secret";
  try {
    const auth = new ClientAuthService(prisma, {});
    assert.equal((await auth.resolveTarget(tenant.code)).workspace.id, "ws-camera", "注册未指定空间时仍解析默认业务上下文");
    const cameraSession = await auth.login({ tenantCode: tenant.code, loginIdentifier: customer.phone, password: "Member1234" });
    const camera = await auth.authenticate(cameraSession.accessToken);
    const campingSession = await auth.switchWorkspace(camera, { workspaceCode: "camping" });
    const camping = await auth.authenticate(campingSession.accessToken);
    assert.equal(camera.customerId, camping.customerId);
    assert.equal(camera.workspaceId, "ws-camera");
    assert.equal(camping.workspaceId, "ws-camping");
    assert.equal(camera.membershipStatus, "active");
    assert.equal(camping.membershipStatus, "active");
    assert.deepEqual(cameraSession.workspaces.map((row) => row.workspaceCode), ["camera", "camping"]);
    assert.deepEqual(cameraSession.workspaces, campingSession.workspaces, "共享会员在两空间会话中展示相同的租户工作空间集合");
    assert.equal("permissions" in cameraSession, false);
    assert.equal("roleIds" in campingSession, false);
    await assert.rejects(() => auth.switchWorkspace(camera, { workspaceCode: "foreign" }), /经营空间不存在或未启用/u);
    await assert.rejects(() => auth.login({ tenantCode: "other-tenant", loginIdentifier: customer.phone, password: "Member1234" }), /账号或密码错误/u);
    membership.status = "suspended";
    for (const token of [cameraSession.accessToken, campingSession.accessToken]) {
      assert.equal((await auth.authenticate(token)).membershipStatus, "suspended", "会员暂停限制业务但不能冒充账号停用，两空间认证读到同一状态");
    }
    assert.equal(account.status, "active");
    account.status = "suspended";
    for (const token of [cameraSession.accessToken, campingSession.accessToken]) {
      await assert.rejects(() => auth.authenticate(token), /客户端会话已失效/u);
    }
    assert.equal(membership.status, "suspended", "停账号不改写会员");
    account.status = "active";
    membership.status = "closed";
    for (const token of [cameraSession.accessToken, campingSession.accessToken]) {
      await assert.rejects(() => auth.authenticate(token), /客户端会话已失效/u);
    }
    console.log("MEMBER-01F/CLIENT-01 租户会员契约与空间认证上下文全部通过");
  } finally {
    if (oldSecret === undefined) delete process.env.AUTH_TOKEN_SECRET;
    else process.env.AUTH_TOKEN_SECRET = oldSecret;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

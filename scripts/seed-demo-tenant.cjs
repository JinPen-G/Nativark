/*
 * 为本机 Rental OS 开发库补齐一个可演示的 demo 租户。
 *
 * 这个脚本只做幂等补齐，不清空、不删除、不重置租户数据。业务配置优先走
 * 真实 HTTP 接口，会员与订单也走真实业务链路；仅用 Prisma 补建跨空间的企业
 * 主档关系，因为当前运营端没有“把已有企业加入另一个空间”的写入口。
 *
 * 安全边界：必须是本机 MySQL 的 rental_os 库，且只能操作固定 tenant_001/demo。
 */
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const API_BASE = (process.env.DEMO_API_BASE_URL || "http://localhost:3000/api").replace(/\/$/u, "");
const TENANT_ID = "tenant_001";
const TENANT_CODE = "demo";
const DEMO_YEAR = 2026;
const DEMO_START = "2026-10-15T10:00:00+08:00";
const DEMO_END = "2026-10-17T10:00:00+08:00";

function loadRootEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function assertLocalDatabase() {
  // RENTAL_OS_DATA_SOURCE / PLATFORM_DATA_SOURCE 在应用配置里是“驱动标识”时，
  // 真正的连接串仍由 DATABASE_URL 提供；只有拿到 mysql:// URL 才进入守卫。
  const raw = [process.env.RENTAL_OS_DATA_SOURCE, process.env.DATABASE_URL]
    .find((value) => typeof value === "string" && /^mysql:\/\//u.test(value));
  if (!raw) throw new Error("缺少 RENTAL_OS_DATA_SOURCE/DATABASE_URL，拒绝执行演示数据脚本");
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error("数据库连接串无效，拒绝执行演示数据脚本"); }
  const database = parsed.pathname.replace(/^\//u, "");
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "mysql:" || !["localhost", "127.0.0.1", "::1"].includes(host) || database !== "rental_os") {
    throw new Error("演示数据脚本只允许写本机 MySQL rental_os 数据库");
  }
}

async function request(pathname, method = "GET", token, body) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  const data = payload?.data ?? payload;
  if (!response.ok) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : Array.isArray(payload?.message) ? payload.message.join("；") : `HTTP ${response.status}`;
    throw new Error(`${method} ${pathname} 失败：${message}`);
  }
  return data;
}

async function uploadItemGroupImage(token, itemGroupId, imagePath) {
  const buffer = fs.readFileSync(imagePath);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "image/png" }), path.basename(imagePath));
  const response = await fetch(`${API_BASE}/rental/v1/item-groups/${encodeURIComponent(itemGroupId)}/images`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : Array.isArray(payload?.message) ? payload.message.join("；") : `HTTP ${response.status}`;
    throw new Error(`POST item-group image 失败：${message}`);
  }
  return payload?.data ?? payload;
}

async function ensureItemGroupImages(token, workspaceCode, groups) {
  const imageByWorkspace = {
    default: path.join(ROOT, "apps", "website", "public", "images", "hero-camera.png"),
    camping: path.join(ROOT, "apps", "website", "public", "images", "camping.png"),
    vehicle: path.join(ROOT, "apps", "website", "public", "images", "vehicle.png"),
    construction: path.join(ROOT, "apps", "website", "public", "images", "construction.png")
  };
  const imagePath = imageByWorkspace[workspaceCode];
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error(`${workspaceCode} 缺少演示图片资源`);
  for (const group of groups) {
    if (Array.isArray(group.images) && group.images.length > 0) continue;
    await uploadItemGroupImage(token, group.id, imagePath);
  }
}

function latestVersion(plan) {
  return [...(plan?.versions || [])].sort((a, b) => Number(b.version) - Number(a.version))[0];
}

async function ensureMembershipPlan(token, input) {
  const plans = await request("/membership/plans", "GET", token);
  let plan = plans.find((item) => item.code === input.code);
  if (!plan) {
    plan = await request("/membership/plans", "PUT", token, input);
  }
  let version = latestVersion(plan);
  if (!version || version.status === "disabled") {
    plan = await request("/membership/plans", "PUT", token, input);
    version = latestVersion(plan);
  }
  if (version?.status === "draft") {
    plan = await request(`/membership/plans/${encodeURIComponent(plan.id)}/versions/${encodeURIComponent(version.id)}/publish`, "POST", token);
    version = latestVersion(plan);
  }
  if (!version || version.status !== "published") throw new Error(`会员方案 ${input.code} 没有可发布版本`);
  return { plan, version };
}

async function ensureAssignment(token, customerId, versionId, reason) {
  const assignments = await request(`/membership/plans/assignments/${encodeURIComponent(customerId)}`, "GET", token);
  if (assignments.some((item) => item.planVersionId === versionId && item.status === "active")) return;
  await request("/membership/plans/assignments", "POST", token, {
    customerId,
    planVersionId: versionId,
    source: "manual",
    reason
  });
}

async function ensureQualification(token, customerId, qualificationType, referenceNo, approve) {
  const history = await request(`/membership/personal/${encodeURIComponent(customerId)}/qualification-history?qualificationType=${encodeURIComponent(qualificationType)}`, "GET", token);
  if (history.length) return;
  const submitted = await request(`/membership/personal/${encodeURIComponent(customerId)}/qualifications`, "POST", token, {
    qualificationType,
    referenceNo,
    issuedAt: "2026-01-01",
    expiresAt: "2028-12-31"
  });
  if (approve && submitted.review?.id) {
    await request(`/membership/reviews/${encodeURIComponent(submitted.review.id)}/decision`, "POST", token, {
      status: "approved"
    });
  }
}

async function main() {
  loadRootEnv();
  assertLocalDatabase();
  const demoMemberPassword = process.env.DEMO_MEMBER_PASSWORD || process.env.E2E_DEMO_PASSWORD;
  if (!demoMemberPassword) throw new Error("缺少 E2E_DEMO_PASSWORD 或 DEMO_MEMBER_PASSWORD，无法建立演示会员账号");

  await request("/health");
  const login = await request("/auth/login", "POST", undefined, {
    tenantCode: TENANT_CODE,
    account: "admin",
    password: process.env.E2E_DEMO_PASSWORD
  });
  let token = login.accessToken;
  if (!token || login.tenant?.tenantId !== TENANT_ID) throw new Error("demo 登录成功但租户不是 tenant_001，拒绝继续");

  const activeWorkspaces = (login.workspaces || []).filter((workspace) => String(workspace.status).toLowerCase() === "active");
  const expectedCodes = new Set(["default", "camping", "vehicle", "construction"]);
  const actualCodes = new Set(activeWorkspaces.map((workspace) => workspace.code));
  if (activeWorkspaces.length !== 4 || [...expectedCodes].some((code) => !actualCodes.has(code))) {
    throw new Error(`demo ACTIVE 空间不完整：${JSON.stringify(activeWorkspaces.map((workspace) => workspace.code))}`);
  }

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const customerIds = {};
  const corporateByWorkspace = {};
  const summaries = [];
  try {
    // 先让每个空间从当前真实服务层生成核心/经营配置，再通过报价提交写穿快照。
    for (const workspace of activeWorkspaces) {
      const switched = await request("/auth/switch-workspace", "POST", token, { workspaceId: workspace.id });
      token = switched.accessToken;
      const businessSettings = await request("/rental/v1/business-settings", "GET", token);
      for (const pathPart of [
        "locations", "item-groups", "pricing-groups", "assets", "stock-balances",
        "inspection-templates", "pricing-plans", "pricing-versions", "discount-plans", "value-added-services",
        "rule-versions", "tenant-readiness"
      ]) await request(`/rental/v1/${pathPart}`, "GET", token);
      const fulfillmentMode = [
        "store_pickup_return",
        "warehouse_pickup_return",
        "partner_pickup_return",
        "delivery",
        "onsite_delivery"
      ].find((mode) => businessSettings.fulfillment?.enabledModes?.includes(mode));
      if (!fulfillmentMode) throw new Error(`${workspace.code} 没有可用于演示订单的履约方式`);
      await request("/membership/registration-settings", "PUT", token, { registrationMode: "automatic" });
      for (const person of [
        { key: "primary", name: "演示会员张晨", phone: "85290000001", email: "demo.member1@example.test", gender: "male", birthday: "1990-05-12", sourceChannel: "walk_in", region: "上海" },
        { key: "secondary", name: "演示会员李宁", phone: "85290000002", email: "demo.member2@example.test", gender: "female", birthday: "1988-11-03", sourceChannel: "referral", region: "杭州" },
        { key: "pending", name: "演示会员周敏", phone: "85290000003", email: "demo.member3@example.test", gender: "unknown", birthday: "1995-02-20", sourceChannel: "mini_program", region: "苏州" }
      ]) {
        const result = await request("/membership/personal", "POST", token, {
          name: person.name,
          phone: person.phone,
          email: person.email,
          identityNo: `D${person.phone.slice(-8)}`,
          gender: person.gender,
          birthday: person.birthday,
          sourceChannel: person.sourceChannel,
          region: person.region,
          channel: "admin",
          directApprove: true,
          temporaryPassword: demoMemberPassword,
          idempotencyKey: `demo-membership-${person.key}`
        });
        customerIds[person.key] = result.customerId;
        // 兼容旧的本地响应包装：如果某个开发进程没有加载最新响应拦截器，
        // 仍从固定手机号回查同一主档，绝不因为响应形状差异重复造客户。
        if (!customerIds[person.key]) {
          const existing = await prisma.customerProfile.findFirst({ where: { tenantId: TENANT_ID, phone: person.phone }, select: { id: true } });
          customerIds[person.key] = existing?.id;
        }
      }
      if (Object.values(customerIds).some((value) => !value)) throw new Error(`${workspace.code} 演示个人会员主档未能解析`);

      const categoryQualification = {
        // 订单规则快照按可读的资格名称匹配，演示数据的 code 与名称保持一致，
        // 避免“资格已审核但订单仍提示缺少资格”的假数据。
        default: ["摄影从业证明", "摄影从业证明"],
        camping: ["户外活动证明", "户外活动证明"],
        vehicle: ["驾驶证", "驾驶证"],
        construction: ["操作资格证", "操作资格证"]
      }[workspace.code];
      const qualificationTypes = await request("/membership/qualification-types", "GET", token);
      let qualification = qualificationTypes.find((item) => item.code === categoryQualification[0]);
      if (!qualification) {
        qualification = await request("/membership/qualification-types", "PUT", token, {
          code: categoryQualification[0],
          name: categoryQualification[1],
          requiredForBooking: false,
          status: "enabled"
        });
      }
      await ensureQualification(token, customerIds.primary, qualification.code, `DEMO-${workspace.code.toUpperCase()}-001`, true);
      if (workspace.code === "default") await ensureQualification(token, customerIds.pending, qualification.code, "DEMO-CAMERA-PENDING", false);

      let corporate = (await request("/membership/corporate", "GET", token)).find((item) => item.corporateName === "演示科技有限公司");
      if (!corporate && workspace.code === "default") {
        corporate = await request("/membership/corporate", "PUT", token, {
          name: "演示科技企业管理员",
          phone: "85290000009",
          email: "demo.corporate@example.test",
          corporateName: "演示科技有限公司",
          corporateTaxNo: "DEMO-TAX-001"
        });
      }
      if (!corporate) {
        corporate = await prisma.customerProfile.findFirst({ where: { tenantId: TENANT_ID, customerType: "corporate", corporateName: "演示科技有限公司" }, select: { id: true, name: true, corporateName: true, phoneMasked: true } });
      }
      if (!corporate) throw new Error(`${workspace.code} 无法建立演示企业会员`);
      corporateByWorkspace[workspace.id] = corporate.customerId || corporate.id;
      for (const employee of [
        { personalCustomerId: customerIds.primary, role: "admin", department: "运营管理", employeeNo: `DEMO-${workspace.code}-A01` },
        { personalCustomerId: customerIds.secondary, role: "employee", department: "业务部门", employeeNo: `DEMO-${workspace.code}-E01` }
      ]) {
        await request(`/membership/corporate/${encodeURIComponent(corporateByWorkspace[workspace.id])}/employees`, "PUT", token, { ...employee, reason: "演示企业初始化员工关系" });
      }

      const plans = await request("/membership/plans", "GET", token);
      const personalPlan = await ensureMembershipPlan(token, {
        code: "DEMO-PERSONAL",
        name: "演示个人会员",
        targetType: "personal",
        levelRank: 1,
        isDefault: true,
        isRecommended: true,
        appVisible: true,
        effectiveFrom: "2026-01-01T00:00:00+08:00",
        eligibility: {},
        benefits: [
          { type: "rental_discount", calculation: "percentage", value: 5, maximum: 100, stackable: true },
          { type: "priority_reservation", calculation: "priority", value: 1, stackable: true }
        ]
      });
      const corporatePlan = await ensureMembershipPlan(token, {
        code: "DEMO-CORPORATE",
        name: "演示企业会员",
        targetType: "corporate",
        levelRank: 1,
        isDefault: true,
        isRecommended: true,
        appVisible: true,
        effectiveFrom: "2026-01-01T00:00:00+08:00",
        eligibility: {},
        benefits: [
          { type: "rental_discount", calculation: "percentage", value: 10, maximum: 300, stackable: true },
          { type: "service_benefit", calculation: "amount", value: 50, stackable: true }
        ]
      });
      await ensureAssignment(token, customerIds.primary, personalPlan.version.id, "演示个人会员初始化");
      await ensureAssignment(token, corporateByWorkspace[workspace.id], corporatePlan.version.id, "演示企业会员初始化");

      const templates = await request("/rental/v1/coupon-templates", "GET", token);
      let couponTemplate = templates.find((item) => item.code === "DEMO-WELCOME");
      if (!couponTemplate) {
        couponTemplate = await request("/rental/v1/coupon-templates", "POST", token, {
          code: "DEMO-WELCOME",
          name: "演示新客券",
          discountType: "percentage",
          discountValue: 10,
          minimumSpend: 100,
          maximumDiscount: 80,
          appliesTo: "rental",
          stackableWithDiscountPlans: false,
          totalQuota: 100,
          perCustomerLimit: 1,
          perCustomerUseLimit: 1,
          totalBudget: 8000,
          effectiveFrom: "2026-01-01T00:00:00+08:00",
          effectiveTo: "2027-12-31T23:59:59+08:00",
          applicableItemGroupIds: [],
          status: "active"
        });
      }
      let customerCoupon = (await request(`/rental/v1/customer-coupons?customerId=${encodeURIComponent(customerIds.primary)}`, "GET", token)).find((item) => item.templateId === couponTemplate.id && item.status !== "void");
      if (!customerCoupon) {
        customerCoupon = await request("/rental/v1/customer-coupons/claim", "POST", token, { templateId: couponTemplate.id, customerId: customerIds.primary });
      }

      const calendar = await request(`/rental/v1/calendars/${DEMO_YEAR}`, "GET", token);
      if (calendar.status !== "published") await request(`/rental/v1/calendars/${DEMO_YEAR}/publish`, "POST", token, { changeReason: "演示租户初始化营业日历" });

      const locations = await request("/rental/v1/locations", "GET", token);
      const groups = await request("/rental/v1/pricing-groups", "GET", token);
      const itemGroups = await request("/rental/v1/item-groups", "GET", token);
      await ensureItemGroupImages(token, workspace.code, itemGroups);
      const pricingPlans = await request("/rental/v1/pricing-plans", "GET", token);
      const discountPlans = await request("/rental/v1/discount-plans", "GET", token);
      const services = await request("/rental/v1/value-added-services", "GET", token);
      const orders = await request("/rental/v1/orders", "GET", token);
      const demoStartMs = new Date(DEMO_START).getTime();
      const demoEndMs = new Date(DEMO_END).getTime();
      const existing = orders.find((order) =>
        order.customerId === customerIds.primary &&
        new Date(order.startAt).getTime() === demoStartMs &&
        new Date(order.endAt).getTime() === demoEndMs
      );
      let quote;
      let order = existing;
      if (!existing) {
        const quoteBody = {
          customerType: "personal",
          customerId: customerIds.primary,
          bookingIdentity: { bookingIdentity: "personal" },
          fulfillmentMode,
          fulfillmentLocationId: locations[0].id,
          returnLocationId: locations[0].id,
          startAt: DEMO_START,
          endAt: DEMO_END,
          pricingPlanId: pricingPlans.find((item) => item.status === "enabled")?.id,
          discountPlanId: discountPlans.find((item) => item.status === "enabled")?.id,
          customerCouponId: customerCoupon?.id,
          lines: [{ pricingGroupId: groups[0].id, quantity: 1 }],
          services: services[0] ? [{ serviceId: services[0].id, quantity: 1 }] : []
        };
        const quoteAttempts = [
          quoteBody,
          { ...quoteBody, discountPlanId: undefined },
          { ...quoteBody, customerCouponId: undefined },
          { ...quoteBody, discountPlanId: undefined, customerCouponId: undefined }
        ];
        let lastQuoteError;
        for (const attempt of quoteAttempts) {
          const body = Object.fromEntries(Object.entries(attempt).filter(([, value]) => value !== undefined));
          try {
            quote = await request("/rental/v1/quotes", "POST", token, body);
            break;
          } catch (error) {
            lastQuoteError = error;
          }
        }
        if (!quote) throw lastQuoteError;
        order = await request("/rental/v1/orders", "POST", token, {
          quoteId: quote.id,
          customerType: "personal",
          customerId: customerIds.primary,
          customerName: "演示会员张晨",
          contactPhone: "85290000001",
          bookingIdentity: { bookingIdentity: "personal" },
          fulfillmentMode,
          fulfillmentLocationId: locations[0].id,
          returnLocationId: locations[0].id,
          startAt: DEMO_START,
          endAt: DEMO_END,
          lines: [{ itemGroupId: groups[0].id, pricingGroupId: groups[0].id, quantity: 1 }],
          operator: "demo-seed"
        });
      }
      summaries.push({
        code: workspace.code,
        itemGroups: itemGroups.length,
        itemGroupsWithImages: itemGroups.filter((item) => Array.isArray(item.images) && item.images.length > 0).length,
        pricingGroups: groups.length,
        plans: pricingPlans.length,
        discounts: discountPlans.length,
        services: services.length,
        customerCoupon: Boolean(customerCoupon),
        orderStatus: order?.status || "existing"
      });
    }

    const counts = {};
    for (const workspace of activeWorkspaces) {
      const [groups, assets, stocks, plans, versions, discounts, services, calendars, quotes, orders, members, corporateLinks] = await Promise.all([
        prisma.rentalItemGroup.count({ where: { tenantId: TENANT_ID, workspaceId: workspace.id } }),
        prisma.rentalAsset.count({ where: { tenantId: TENANT_ID, workspaceId: workspace.id } }),
        prisma.rentalStockBalance.count({ where: { tenantId: TENANT_ID, workspaceId: workspace.id } }),
        prisma.rentalPricingPlan.count({ where: { tenantId: TENANT_ID, workspaceId: workspace.id } }),
        prisma.rentalPriceVersion.count({ where: { tenantId: TENANT_ID, workspaceId: workspace.id } }),
        prisma.rentalDiscountPlan.count({ where: { tenantId: TENANT_ID, workspaceId: workspace.id } }),
        prisma.rentalValueAddedService.count({ where: { tenantId: TENANT_ID, workspaceId: workspace.id } }),
        prisma.rentalBusinessCalendar.count({ where: { tenantId: TENANT_ID, workspaceId: workspace.id, year: DEMO_YEAR, status: "published" } }),
        prisma.rentalQuote.count({ where: { tenantId: TENANT_ID, workspaceId: workspace.id } }),
        prisma.rentalOrder.count({ where: { tenantId: TENANT_ID, workspaceId: workspace.id } }),
        prisma.customerMembership.count({ where: { tenantId: TENANT_ID, status: "active" } }),
        prisma.customerCorporateMembership.count({ where: { tenantId: TENANT_ID, status: "active" } })
      ]);
      counts[workspace.code] = { groups, assets, stocks, plans, versions, discounts, services, publishedCalendars: calendars, quotes, orders, tenantActiveMembers: members, tenantCorporateEmployees: corporateLinks };
    }
    console.log(JSON.stringify({ tenant: TENANT_CODE, workspaces: summaries, verified: counts }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

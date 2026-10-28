/** Add-only, scoped demo scenarios through authenticated Core APIs.
 * The receipt owns every order this module may advance. Existing orders/settings are untouched.
 * Money is recorded only through the documented simulated funding ledger, with offline_cash.
 */
const fs = require("node:fs");
const path = require("node:path");
const { request, RUN, RECEIPT } = require("./seed-demo-order-scenarios.cjs");
const HOUR = 3600000;
const DAY = 24 * HOUR;
const round = number => Math.round((number + Number.EPSILON) * 100) / 100;

function scenarios(context, anchor) {
  const enabled = context.items.filter(item => item.status === "enabled");
  const body = enabled.find(item => item.code === "CAM-BODY");
  const lens = enabled.find(item => item.code === "CAM-LENS");
  const kit = enabled.find(item => item.code === "CAM-KIT");
  const members = context.members.filter(item => /演示会员(?:张晨|李宁)/u.test(item.name));
  const pendingMember = context.members.find(item => /演示会员周敏/u.test(item.name)) ?? members[0];
  const location = context.locations.find(item => item.status === "enabled" && item.capabilities?.includes("pickup") && item.capabilities?.includes("return"));
  const plan = context.plans.find(item => item.status === "enabled");
  if (!body || !lens || !kit || !members.length || !location || !plan) throw new Error("Existing demo catalog/member/location/price prerequisites are incomplete");
  if (!context.settings.payment.enabledMethods?.includes("offline_cash")) throw new Error("The demo does not allow the documented offline simulated funding method");
  const line = (item, quantity = 1, note) => {
    const group = context.pricingGroups.find(group => group.status === "enabled" && group.memberItemGroupIds.includes(item.id));
    if (!group) throw new Error(`No existing pricing group for ${item.code}`);
    return { itemGroupId: item.id, pricingGroupId: group.id, quantity, note };
  };
  const inputs = [
    ["draft-portrait", "draft", 10 * DAY, 12 * DAY, [line(kit, 1, "演示：周末人像约拍，机身与镜头成套交付")], pendingMember],
    ["draft-two-lenses", "draft", 13 * DAY, 14 * DAY, [line(lens, 2, "演示：双机位活动备镜，数量为2")]],
    ["reserved-body", "reserved", 6 * DAY, 8 * DAY, [line(body, 1, "演示：企业访谈拍摄，已确认待配货")]],
    ["reserved-multiline", "reserved", 16 * DAY, 19 * DAY, [line(body), line(lens, 2, "演示：会议直播两组标准变焦镜头")]],
    ["cancelled-location", "cancelled", 20 * DAY, 22 * DAY, [line(lens, 1, "演示：外景档期调整，客户取消预约")]],
    ["completed-studio", "completed", -3 * DAY, -5 * 60000, [line(kit, 1, "演示：棚拍项目，器材完整归还并完成结算")]],
    ["settling-interview", "settling", -2 * DAY, -3 * 60000, [line(body), line(lens, 1, "演示：访谈拍摄完成，实物已还，待处理保证金")]],
    ["renting-overdue", "renting", -5 * DAY, -DAY, [line(body, 1, "演示：短片摄制延迟，尚未归还，展示逾期提醒")]],
    ["renting-normal", "renting", -DAY, 3 * DAY, [line(lens, 1, "演示：旅行记录拍摄，租期内使用中")]],
    ["ready-full-kit", "ready_for_pickup", HOUR, 2 * DAY, [line(kit, 1, "演示：商业人像，机身镜头已锁定，等待到店取机")]],
    ["ready-late-pickup", "ready_for_pickup", -3 * HOUR, 2 * DAY + HOUR, [line(lens, 1, "演示：客户尚未到店，保留资源等待联系")]],
  ];
  return inputs.map(([key, target, start, end, lines, person], index) => {
    const member = person ?? members[index % members.length];
    return { key, target, input: { customerType: "personal", customerId: member.customerId, customerName: member.name,
      bookingIdentity: { bookingIdentity: "personal" }, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, returnLocationId: location.id,
      startAt: new Date(anchor + start).toISOString(), endAt: new Date(anchor + end).toISOString(), pricingPlanId: plan.id, lines, services: [],
    } };
  });
}
function loadReceipt(context) {
  if (fs.existsSync(RECEIPT)) {
    const receipt = JSON.parse(fs.readFileSync(RECEIPT, "utf8"));
    if (receipt.owner !== RUN || receipt.tenantId !== "tenant_001" || receipt.workspaceId !== context.workspace.id) throw new Error("Refusing to overwrite a receipt from another scope");
    return receipt;
  }
  const anchor = Math.floor(Date.now() / 60000) * 60000;
  return { owner: RUN, tenantId: "tenant_001", workspaceId: context.workspace.id, anchor, scenarios: scenarios(context, anchor) };
}
function save(receipt) { fs.mkdirSync(path.dirname(RECEIPT), { recursive: true }); fs.writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2)); }

async function apply(context) {
  if (context.workspace.id !== "ws_tenant_001" || context.workspace.code !== "default") throw new Error("Only the confirmed demo camera space may be seeded");
  const receipt = loadReceipt(context);
  save(receipt);
  const api = (route, method = "GET", body, key) => request(`/rental/v1/${route}`, context.token, method, body, key ? { "Idempotency-Key": key } : {});
  const summaries = [];
  for (const scenario of receipt.scenarios) {
    const prefix = `${RUN}:${scenario.key}`;
    const input = scenario.input;
    const route = () => `orders/${encodeURIComponent(scenario.orderId)}`;
    try {
      if (!scenario.quoteId) {
        const { customerName, ...quoteRequest } = input;
        const quote = await api("quotes", "POST", quoteRequest, `${prefix}:quote`);
        scenario.quoteId = quote.id;
        save(receipt);
      }
      if (!scenario.orderId) {
        const order = await api("orders", "POST", { quoteId: scenario.quoteId, customerType: input.customerType, customerId: input.customerId,
          customerName: input.customerName, bookingIdentity: input.bookingIdentity, fulfillmentMode: input.fulfillmentMode,
          fulfillmentLocationId: input.fulfillmentLocationId, returnLocationId: input.returnLocationId, startAt: input.startAt, endAt: input.endAt, lines: input.lines,
        }, `${prefix}:order`);
        scenario.orderId = order.id;
        scenario.orderNo = order.orderNo;
        save(receipt);
      }
      let order = await api(route());
      if (order.customerId !== input.customerId || order.startAt !== input.startAt || order.endAt !== input.endAt) throw new Error("Receipt/order association mismatch; no lifecycle action allowed");
      const fundingAction = (action, instrument, amount) => api(`${route()}/funding-events/${action}`, "POST", { instrument, ...(amount === undefined ? {} : { amount }),
        idempotencyKey: `${prefix}:${instrument}:${action}`, reason: `界面演示：${scenario.key}，模拟账务，不发生真实收付款`, paymentMethod: "offline_cash",
      }, `${prefix}:${instrument}:${action}`);
      if (scenario.target === "cancelled" && order.status === "draft") order = await api(`${route()}/cancel`, "POST", { reason: "界面演示：外景拍摄档期调整，客户在免费取消窗口内取消" }, `${prefix}:cancel`);
      if (!["draft", "cancelled"].includes(scenario.target) && order.status === "draft") {
        const balances = await api(`${route()}/funding-events`);
        for (const [instrument, requirement, current] of [
          ["rental", order.payableAmount, balances.rental?.collected ?? 0],
          ["deposit", order.depositAmount, balances.deposit?.collected ?? 0],
          ["preauthorization", order.preAuthAmount, balances.preauthorization?.frozen ?? 0],
        ]) if (Number(requirement) > .005 && current < .005) await fundingAction("initiate", instrument);
        order = await api(`${route()}/confirm`, "POST", {}, `${prefix}:confirm`);
      }
      if (["ready_for_pickup", "renting", "settling", "completed"].includes(scenario.target) && order.status === "reserved") order = await api(`${route()}/allocate`, "POST", {}, `${prefix}:allocate`);
      if (["renting", "settling", "completed"].includes(scenario.target) && order.status === "pickup_overdue") {
        order = await api(`${route()}/resume-pickup`, "POST", { reason: "界面演示：模拟客户已到店，按正常恢复领取流程办理" }, `${prefix}:resume-pickup`);
      }
      async function inspect(stage) {
        const inspectionTemplates = await api(`inspection-templates?orderId=${encodeURIComponent(order.id)}`);
        const template = inspectionTemplates.find(template => template.enabled && template.stage === stage);
        if (!template) throw new Error("No applicable existing handover template; refusing to skip inspection");
        scenario.evidence ??= {};
        if (!scenario.evidence[stage]) {
          const image = path.resolve(__dirname, "../apps/website/assets/industry-camera.png");
          const buffer = fs.readFileSync(image);
          const upload = await request("/files/upload-sessions", context.token, "POST", {
            businessModule: "rental-core", businessType: "rental_order", businessId: order.id,
            fileName: `DEMO-NOT-REAL-${scenario.key}-${stage}.png`, mimeType: "image/png", sizeBytes: buffer.length,
            uploadScene: `${stage}-evidence`, idempotencyKey: `${prefix}:evidence:${stage}`,
            metadata: { demoOnly: true, description: "仅用于本地测试的器材示意图；不是客户真实交接影像", source: RUN },
          });
          if (upload.mode !== "simulation") throw new Error("Demo evidence requires local simulation; external uploads are not authorized");
          const file = await request(`/files/upload-sessions/${upload.sessionId}/complete`, context.token, "POST", { checksum: require("node:crypto").createHash("sha256").update(buffer).digest("hex") });
          scenario.evidence[stage] = file.id ?? file.fileAssetId;
          if (!scenario.evidence[stage]) throw new Error("Upload completion did not return a file asset");
          save(receipt);
        }
        const lock = await api(`${route()}/operation-lock`, "POST", { action: "acquire" });
        const results = {};
        for (const field of template.fields) {
          if (field.type === "boolean") results[field.code] = true;
          else if (field.type === "number") results[field.code] = field.usageMetric ? stage === "pickup" ? 24860 : 25120 : 0;
          else if (field.type === "select") results[field.code] = field.options?.[0];
          else if (field.type === "text") results[field.code] = `演示记录：${stage === "pickup" ? "交付前" : "归还后"}外观、功能及附件核对完整`;
          else if (field.required) throw new Error("Template requires evidence files; do not fabricate photos/signatures");
        }
        try {
          const result = await request(`${API_PATH(route())}/inspections`, context.token, "POST", { templateId: template.id, results, attachments: [scenario.evidence[stage]], exceptions: [] }, { "X-Operation-Token": lock.token, "Idempotency-Key": `${prefix}:inspect:${stage}` });
          return result.order ?? result;
        } finally {
          // Inspection normally clears the lock; releasing our own token is harmless if it is still held.
          const current = await api(route());
          if (current.assignment?.operationLock) await api(`${route()}/operation-lock`, "POST", { action: "release", token: lock.token });
        }
      }
      if (["renting", "settling", "completed"].includes(scenario.target) && order.status === "ready_for_pickup") order = await inspect("pickup");
      if (["settling", "completed"].includes(scenario.target) && order.status === "renting") order = await inspect("return");
      if (scenario.target === "completed" && order.status === "settling") {
        if (order.feeReviews?.some(review => review.status === "pending")) throw new Error("Demo closure has pending fee review; left visible rather than inventing an approval");
        const balances = await api(`${route()}/funding-events`);
        if (balances.rental.balance > .005) await fundingAction("append", "rental", round(balances.rental.balance));
        if (balances.rental.balance < -.005) await fundingAction("refund", "rental", round(-balances.rental.balance));
        if (balances.deposit.balance > .005) await fundingAction("refund", "deposit", round(balances.deposit.balance));
        if (balances.preauthorization.balance > .005) await api(`${route()}/funding-events/release`, "POST", { idempotencyKey: `${prefix}:preauthorization:release`, reason: "界面演示：器材完整归还，释放模拟预授权" }, `${prefix}:preauthorization:release`);
        order = await api(`${route()}/settle`, "POST", {}, `${prefix}:settle`);
      }
      scenario.status = order.status;
      scenario.error = undefined;
      save(receipt);
      summaries.push({ scenario: scenario.key, orderNo: order.orderNo, status: order.status, items: order.lines.map(line => ({ name: line.itemGroupName, quantity: line.quantity })), payable: order.payableAmount });
    } catch (error) {
      scenario.error = error.message;
      save(receipt);
      summaries.push({ scenario: scenario.key, orderNo: scenario.orderNo, error: error.message });
      if (!error.message.startsWith("POST ") && !error.message.startsWith("GET ") && !error.message.startsWith("Demo closure")) break;
    }
  }
  return { receipt: RECEIPT, summaries };
}
const API_PATH = route => `/rental/v1/${route}`;
module.exports = { apply, scenarios };

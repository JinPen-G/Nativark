"use strict";

/**
 * SUB-01 SaaS 版本订阅框架：期限/周年纯函数 + OpenAPI 契约齐全性。
 *
 * 期限算法是最易出错的一块（闰日、月末收敛、防漂移、半开区间、服务时区次日零点），
 * 且为无依赖纯函数，最适合单测锁死。用 ts-node 直接加载源码，免整包构建。
 */

const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const {
  addCalendarYears,
  anniversaryFromAnchor,
  endFromServiceYears,
  exclusiveEndFromDate,
  isWithinTerm,
  isValidTimeZone
} = require("../apps/api/src/modules/subscription/subscription-term");
const { OPENAPI_DOCUMENT } = require("../apps/api/src/contracts/openapi-document");
const { isNewBusinessRoute } = require("../apps/api/src/common/api-auth.guard");

test("addCalendarYears：闰日 2/29 收敛到目标年 2 月最后一日、保留时刻；四年后回到 2/29", () => {
  const from = new Date("2024-02-29T08:30:00.000Z");
  assert.equal(addCalendarYears(from, 1).toISOString(), "2025-02-28T08:30:00.000Z");
  assert.equal(addCalendarYears(from, 4).toISOString(), "2028-02-29T08:30:00.000Z");
});

test("anniversaryFromAnchor：始终基于原锚点累计，不逐年漂移", () => {
  const anchor = "2024-02-29T00:00:00.000Z";
  assert.equal(anniversaryFromAnchor(anchor, 1).slice(0, 10), "2025-02-28");
  assert.equal(anniversaryFromAnchor(anchor, 4).slice(0, 10), "2028-02-29");
});

test("endFromServiceYears：普通一年按日历周年；参数非法抛错", () => {
  assert.equal(endFromServiceYears("2026-03-01T00:00:00.000Z", 1).slice(0, 10), "2027-03-01");
  assert.throws(() => endFromServiceYears("not-a-date", 1));
  assert.throws(() => endFromServiceYears("2026-03-01T00:00:00.000Z", 0));
  assert.throws(() => anniversaryFromAnchor("2026-03-01T00:00:00.000Z", -1));
});

test("exclusiveEndFromDate：只录截止日 → 服务时区次日本地零点(UTC)", () => {
  assert.equal(exclusiveEndFromDate("2026-12-31", "Asia/Shanghai"), "2026-12-31T16:00:00.000Z");
  assert.throws(() => exclusiveEndFromDate("2026-13-01", "Asia/Shanghai"));
  assert.throws(() => exclusiveEndFromDate("2026-12-31", "Not/AZone"));
});

test("isWithinTerm：半开区间 [start,end)，缺起止按待确认(false)", () => {
  const start = "2026-01-01T00:00:00.000Z";
  const end = "2027-01-01T00:00:00.000Z";
  assert.equal(isWithinTerm("2026-06-01T00:00:00.000Z", start, end), true);
  assert.equal(isWithinTerm(start, start, end), true);
  assert.equal(isWithinTerm(end, start, end), false);
  assert.equal(isWithinTerm("2026-06-01T00:00:00.000Z", null, end), false);
});

test("isValidTimeZone：识别有效/无效 IANA 时区", () => {
  assert.equal(isValidTimeZone("Asia/Shanghai"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone(""), false);
});

test("OpenAPI 契约：订阅端点齐全且带 x-requiredPermissions", () => {
  const paths = OPENAPI_DOCUMENT.paths;
  assert.ok(paths["/api/platform/subscription/view"].get, "缺租户视图");
  assert.deepEqual(paths["/api/platform/subscription/view"].get["x-requiredPermissions"], ["rental-os:subscription:view"]);
  assert.ok(paths["/api/platform/subscription/requests"].post, "缺租户申请");
  assert.ok(paths["/api/platform/subscriptions"].get, "缺平台列表");
  assert.ok(paths["/api/platform/subscriptions/feature-catalog"].get, "缺功能目录读");
  assert.ok(paths["/api/platform/subscriptions/{tenantId}/provision"].post, "缺开通");
  assert.deepEqual(paths["/api/platform/subscriptions/{tenantId}/provision"].post["x-requiredPermissions"], ["system:tenant:subscription:manage"]);
  assert.ok(paths["/api/platform/subscriptions/{tenantId}/feature-grants/revoke"].post, "缺撤销授权");
  assert.ok(paths["/api/platform/subscriptions/standard-prices/{plan}"].put, "缺设价");
  assert.ok(paths["/api/rental/v1/subscription/context"].get, "缺员工端订阅上下文读端点");
  assert.deepEqual(paths["/api/rental/v1/subscription/context"].get["x-requiredPermissions"], [], "员工上下文应无 RBAC 权限(任意已登录员工可读)");
});

test("SUB-04A isNewBusinessRoute：拦新业务(下单/报价/续租/换货)，放行善后/查询/试算/付款", () => {
  // 新业务入口 → 到期应拦（operator+staff 共用 /rental/v1；client 走 /client/v1）
  for (const p of ["/rental/v1/orders", "/rental/v1/quotes", "/client/v1/orders", "/client/v1/quotes"]) {
    assert.equal(isNewBusinessRoute("POST", p), true, `应拦 ${p}`);
  }
  assert.equal(isNewBusinessRoute("POST", "/rental/v1/orders/ord-1/extensions"), true);
  assert.equal(isNewBusinessRoute("POST", "/client/v1/orders/ord-1/extensions"), true);
  assert.equal(isNewBusinessRoute("POST", "/rental/v1/orders/ord-1/changes/post-pickup-exchange"), true);
  // 善后/查询/试算/续租付款/等价替换 → 放行（不在白名单）
  for (const p of [
    "/rental/v1/orders/ord-1/confirm",
    "/rental/v1/orders/ord-1/handover/return",
    "/rental/v1/orders/ord-1/partial-return",
    "/rental/v1/orders/ord-1/settle",
    "/rental/v1/orders/ord-1/cancel",
    "/rental/v1/orders/ord-1/substitute-bundle-component",
    "/rental/v1/orders/ord-1/changes/post-pickup-exchange/preview",
    "/rental/v1/orders/ord-1/extensions/preview",
    "/rental/v1/orders/ord-1/extensions/ext-1/pay",
    "/rental/v1/orders/ord-1/extensions/ext-1/refund-review",
    "/rental/v1/availability",
    "/client/v1/orders/ord-1/cancel"
  ]) {
    assert.equal(isNewBusinessRoute("POST", p), false, `应放行 ${p}`);
  }
  // 非 POST 一律放行（只读查询不受到期影响）
  assert.equal(isNewBusinessRoute("GET", "/rental/v1/orders"), false);
});

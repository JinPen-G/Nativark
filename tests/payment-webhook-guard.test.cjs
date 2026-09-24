const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { ApiAuthGuard } = require("../apps/api/src/common/api-auth.guard");

// 无登录态时 resolveAccessContext 返回 undefined,守卫应对受保护路由抛 401;
// 而支付回调必须在此之前匿名放行到控制器(安全边界是各平台签名校验)。
const authService = { resolveAccessContext: async () => undefined, getCategoryContext: async () => undefined };
const guard = new ApiAuthGuard(authService);
const ctx = (req) => ({ switchToHttp: () => ({ getRequest: () => req }) });
const canActivate = (url, method = "POST", headers = {}) => guard.canActivate(ctx({ url, method, headers }));

(async () => {
  for (const url of [
    "/api/payments/webhooks/stripe",
    "/api/payments/webhooks/alipay",
    "/api/payments/webhooks/wechat_pay",
    "/api/payments/webhooks/alipay/refund",
    "/api/payments/webhooks/wechat_pay/refund"
  ]) {
    assert.equal(await canActivate(url, "POST"), true, `匿名 POST 应放行到回调控制器: ${url}`);
  }

  // 只放行 POST:GET 命中同前缀也不应匿名放行(回调只收 POST)。
  await assert.rejects(() => canActivate("/api/payments/webhooks/stripe", "GET"), /请先登录/u, "非 POST 不应匿名放行");
  // 受保护业务路由无登录态必须拒绝(确认没有把匿名放行放大到其它路径)。
  await assert.rejects(() => canActivate("/api/rental/v1/orders", "GET"), /请先登录/u, "受保护路由无登录态应拒绝");

  console.log("payment webhook guard anonymous-access tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

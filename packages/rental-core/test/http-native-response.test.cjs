"use strict";
/** Real original image handlers, no server/provider or filesystem output. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ClientApiController } = require("../dist/http-client.controller.js");
const { createRentalNativeResponseBuffer, rentalNativeResponse } = require("../dist/http-native-response.js");

function response() {
  const calls = [];
  const target = {
    setHeader(name, value) { calls.push(["header", name, value]); },
    send(body) { calls.push(["body", Buffer.isBuffer(body) ? body.toString() : body]); },
    redirect(status, url) { calls.push(["redirect", status, url]); }
  };
  return { target, calls };
}

test("原图片处理器准备字节，只有宿主复验后的 flush 才发送且字节不受后续修改影响", async () => {
  const r = response(), content = Buffer.from("original image");
  const controller = new ClientApiController({}, {}, { read: async () => ({ content, mimeType: "image/png" }) });
  const buffer = createRentalNativeResponseBuffer(r.target);
  await buffer.run(() => controller.websiteAsset("tenant", "asset", r.target));
  content.fill(0);
  assert.deepEqual(r.calls, []);
  buffer.flush();
  assert.deepEqual(r.calls, [["header", "Content-Type", "image/png"],
    ["header", "Cache-Control", "public, max-age=300"], ["body", "original image"]]);
  assert.throws(() => buffer.flush(), /已发送/);
});

test("原商品图片跳转同样缓冲，撤权或断线 discard 后无响应与地址泄漏", async () => {
  const r = response();
  const controller = new ClientApiController({ readPublicCatalogItemImage: async () => ({ redirectUrl: "https://example.invalid/original" }) }, {}, {});
  const denied = createRentalNativeResponseBuffer(r.target);
  await denied.run(() => controller.publicCatalogImage("tenant", "service", "item", "image", r.target));
  denied.discard();
  assert.throws(() => denied.flush());
  assert.deepEqual(r.calls, []);
  const allowed = createRentalNativeResponseBuffer(r.target);
  await allowed.run(() => controller.publicCatalogImage("tenant", "service", "item", "image", r.target));
  assert.deepEqual(r.calls, []);
  allowed.flush();
  assert.deepEqual(r.calls, [["redirect", 302, "https://example.invalid/original"]]);
});

test("处理器失败、重复发送和未登记输出全部清空，原服务只执行一次", async () => {
  for (const failure of ["service", "duplicate", "unregistered"]) {
    const r = response(), buffer = createRentalNativeResponseBuffer(r.target);
    let calls = 0;
    await assert.rejects(buffer.run(async () => {
      calls++;
      if (failure === "unregistered") return;
      const output = rentalNativeResponse(r.target);
      output.setHeader("Content-Type", "image/png");
      if (failure === "service") throw new Error("original error");
      output.send(Buffer.from("first"));
      output.send(Buffer.from("second"));
    }));
    assert.equal(calls, 1);
    assert.deepEqual(r.calls, []);
    assert.throws(() => buffer.flush());
    await assert.rejects(buffer.run(async () => {}));
  }
});

test("透传响应只暂存原响应头，保留 CSV 返回值，不自行发送或包信封", async () => {
  const r = response(), buffer = createRentalNativeResponseBuffer(r.target);
  const csv = await buffer.run(async () => {
    const output = rentalNativeResponse(r.target);
    output.setHeader("Content-Type", "text/csv; charset=utf-8");
    return "a,b\n1,2";
  });
  assert.equal(csv, "a,b\n1,2");
  assert.deepEqual(r.calls, []);
  buffer.flush();
  assert.deepEqual(r.calls, [["header", "Content-Type", "text/csv; charset=utf-8"]]);
});

test("响应不能切换对象、嵌套或在处理器完成后继续输出", async () => {
  const r = response(), buffer = createRentalNativeResponseBuffer(r.target);
  let late;
  await buffer.run(async () => {
    assert.throws(() => rentalNativeResponse(response().target));
    await assert.rejects(createRentalNativeResponseBuffer(r.target).run(async () => {}));
    late = rentalNativeResponse(r.target);
    late.send(Buffer.from("once"));
  });
  assert.throws(() => late.setHeader("x-late", "denied"));
  buffer.discard();
  assert.deepEqual(r.calls, []);
});

test("旧宿主原响应保持同一对象与行为", () => {
  const r = response();
  assert.equal(rentalNativeResponse(r.target), r.target);
  rentalNativeResponse(r.target).send(Buffer.from("legacy"));
  assert.deepEqual(r.calls, [["body", "legacy"]]);
});

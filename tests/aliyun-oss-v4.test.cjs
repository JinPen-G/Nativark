const assert = require("node:assert/strict");
const { createAliyunOssV4Url } = require("../apps/api/dist/modules/integrations/aliyun-oss-v4.js");

const now = new Date("2024-12-03T03:44:20.000Z");
const baseInput = {
  base: "https://examplebucket.oss-cn-hangzhou.aliyuncs.com",
  bucket: "examplebucket",
  region: "cn-hangzhou",
  accessKeyId: "LTAIOSSFIXTURE123",
  accessKeySecret: "oss-v4-test-secret-not-a-real-credential",
  method: "GET",
  storageKey: "member files/avatar 01.png",
  mimeType: "image/png",
  expiresAt: new Date(now.getTime() + 3_600_000),
  now
};

const get = createAliyunOssV4Url(baseInput);
const getUrl = new URL(get.url);
assert.equal(getUrl.origin, "https://examplebucket.oss-cn-hangzhou.aliyuncs.com");
assert.equal(getUrl.pathname, "/member%20files/avatar%2001.png");
assert.equal(getUrl.searchParams.get("x-oss-signature-version"), "OSS4-HMAC-SHA256");
assert.equal(getUrl.searchParams.get("x-oss-credential"), "LTAIOSSFIXTURE123/20241203/cn-hangzhou/oss/aliyun_v4_request");
assert.equal(getUrl.searchParams.get("x-oss-date"), "20241203T034420Z");
assert.equal(getUrl.searchParams.get("x-oss-expires"), "3600");
assert.equal(getUrl.searchParams.get("x-oss-additional-headers"), "host");
assert.match(getUrl.searchParams.get("x-oss-signature"), /^[a-f0-9]{64}$/u);
assert.equal(get.url.includes(baseInput.accessKeySecret), false, "secret key must never enter URL");
assert.deepEqual(get.headers, {});

const put = createAliyunOssV4Url({ ...baseInput, method: "PUT", mimeType: "image/png; charset=utf-8" });
const putUrl = new URL(put.url);
assert.equal(putUrl.searchParams.get("x-oss-additional-headers"), "content-type;host");
assert.deepEqual(put.headers, { "Content-Type": "image/png; charset=utf-8" });
assert.notEqual(putUrl.searchParams.get("x-oss-signature"), getUrl.searchParams.get("x-oss-signature"));

assert.throws(() => createAliyunOssV4Url({ ...baseInput, expiresAt: now }), /有效期/u);
assert.throws(() => createAliyunOssV4Url({ ...baseInput, expiresAt: new Date(now.getTime() + 604_801_000) }), /有效期/u);

console.log("Aliyun OSS V4 tests passed: query signing, key derivation, signed PUT content type, bounds");

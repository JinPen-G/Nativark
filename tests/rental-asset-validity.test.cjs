const test = require("node:test");
const assert = require("node:assert/strict");
const { assetValidityError } = require("../apps/api/dist/modules/rental-core/rental-asset-validity.js");

const zone = "Asia/Shanghai";

test("vehicle insurance and inspection must cover the local rental end date inclusively", () => {
  assert.equal(assetValidityError("vehicle", { insuranceExpiry: "2026-10-01", inspectionExpiry: "2026-10-01" }, "2026-09-30T16:00:00.000Z", zone), undefined);
  assert.match(assetValidityError("vehicle", { insuranceExpiry: "2026-09-30" }, "2026-09-30T16:00:00.000Z", zone), /保险.*2026-09-30.*2026-10-01/u);
  assert.match(assetValidityError("vehicle", { inspectionExpiry: "2026-09-29" }, "2026-09-30T12:00:00.000Z", zone), /年检/u);
});

test("construction inspection expiry is checked, but vehicle-only fields are not cross-applied", () => {
  assert.match(assetValidityError("construction", { inspectionExpiry: "2026-09-29" }, "2026-09-30T12:00:00.000Z", zone), /设备检验/u);
  assert.equal(assetValidityError("camera", { insuranceExpiry: "2020-01-01", inspectionExpiry: "2020-01-01" }, "2026-09-30T12:00:00.000Z", zone), undefined);
});

test("optional missing dates remain non-blocking; malformed and impossible dates fail closed", () => {
  assert.equal(assetValidityError("vehicle", {}, "2026-09-30T12:00:00.000Z", zone), undefined);
  assert.match(assetValidityError("vehicle", { insuranceExpiry: "2026-02-31" }, "2026-09-30T12:00:00.000Z", zone), /格式无效/u);
});

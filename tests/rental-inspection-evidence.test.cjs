const test = require("node:test");
const assert = require("node:assert/strict");
const { inspectionEvidenceIds, inspectionEvidenceRequiredError } = require("../apps/api/dist/modules/rental-core/rental-inspection-evidence.js");

test("inspection evidence IDs merge attachments, photo fields and signature without duplicates", () => {
  assert.deepEqual(inspectionEvidenceIds({
    attachments: ["file-a", "file-a", " "],
    results: { front: ["file-b"], usage: 123, damaged: false },
    handoverSignatureFileAssetId: "file-c"
  }), ["file-a", "file-b", "file-c"]);
});

test("evidenceRequired blocks an empty inspection but does not change categories that disable it", () => {
  assert.match(inspectionEvidenceRequiredError(true, []), /至少附带一份现场影像凭证/u);
  assert.equal(inspectionEvidenceRequiredError(true, ["file-photo"]), undefined);
  assert.equal(inspectionEvidenceRequiredError(false, []), undefined);
});

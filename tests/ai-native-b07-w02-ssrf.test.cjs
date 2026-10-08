"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const readline = require("node:readline");
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { modelEgressUrl, publicModelAddress } = require("../apps/api/src/modules/ai-native/model-egress-policy");

async function rows() {
  const result = [];
  const input = readline.createInterface({ input: fs.createReadStream("tests/fixtures/ai-native/b07-corpus/egress-ssrf.jsonl") });
  for await (const line of input) if (line.trim()) result.push(JSON.parse(line));
  return result;
}

test("SSRF corpus is classified by the existing policy without network activity", async () => {
  const corpus = await rows();
  assert.equal(corpus.length, 7);
  for (const row of corpus) {
    assert.match(row.id, /^synthetic_/);
    assert.match(row.url, /^https:\/\//);
    if (row.expected === "blocked_private_address") assert.throws(() => modelEgressUrl(row.url), error => error.code === "CONFIG_INVALID");
    if (row.expected === "blocked_local_hostname") assert.throws(() => modelEgressUrl(row.url), error => error.code === "CONFIG_INVALID");
    if (row.expected === "redirect_not_followed") {
      assert.doesNotThrow(() => modelEgressUrl(row.url));
      assert.equal(row.redirect.startsWith("http://"), true);
    }
    if (row.expected === "runtime_revalidation_required") {
      assert.doesNotThrow(() => modelEgressUrl(row.url));
      assert.throws(() => publicModelAddress("127.0.0.1", 4), error => error.code === "CONFIG_INVALID");
    }
  }
});

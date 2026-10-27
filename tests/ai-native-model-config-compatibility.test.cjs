"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), network = require("./fixtures/ai-native/contract-consumer.cjs"); network.blockNetwork(test);
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { TenantModelConfigService: Service } = require("../apps/api/src/modules/ai-native/tenant-model-config.service"), { SecretBox } = require("../apps/api/src/common/secret-box"), f = require("./fixtures/ai-native/model-config-compatibility.cjs");
const setup = () => f.harness(Service, SecretBox), fail = (op, code) => assert.rejects(op, e => e.code === code);
test("empty tenant selects platform with no supplier fields and no ready claim", async () => {
  const x = setup(); assert.deepEqual(await x.service.selection(f.context), { mode: "platform_managed", revision: 0 });
  assert.equal((await x.service.get(f.context)).availability, "not_verified"); await x.service.changeMode(f.context, { mode: "platform_managed", expectedRevision: 0 });
  assert.deepEqual(x.rows.get(f.context.tenantId), { tenantId: f.context.tenantId, mode: "platform_managed", serviceEnabled: false, revision: 1 });
});
test("legacy complete missing mode remains BYOK without rewriting", async () => {
  const x = setup(); await x.service.save(f.context, f.settings); const row = x.rows.get(f.context.tenantId); delete row.mode;
  assert.equal((await x.service.selection(f.context)).mode, "tenant_managed"); const original = JSON.stringify(row); await x.service.get(f.context); assert.equal(JSON.stringify(row), original);
});
for (const row of [{ tenantId: "tenant-test", revision: 1 }, { tenantId: "tenant-test", revision: 1, settings: {} }, { tenantId: "tenant-test", revision: 1, mode: "invalid" }, { tenantId: "tenant-test", revision: 0, mode: "platform_managed" }]) test("broken old record never silently defaults platform", async () => {
  const x = setup(); x.rows.set(f.context.tenantId, row); await fail(() => x.service.selection(f.context), "CONFIG_INVALID");
});
test("mode switch retains BYOK, hides platform supplier and invalidates old credential reference", async () => {
  const x = setup(); await x.service.save(f.context, f.settings); const old = structuredClone(x.rows.get(f.context.tenantId)), profile = await x.service.profile(f.context);
  const summary = await x.service.changeMode(f.context, { mode: "platform_managed", expectedRevision: 1 }); assert.equal(summary.model, undefined); assert.equal(summary.baseUrl, undefined);
  assert.equal(x.rows.get(f.context.tenantId).credentialsEncrypted, old.credentialsEncrypted); assert.deepEqual(x.rows.get(f.context.tenantId).settings, old.settings);
  await fail(() => x.service.credential(profile.credentialRef, f.context), "CREDENTIAL_UNAVAILABLE"); await x.service.changeMode(f.context, { mode: "tenant_managed", expectedRevision: 2 });
  assert.equal(await x.service.credential((await x.service.profile(f.context)).credentialRef, f.context), f.settings.apiKey);
});
test("explicit clear keeps settings, disables, and explicit replacement repairs", async () => {
  const x = setup(); await x.service.save(f.context, f.settings); const { apiKey, ...rest } = f.settings;
  await x.service.save(f.context, { ...rest, expectedRevision: 1, secretChange: { operation: "clear" } });
  assert.equal(x.rows.get(f.context.tenantId).credentialsEncrypted, ""); assert.equal((await x.service.get(f.context)).keyConfigured, false); assert.equal((await x.service.get(f.context)).enabled, false);
  await x.service.save(f.context, { ...rest, expectedRevision: 2, secretChange: { operation: "replace", apiKey: "new-synthetic-key" } });
  assert.equal(await x.service.credential((await x.service.profile(f.context)).credentialRef, f.context), "new-synthetic-key");
});
test("retain cannot forward stored key to different endpoint and blank replace cannot mean keep", async () => {
  const x = setup(); await x.service.save(f.context, f.settings); const { apiKey, ...rest } = f.settings;
  await fail(() => x.service.save(f.context, { ...rest, expectedRevision: 1, baseUrl: "https://different.example.test", secretChange: { operation: "retain" } }), "CREDENTIAL_UNAVAILABLE");
  await fail(() => x.service.save(f.context, { ...rest, expectedRevision: 1, secretChange: { operation: "replace", apiKey: " " } }), "CREDENTIAL_UNAVAILABLE");
});
test("mode CAS rejects concurrency, two tenants stay isolated and wrong identity denied", async () => {
  const x = setup(); await x.service.save(f.context, f.settings);
  const results = await Promise.allSettled([x.service.changeMode(f.context, { mode: "platform_managed", expectedRevision: 1 }), x.service.changeMode(f.context, { mode: "platform_managed", expectedRevision: 1 })]); assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal((await x.service.selection({ ...f.context, tenantId: "tenant-other" })).revision, 0);
  for (const patch of [{ actorId: "client-test" }, { workspaceId: "foreign-space" }, { tenantId: "foreign-tenant" }]) await fail(() => x.service.changeMode({ ...f.context, ...patch }, { mode: "platform_managed", expectedRevision: 0 }), "FORBIDDEN");
});
test("required ports missing cannot activate config service", () => assert.throws(() => new Service({}, {}), e => e.code === "CONFIG_INVALID"));

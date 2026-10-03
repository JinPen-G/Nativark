"use strict";
const context = { tenantId: "tenant-test", workspaceId: "workspace-test", actorId: "operator-test" };
const settings = { expectedRevision: 0, enabled: true, protocol: "openai_chat_completions", baseUrl: "https://synthetic.example.test/v1", model: "synthetic/model", apiKey: "synthetic-key-not-real" };
function harness(Service, SecretBox) {
  const rows = new Map(), secrets = new SecretBox({ get: () => "synthetic-secret-box-test-only" });
  const ports = { authorize: async ctx => { if (ctx.actorId !== "operator-test" || !["tenant-test", "tenant-other"].includes(ctx.tenantId) || ctx.workspaceId !== "workspace-test") throw new Error(); }, repository: { read: async id => rows.get(id) ?? null, compareAndSwap: async (id, revision, next) => { if ((rows.get(id)?.revision ?? 0) !== revision) return false; rows.set(id, structuredClone(next)); return true; } } };
  return { rows, service: new Service(ports, secrets) };
}
module.exports = { context, settings, harness };

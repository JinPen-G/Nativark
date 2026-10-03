"use strict";
const config = require("./model-config-compatibility.cjs");
const egress = require("./model-egress.cjs");
const response = usage => JSON.stringify({ choices: [{ message: { content: "Synthetic answer" }, finish_reason: "stop" }], ...(usage ? { usage: { prompt_tokens: 3, completion_tokens: 4 } } : {}) });
async function harness(classes, options = {}) {
  const h = config.harness(classes.Config, classes.SecretBox);
  await h.service.save(config.context, config.settings);
  const peer = egress.harness({ chunks: [Buffer.from(response(options.usage !== false))], ...options.egress });
  const transport = new classes.Transport(peer.dependencies, 1000);
  const adapter = new classes.Adapter(transport);
  const events = [], scopes = [], ledger = new Map(); let authorized = true, index = 0;
  const ports = {
    authorize: async scope => { scopes.push(structuredClone(scope)); if (!authorized || scope.actorId !== config.context.actorId) throw new Error("Synthetic denied"); },
    profile: scope => h.service.profile(scope), credential: (ref, scope) => h.service.credential(ref, scope),
    budget: {
      reserve: async (scope, input) => {
        if (options.noBudget) throw new Error("Synthetic no budget");
        const id = "reservation-" + ++index; ledger.set(id, { tenantId: scope.tenantId, input, status: "reserved" }); events.push(["reserve", id]);
        if (options.onReserve) await options.onReserve({ ...h, revoke: () => { authorized = false; } });
        return id;
      },
      settle: async (id, usage) => { ledger.get(id).status = "settled"; events.push(["settle", id, usage]); if (options.settleFailure) throw new Error("Synthetic accounting failure"); },
      release: async id => { ledger.get(id).status = "released"; events.push(["release", id]); },
      reconcile: async (id, reason) => { ledger.get(id).status = "reconcile"; events.push(["reconcile", id, reason]); }
    }
  };
  const gateway = new classes.Gateway(ports, [adapter]);
  const request = { callId: "synthetic-call", model: config.settings.model, messages: [{ role: "user", content: "Synthetic question" }], maxOutputTokens: 32 };
  return { ...h, peer, ports, ledger, events, scopes, gateway, request, context: config.context, settings: config.settings };
}
module.exports = { harness, response };

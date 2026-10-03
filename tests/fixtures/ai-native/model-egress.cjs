"use strict";
const { EventEmitter } = require("node:events");
function harness(overrides = {}) {
  const state = { now: 0, options: [], dns: [], requests: [], responses: [], timers: new Map(), timerId: 0 };
  const dependencies = {
    now: () => state.now,
    setTimer: (callback, delay) => { const id = ++state.timerId; state.timers.set(id, { callback, delay }); return id; },
    clearTimer: id => state.timers.delete(id),
    resolve: async host => { state.dns.push(host); return overrides.addresses ?? [{ address: "8.8.8.8", family: 4 }]; },
    request: (options, onResponse) => {
      state.options.push(options); const request = new EventEmitter(); state.requests.push(request);
      request.destroy = () => { request.destroyed = true; };
      request.end = body => { request.body = body; if (overrides.hold) return;
        queueMicrotask(() => {
          const response = new EventEmitter(); state.responses.push(response);
          response.statusCode = overrides.status ?? 200; response.headers = overrides.headers ?? {}; response.rawHeaders = overrides.rawHeaders ?? [];
          response.destroy = () => { response.destroyed = true; }; onResponse(response);
          for (const chunk of overrides.chunks ?? [Buffer.from('{"ok":true}')]) if (!response.destroyed) response.emit("data", chunk);
          if (!response.destroyed && !overrides.noEnd) response.emit("end");
        });
      };
      return request;
    }
  };
  return { state, dependencies: { ...dependencies, ...overrides.dependencies }, input: { url: "https://synthetic.example.test/v1/chat/completions", headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" }, body: "{}", signal: new AbortController().signal, maxResponseBytes: 1048576, redirects: "error" } };
}
module.exports = { harness };

"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), h = require("./fixtures/ai-native/contract-consumer.cjs"); h.blockNetwork(test);
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { ModelEgressTransport } = require("../apps/api/src/modules/ai-native/model-egress.transport"), { publicModelAddress } = require("../apps/api/src/modules/ai-native/model-egress-policy"), { harness } = require("./fixtures/ai-native/model-egress.cjs");
const fail = (operation, code) => assert.rejects(operation, error => error.code === code);
const tick = () => new Promise(resolve => setImmediate(resolve));
test("S04 real request construction pins address while retaining Host/SNI/certificate validation", async () => {
  const x = harness(), service = new ModelEgressTransport(x.dependencies);
  assert.deepEqual(await service.post(x.input), { status: 200, body: '{"ok":true}' });
  const options = x.state.options[0]; assert.equal(options.hostname, "synthetic.example.test"); assert.equal(options.servername, options.hostname);
  assert.equal(options.rejectUnauthorized, true); assert.equal(options.agent, false); assert.equal(options.headers.Host, undefined);
  let address; // Call during request construction in next test; after completion lookup correctly refuses reuse.
  options.lookup(options.hostname, {}, (error, ip) => { assert.ok(error); address = ip; }); assert.equal(address, "");
  assert.equal(x.state.dns.length, 1); assert.equal(x.state.timers.size, 0);
});
test("S04 lookup cannot re-resolve or accept another hostname", async () => {
  const x = harness({ hold: true }), controller = new AbortController(), pending = new ModelEgressTransport(x.dependencies).post({ ...x.input, signal: controller.signal });
  const rejected = fail(() => pending, "CANCELLED"); await tick(); const options = x.state.options[0];
  options.lookup(options.hostname, {}, (error, address, family) => { assert.equal(error, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4); });
  options.lookup(options.hostname, { all: true }, (error, addresses) => { assert.equal(error, null); assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]); });
  options.lookup("evil.test", {}, error => assert.ok(error)); controller.abort(); await rejected;
  assert.equal(x.state.requests[0].destroyed, true); assert.equal(x.state.timers.size, 0);
});
for (const address of ["127.0.0.1", "10.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "198.18.0.1", "0.0.0.0", "224.0.0.1", "192.0.2.1", "::1", "::ffff:127.0.0.1", "0:0:0:0:0:ffff:7f00:1", "fe80::1", "fc00::1", "64:ff9b::a00:1", "2001:db8::1"]) test(`S04 refuses restricted normalized DNS address ${address}`, async () => {
  const x = harness({ addresses: [{ address, family: address.includes(":") ? 6 : 4 }] });
  await fail(() => new ModelEgressTransport(x.dependencies).post(x.input), "CONFIG_INVALID"); assert.equal(x.state.requests.length, 0); assert.equal(x.state.timers.size, 0);
});
for (const addresses of [[], [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 6 }], [{ address: "bad", family: 4 }], [{ address: "8.8.8.8", family: NaN }], [null]]) test("S04 rejects empty/mixed/invalid DNS before dispatch", async () => {
  const x = harness({ addresses }); await fail(() => new ModelEgressTransport(x.dependencies).post(x.input), "CONFIG_INVALID"); assert.equal(x.state.requests.length, 0);
});
for (const url of ["http://example.test", "https://user:key@example.test", "https://example.test?key=x", "https://example.test#x", "https://127.1", "https://0x7f000001", "https://[::1]", "https://metadata.google.internal", "https://localhost"]) test(`S04 unsafe URL ${url}`, async () => {
  const x = harness(); await fail(() => new ModelEgressTransport(x.dependencies).post({ ...x.input, url }), "CONFIG_INVALID"); assert.equal(x.state.dns.length, 0);
});
test("S04 allowed public IPv6 normalizes, does not allow scoped or mapped address", () => {
  assert.deepEqual(publicModelAddress("2606:4700:0:0:0:0:0:1111", 6), { address: "2606:4700::1111", family: 6 });
  assert.throws(() => publicModelAddress("fe80::1%eth0", 6));
});
test("S04 timer covers stalled DNS and late resolver never dispatches", async () => {
  let resolve; const x = harness({ dependencies: { resolve: () => new Promise(r => { resolve = r; }) } }), pending = new ModelEgressTransport(x.dependencies, 10).post(x.input);
  const rejected = fail(() => pending, "TIMEOUT"); await tick(); [...x.state.timers.values()][0].callback(); await rejected;
  resolve([{ address: "8.8.8.8", family: 4 }]); await tick(); assert.equal(x.state.requests.length, 0);
});
test("S04 stalled headers deadline destroys request, no retry", async () => {
  const x = harness({ hold: true }), pending = new ModelEgressTransport(x.dependencies).post(x.input), rejected = fail(() => pending, "TIMEOUT");
  await tick(); [...x.state.timers.values()][0].callback(); await rejected; assert.equal(x.state.requests[0].destroyed, true); assert.equal(x.state.options.length, 1);
});
test("S04 redirects cannot forward authorization", async () => {
  const x = harness({ status: 302 }); await fail(() => new ModelEgressTransport(x.dependencies).post(x.input), "INVALID_RESPONSE"); assert.equal(x.state.options.length, 1); assert.equal(x.state.responses[0].destroyed, true);
});
test("S04 fragmented response limit stops before end and before decoding", async () => {
  const x = harness({ chunks: [Buffer.alloc(4), Buffer.alloc(5)], noEnd: true });
  await fail(() => new ModelEgressTransport(x.dependencies).post({ ...x.input, maxResponseBytes: 8 }), "INVALID_RESPONSE"); assert.equal(x.state.responses[0].destroyed, true);
});
test("S04 UTF8 across chunks valid, malformed rejected", async () => {
  const bytes = Buffer.from("你好"), x = harness({ chunks: [bytes.subarray(0, 2), bytes.subarray(2)] }); assert.equal((await new ModelEgressTransport(x.dependencies).post(x.input)).body, "你好");
  const y = harness({ chunks: [Buffer.from([0xff])] }); await fail(() => new ModelEgressTransport(y.dependencies).post(y.input), "INVALID_RESPONSE");
});
test("S04 headers/request limits and caller Host/proxy/TLS overrides cannot enter request", async () => {
  for (const patch of [{ headers: { Authorization: "Bearer key\r\nHost: evil", "Content-Type": "application/json" } }, { headers: { ...harness().input.headers, Host: "evil.test" } }, { body: "x".repeat(1048577) }, { maxResponseBytes: Infinity }, { redirects: "follow" }]) {
    const x = harness(); await fail(() => new ModelEgressTransport(x.dependencies).post({ ...x.input, ...patch }), "CONFIG_INVALID"); assert.equal(x.state.requests.length, 0);
  }
});
test("S04 DNS error, nonfinite clock, response header overflow and gzip fail closed", async () => {
  const dns = harness({ dependencies: { resolve: async () => { throw new Error("raw vendor credential"); } } });
  await fail(() => new ModelEgressTransport(dns.dependencies).post(dns.input), "CONFIG_INVALID");
  const clock = harness({ dependencies: { now: () => NaN } }); await fail(() => new ModelEgressTransport(clock.dependencies).post(clock.input), "CONFIG_INVALID");
  for (const override of [{ headers: { "content-encoding": "gzip" } }, { rawHeaders: ["x", "a".repeat(16384)] }]) {
    const x = harness(override); await fail(() => new ModelEgressTransport(x.dependencies).post(x.input), "INVALID_RESPONSE");
  }
});
test("S04 body stall cancellation cleans both resources and deadline", async () => {
  const x = harness({ noEnd: true }), controller = new AbortController(), pending = new ModelEgressTransport(x.dependencies).post({ ...x.input, signal: controller.signal });
  const rejected = fail(() => pending, "CANCELLED"); await tick(); controller.abort(); await rejected;
  assert.equal(x.state.responses[0].destroyed, true); assert.equal(x.state.requests[0].destroyed, true); assert.equal(x.state.timers.size, 0);
});

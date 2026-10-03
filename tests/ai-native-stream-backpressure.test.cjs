'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { blockNetwork, compileConsumer } = require('./fixtures/ai-native/contract-consumer.cjs'); blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { ModelEgressTransport } = require('../apps/api/src/modules/ai-native/model-egress.transport');
const { harness } = require('./fixtures/ai-native/model-egress.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function flow(count = 320, noEnd = false) {
  const f = harness(), state = { sent: 0, pauses: 0, resumes: 0, paused: false, afterDestroy: 0 };
  f.dependencies.request = (options, receive) => {
    f.state.options.push(options); const req = new EventEmitter(); f.state.requests.push(req);
    req.destroy = () => { req.destroyed = true; };
    req.end = () => queueMicrotask(() => {
      const res = new EventEmitter(); f.state.responses.push(res);
      res.statusCode = 200; res.rawHeaders = []; res.headers = {};
      res.destroy = () => { res.destroyed = true; };
      function pump() {
        while (!state.paused && !res.destroyed && state.sent < count) { state.sent++; res.emit('data', Buffer.from('x'.repeat(1024))); }
        if (!state.paused && !res.destroyed && state.sent === count && !noEnd) res.emit('end');
      }
      res.pause = () => { state.paused = true; state.pauses++; return res; };
      res.resume = () => { if (res.destroyed) state.afterDestroy++; state.paused = false; state.resumes++; queueMicrotask(pump); return res; };
      receive(res); pump();
    }); return req;
  };
  const controller = new AbortController(); f.input.signal = controller.signal;
  return { ...f, flow: state, controller, iterator: new ModelEgressTransport(f.dependencies, 1000).postStream(f.input)[Symbol.asyncIterator]() };
}
test('slow consumer pauses actual transport response, resumes below low water and loses no chunks', async () => {
  const f = flow(); assert.equal((await f.iterator.next()).value.kind, 'headers'); await tick();
  assert.ok(f.flow.pauses > 0); assert.ok(f.flow.sent <= 33); assert.equal(f.flow.paused, true);
  let count = 0; for (;;) { const event = await f.iterator.next(); if (event.done) break; assert.equal(event.value.bytes.length, 1024); count++; }
  assert.equal(count, 320); assert.ok(f.flow.resumes > 0); assert.equal(f.flow.afterDestroy, 0); assert.equal(f.state.timers.size, 0);
});
test('consumer return while paused destroys response and request without resuming or leaking timer', async () => {
  const f = flow(); await f.iterator.next(); await tick(); await f.iterator.return();
  assert.equal(f.state.responses[0].destroyed, true); assert.equal(f.state.requests[0].destroyed, true); assert.equal(f.state.timers.size, 0); assert.equal(f.flow.afterDestroy, 0);
});
test('cancel while response is backpressured discards queued bytes and terminates', async () => {
  const f = flow(); await f.iterator.next(); await tick(); f.controller.abort();
  await assert.rejects(f.iterator.next(), e => e.code === 'CANCELLED'); assert.equal(f.state.timers.size, 0); assert.equal(f.flow.afterDestroy, 0);
});
test('paused response still consumes ORIGINAL total timeout, not an idle-reset timeout', async () => {
  const f = flow(); await f.iterator.next(); await tick(); f.state.now = 1000;
  [...f.state.timers.values()][0].callback(); await assert.rejects(f.iterator.next(), e => e.code === 'TIMEOUT');
  assert.equal(f.state.responses[0].destroyed, true); assert.equal(f.state.timers.size, 0);
});
test('pause/resume does not release an incomplete stream as a successful response', async () => {
  const f = flow(40, true); await f.iterator.next();
  for (let i = 0; i < 40; i++) assert.equal((await f.iterator.next()).value.kind, 'chunk');
  const pending = f.iterator.next(); await tick(); f.controller.abort();
  await assert.rejects(pending, e => e.code === 'CANCELLED'); assert.equal(f.state.timers.size, 0);
});
test('backpressure transport compiles under real strict noEmit', () => {
  assert.deepEqual(compileConsumer('import { ModelEgressTransport } from "../apps/api/src/modules/ai-native/model-egress.transport";'), []);
});

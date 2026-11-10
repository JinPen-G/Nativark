'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const base = require('./fixtures/ai-native/contract-consumer.cjs'); base.blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true } });
require('./fixtures/ai-native/local-shared.cjs');
const { PublicAiGatewayService, PublicAiGatewayModule } = require('../apps/api/src/modules/ai-native/public-ai-gateway.service');
const { ModelGatewayError } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
const { isGatewayResult, isGatewayEvent } = require('../apps/api/src/modules/ai-native/gateway-contract-validation');
const intent = () => ({ draftVersion: 'ain-c03-draft-2', requestId: 'request-1', sceneCode: 'order.explain', messages: [{ role: 'user', content: [{ kind: 'text', text: 'explain' }] }], requiredFeatures: ['text'], optionalFeatures: [], maxOutputTokens: 10 });
const scenes = [{ sceneCode: 'order.explain', routeScene: 'chat', maxOutputTokens: 100 }];
test('public media rechecks current attachment after reservation before dispatch', async () => {
  const {createHash}=require('node:crypto');
  const {AuthorizedGatewayMediaAttachmentResolver}=require('../apps/api/src/modules/ai-native/gateway-media-attachment.resolver');
  for(const revoked of [false,true]) {
    const f=setup(),bytes=Buffer.from('bounded-synthetic-image'),hash=createHash('sha256').update(bytes).digest('hex');
    let active=true,checks=0;
    f.ports.media=new AuthorizedGatewayMediaAttachmentResolver({authorize:async(_context,ref)=>{
      checks++;return active?{...ref,mediaType:'image/png',sizeBytes:bytes.length,contentHash:hash,readBinding:{}}:null;
    }},{read:async()=>bytes});
    const reserve=f.ports.budget.reserve;
    f.ports.budget.reserve=async(...args)=>{const result=await reserve(...args);if(revoked)active=false;return result;};
    const service=new PublicAiGatewayService({...f.runtime,ports:f.ports},scenes);
    const input=intent();input.requiredFeatures.push('image');input.messages[0].content.push({kind:'image',attachmentId:'file-a',attachmentRevision:1});
    const result=await service.invoke(f.context,input);
    assert.equal(result.status,revoked?'failed':'completed');
    assert.equal(f.events.includes('transport'),!revoked);assert.ok(checks>=3);
  }
});
function setup(mode = 'platform_managed', timeout = 10000) {
  const context = structuredClone(base.contexts[0]), events = [];
  const scope = { id: 'consumer', kind: 'WORKSPACE', tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId };
  const owner = mode === 'platform_managed' ? { id: 'owner-platform', kind: 'PLATFORM' } : { id: 'owner-tenant', kind: 'TENANT', tenantId: context.scope.tenantId };
  const state = { active: true, verified: true, context, result: { text: 'done', usage: { inputTokens: 1, outputTokens: 2 } }, fail: null };
  const profile = { id: 'profile-1', configRevision: 1, credentialRef: 'vault:reference', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model', serviceMode: mode, scopeId: owner.id, scopeKind: owner.kind };
  const ports = require('./fixtures/ai-native/unified-dispatch.cjs')({
    routing: { resolve: async (_ctx, required) => ({ context: structuredClone(state.context), consumerScope: scope, route: { profile, scope: owner, role: 'DEFAULT', preflight: { allowed: true, required, missing: [], stale: [] } }, selection: { mode, revision: 1 }, scene: 'chat', requiredCapabilities: required }),
      assertCurrent: async () => { if (!state.active) throw new ModelGatewayError('FORBIDDEN'); } },
    admission: { admit: async input => { events.push('admit'); return { id: 'admission-1', ...input }; }, transition: async (_s,_c,_from,to) => { events.push(to); } },
    usage: { reserve: async () => { events.push('reserve'); return { id: 'usage-1' }; }, settle: async () => { events.push('settle'); }, markUnknown: async () => { events.push('unknown-usage'); } },
    audit: { append: async () => {} }, transport: {
      invoke: async () => { events.push('transport'); if (state.fail) throw state.fail; return state.result; },
      stream: async function* () { events.push('transport'); yield { kind: 'text_delta', delta: 'part' }; if (state.fail) throw state.fail; yield { kind: 'result', result: state.result }; }
    }
  });
  const runtime = { ports, evidence: 'mock', verifyEvidence: async () => state.verified };
  return { state, ports, runtime, events, context, service: new PublicAiGatewayService(runtime, scenes, timeout) };
}
test('core native successor consumes the original Task result through one guarded Gateway invocation', async () => {
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { nativeToolResultIntentFingerprint } = require('../apps/api/src/modules/ai-native/model-input/native-tool-result.ports');
  // Protocol/evidence dependencies are explicit fixtures. The real public and
  // unified Gateway must own routing/admission/dispatch/recording throughout.
  for (const mode of ['normal', 'missing_transport', 'missing_resolver', 'changed_before_dispatch', 'changed_after_dispatch', 'configuration_changed', 'extra_text', 'native_unknown']) {
    const f = setup('tenant_managed'), calls = { ordinary: 0, native: 0, resolved: 0 }, receipts = [], reservations = [];
    const scene = { ...scenes[0], orderExplainTool: true, nativeToolResults: true };
    const firstIntent = intent(); firstIntent.requiredFeatures = ['text', 'tools'];
    const ordinary = f.ports.transport.invoke;
    f.ports.transport.invoke = async (...args) => { calls.ordinary++; return ordinary(...args); };
    f.ports.budget.recordUsage = async (call, _id, usage) => { receipts.push({ callId: call.request.callId, usage }); };
    const reserve = f.ports.budget.reserve;
    let changed = false;
    f.ports.budget.reserve = async call => { reservations.push(structuredClone(call)); const result = await reserve(call);
      if (call.request.callId === 'native-answer' && mode === 'changed_before_dispatch') changed = true;
      return result;
    };
    const reference = { referenceVersion: 'ain-tool-result-reference-1', taskId: 'original-task', runId: 'original-run',
      modelRegistrationRef: 'original-model', toolRegistrationRef: 'original-read', callIndex: 0 };
    let source;
    f.ports.nativeToolResults = { resolve: async (_context, requested) => {
      calls.resolved++; assert.deepEqual(requested, reference); return structuredClone(source);
    }, assertCurrent: async (_context, value) => {
      assert.deepEqual(value.reference, reference);
      if (changed) throw new ModelGatewayError('FORBIDDEN');
    } };
    f.ports.transport.nativeInputBoundHash = () => 'b'.repeat(64);
    f.ports.transport.inputBoundHash = request => { assert.notEqual(request.callId, 'native-answer', 'Native counting must not use a text-only fallback'); return undefined; };
    f.ports.transport.invokeNativeToolResult = async (_context, request, _route, signal, value, recordUsage, inputHash) => {
      calls.native++; assert.equal(signal.aborted, false); assert.equal(request.callId, 'native-answer');
      assert.equal(inputHash, 'b'.repeat(64)); assert.deepEqual(value, source); assert.equal(value.call.id, 'original_native_call');
      assert.equal(request.messages[0].content, 'explain');
      await recordUsage({ inputTokens: 2, outputTokens: 3 });
      if (mode === 'changed_after_dispatch') changed = true;
      if (mode === 'native_unknown') throw new ModelGatewayError('ACCOUNTING_PENDING');
      return { text: 'native answer', usage: { inputTokens: 2, outputTokens: 3 }, toolRequests: [] };
    };
    const service = new PublicAiGatewayService(f.runtime, [scene]);
    const first = await service.invoke(f.context, firstIntent); assert.equal(first.status, 'completed');
    source = { version: 'native-tool-result-1', reference, originalIntent: firstIntent, sourceInvocationId: 'original-invocation',
      sourceConfigurationHash: mode === 'configuration_changed' ? 'f'.repeat(64) : requestFingerprint(first.actual),
      modelResultId: 'original-model-result', modelResultHash: '1'.repeat(64), toolResultId: 'original-core-result', toolResultHash: '2'.repeat(64),
      bindingHash: '3'.repeat(64), call: { id: 'original_native_call', type: 'function', function: {
        name: 'rental_order_explain', arguments: '{"orderId":"original-order"}' } },
      resultJson: '{"orderId":"original-order","status":"original-Core-fact"}', evidenceHash: '4'.repeat(64) };
    if (mode === 'missing_transport') delete f.ports.transport.invokeNativeToolResult;
    if (mode === 'missing_resolver') delete f.ports.nativeToolResults;
    const currentService = new PublicAiGatewayService(f.runtime, [scene]);
    const successor = { ...intent(), requestId: 'native-answer', requiredFeatures: ['text', 'tools'],
      messages: [{ role: 'user', content: [{ kind: 'tool_result_reference', reference }] }] };
    if (mode === 'extra_text') successor.messages.push({ role: 'user', content: [{ kind: 'text', text: 'unbound extra history' }] });
    if (['missing_transport', 'missing_resolver', 'extra_text'].includes(mode)) {
      await assert.rejects(currentService.invoke(f.context, successor), e => ['CAPABILITY_UNSUPPORTED', 'INVALID_REQUEST'].includes(e.code));
      assert.equal(reservations.length, 1); assert.equal(calls.native, 0);
    } else {
      const result = await currentService.invoke(f.context, successor); assert.equal(isGatewayResult(result), true);
      assert.equal(result.status, mode === 'normal' ? 'completed' : ['changed_after_dispatch', 'native_unknown'].includes(mode) ? 'unknown' : 'failed');
      if (mode === 'normal') {
        assert.equal(result.text, 'native answer'); assert.equal(calls.native, 1);
        assert.equal(reservations[1].request.intentHash, nativeToolResultIntentFingerprint(successor, scene));
        assert.equal(reservations[1].request.countRequestHash, 'b'.repeat(64));
        assert.equal(receipts.filter(x => x.callId === 'native-answer').length, 1, 'The same original usage callback stays single-ledger deduplicated');
      }
      if (mode === 'configuration_changed') assert.equal(reservations.length, 1);
      if (mode === 'changed_before_dispatch') assert.equal(calls.native, 0);
      if (['changed_after_dispatch', 'native_unknown'].includes(mode)) {
        assert.equal(result.error.retryable, false); assert.equal(calls.native, 1);
        assert.equal(receipts.filter(x => x.callId === 'native-answer').length, 1);
      }
      assert.equal(JSON.stringify(result).includes('original_native_call'), false);
      assert.equal(JSON.stringify(result).includes('original-Core-fact'), false);
    }
    assert.equal(calls.ordinary, 1, 'Only the original model uses ordinary invoke; native successor must never fall back to replaying it');
  }
});

for (const mode of ['platform_managed', 'tenant_managed']) test(`${mode}: public invoke returns schema-valid actual routing, not model-selected metadata`, async () => {
  const f = setup(mode), result = await f.service.invoke(f.context, intent());
  assert.equal(isGatewayResult(result), true); assert.equal(result.status, 'completed'); assert.equal(result.evidence, 'mock');
  assert.equal(result.actual.configId, 'profile-1'); assert.equal(result.actual.serviceMode, mode);
  assert.equal(result.actual.configurationScope.kind, mode === 'platform_managed' ? 'platform' : 'tenant');
  assert.equal(result.requestId, 'request-1'); assert.deepEqual(result.usage, { kind: 'reported', inputTokens: 1, outputTokens: 2 });
});
test('client audience uses the same guarded Gateway and budget lifecycle', async () => {
  const f = setup(); f.context.audience = 'client'; f.context.actor = { kind: 'customer', customerId: 'customer-1' }; delete f.context.access;
  const result = await f.service.invoke(f.context, intent());
  assert.equal(result.status, 'completed');
  assert.equal(result.actual.configurationScope.kind, 'platform');
  assert.ok(f.events.includes('reserve')); assert.ok(f.events.includes('settle'));
});
test('public stream emits started, delta and terminal with positive consecutive sequences', async () => {
  const f = setup(), out = []; for await (const event of f.service.stream(f.context, intent())) { assert.equal(isGatewayEvent(event), true); out.push(event); }
  assert.deepEqual(out.map(event => event.kind), ['started', 'text_delta', 'terminal']); assert.deepEqual(out.map(event => event.sequence), [1,2,3]);
  assert.equal(out[2].result.status, 'completed'); assert.ok(f.events.includes('settle'));
});
for (const mode of ['invoke', 'stream']) test(`${mode}: dispatched failure has retryable false and mandatory reconciliation`, async () => {
  const f = setup(); f.state.fail = Error('private credential dump must not leak');
  let result;
  if (mode === 'invoke') result = await f.service.invoke(f.context, intent());
  else { const out = []; for await (const event of f.service.stream(f.context, intent())) out.push(event); result = out.at(-1).result; }
  assert.equal(isGatewayResult(result), true); assert.equal(result.status, 'unknown'); assert.equal(result.error.retryable, false);
  assert.equal(result.error.nextAction, 'reconcile'); assert.equal(JSON.stringify(result).includes('credential dump'), false);
});
test('undispatched budget refusal is failed rather than a fabricated success', async () => {
  const f = setup(); f.ports.usage.reserve = async () => { throw new ModelGatewayError('BUDGET_UNAVAILABLE'); };
  const result = await f.service.invoke(f.context, intent()); assert.equal(result.status, 'failed'); assert.equal(isGatewayResult(result), true);
  assert.equal(f.events.includes('transport'), false);
});
for (const changed of [c => { c.actor.userId = 'other'; }, c => { c.scope.workspaceId = 'other'; }, c => { c.scope.tenantId = 'other'; }, c => { c.audience = 'staff'; }]) test('caller context cannot replace the authority-resolved identity', async () => {
  const f = setup(), forged = structuredClone(f.context); changed(forged);
  await assert.rejects(f.service.invoke(forged, intent()), e => e.code === 'FORBIDDEN'); assert.deepEqual(f.events, []);
});
for (const context of [base.contexts[2], base.contexts[3], base.contexts[4]]) test('non-workspace user context is refused without inventing a tenant', async () => {
  const f = setup(); await assert.rejects(f.service.invoke(context, intent()), e => e.code === 'FORBIDDEN'); assert.deepEqual(f.events, []);
});
for (const verified of [false, 'true', 1]) test('a metadata mode label is not a substitute for verified evidence', async () => {
  const f = setup(); f.state.verified = verified;
  await assert.rejects(f.service.invoke(f.context, intent()), e => e.code === 'CONFIG_INVALID'); assert.deepEqual(f.events, []);
});
test('revocation between started and delta suppresses all later public output', async () => {
  const f = setup(), stream = f.service.stream(f.context, intent()); assert.equal((await stream.next()).value.kind, 'started');
  f.state.active = false; await assert.rejects(stream.next(), e => e.code === 'FORBIDDEN'); assert.equal(f.events.includes('completed'), false);
});
test('missing usage is returned as unknown usage, never invented as zero', async () => {
  const f = setup(); f.state.result = { text: 'done' }; const result = await f.service.invoke(f.context, intent());
  assert.equal(result.status, 'completed'); assert.deepEqual(result.usage, { kind: 'unknown', reason: 'not_returned', nextAction: 'reconcile' });
});
test('public schema bounds are enforced before any admission', async () => {
  const f = setup(), value = intent(); value.messages[0].content = Array.from({ length: 17 }, () => ({ kind: 'text', text: 'x' }));
  await assert.rejects(f.service.invoke(f.context, value), e => e.code === 'INVALID_REQUEST'); assert.deepEqual(f.events, []);
});
test('concurrent public invocations retain separate request/result envelopes', async () => {
  const f = setup(); let release, entered;
  const ready = new Promise(r => { entered = r; });
  f.ports.transport.invoke = async (_context, request) => {
    if (request.callId === 'request-1') await new Promise(r => { release = r; entered(); });
    return { text: request.callId, usage: { inputTokens: 1, outputTokens: 2 } };
  };
  const first = f.service.invoke(f.context, intent()); await ready;
  const second = await f.service.invoke(f.context, { ...intent(), requestId: 'request-2' }); release();
  const one = await first; assert.equal(one.requestId, 'request-1'); assert.equal(one.text, 'request-1');
  assert.equal(second.requestId, 'request-2'); assert.equal(second.text, 'request-2');
});
test('consumer return after started closes the owned invocation without a false terminal', async () => {
  const f = setup(), stream = f.service.stream(f.context, intent());
  assert.equal((await stream.next()).value.kind, 'started'); await stream.return();
  assert.ok(f.events.includes('unknown')); assert.equal(f.events.includes('completed'), false);
});
test('live label without a verifier cannot construct a production gateway', () => {
  const f = setup(); assert.throws(() => new PublicAiGatewayService({ ports: f.ports, evidence: 'live' }, scenes), e => e.code === 'CONFIG_INVALID');
});
test('uncooperative evidence verification obeys the overall deadline before any reserve', async () => {
  const f = setup(), gateway = new PublicAiGatewayService({ ...f.runtime, verifyEvidence: () => new Promise(() => {}) }, scenes, 30);
  await assert.rejects(gateway.invoke(f.context, intent()), e => e.code === 'TIMEOUT'); assert.deepEqual(f.events, []);
});
test('oversize public stream delta produces only a valid unknown terminal, not an invalid event', async () => {
  const f = setup(); f.ports.transport.stream = async function* () { yield { kind: 'text_delta', delta: 'x'.repeat(16001) }; };
  const out = []; for await (const event of f.service.stream(f.context, intent())) { assert.equal(isGatewayEvent(event), true); out.push(event); }
  assert.deepEqual(out.map(event => event.kind), ['started', 'terminal']); assert.equal(out[1].result.status, 'unknown');
});
test('a malformed actual config is rejected before admission rather than repaired with placeholders', async () => {
  const f = setup(), resolve = f.ports.routing.resolve;
  f.ports.routing.resolve = async (...args) => { const result = await resolve(...args); result.route.profile.credentialRef = 'invalid secret ref spaces'; return result; };
  await assert.rejects(f.service.invoke(f.context, intent()), e => e.code === 'CONFIG_INVALID'); assert.deepEqual(f.events, []);
});

test('unknown scenes and missing wiring do not activate a gateway', async () => {
  const f = setup(); await assert.rejects(f.service.invoke(f.context, { ...intent(), sceneCode: 'unknown' }), e => e.code === 'CAPABILITY_UNSUPPORTED');
  assert.throws(() => new PublicAiGatewayService({ ...f.runtime, verifyEvidence: undefined }, scenes));
  assert.throws(() => PublicAiGatewayModule.register({ ...f.runtime, ports: {} }, scenes));
  assert.equal(PublicAiGatewayModule.register(f.runtime, scenes).exports[0], PublicAiGatewayService);
});

async function runPublic(f, mode, signal, value = intent()) {
  if (mode === 'invoke') return f.service.invoke(f.context, value, signal);
  const out = [];
  for await (const event of f.service.stream(f.context, value, signal)) { assert.equal(isGatewayEvent(event), true); out.push(event); }
  return out.at(-1)?.result;
}
for (const serviceMode of ['platform_managed', 'tenant_managed']) for (const mode of ['invoke', 'stream']) {
  test(`${serviceMode}/${mode}: already cancelled owner cannot admit or reserve`, async () => {
    const f = setup(serviceMode), controller = new AbortController(); controller.abort(Error('private cancellation reason'));
    await assert.rejects(runPublic(f, mode, controller.signal), error => error.code === 'CANCELLED' && !error.message.includes('private'));
    assert.deepEqual(f.events, []);
  });
  test(`${serviceMode}/${mode}: owner cancellation reaches the dispatched transport and retains unknown`, async () => {
    const f = setup(serviceMode), controller = new AbortController(); let abortedAtDispatch = false;
    const cancel = signal => {
      f.events.push('transport'); controller.abort(Error('private cancellation reason')); abortedAtDispatch = signal.aborted;
    };
    f.ports.transport.invoke = async (_context, _request, _route, signal) => { cancel(signal); return f.state.result; };
    f.ports.transport.stream = async function* (_context, _request, _route, signal) {
      cancel(signal); yield { kind: 'text_delta', delta: 'late text' }; yield { kind: 'result', result: f.state.result };
    };
    const result = await runPublic(f, mode, controller.signal);
    assert.equal(abortedAtDispatch, true);
    assert.equal(result.status, 'unknown'); assert.equal(result.error.retryable, false); assert.equal(result.error.nextAction, 'reconcile');
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(f.events.filter(event => event === 'reserve').length, 1);
    assert.equal(f.events.filter(event => event === 'transport').length, 1);
    assert.ok(f.events.includes('unknown-usage')); assert.ok(f.events.includes('unknown'));
    assert.equal(f.events.includes('settle'), false); assert.equal(f.events.includes('completed'), false);
    assert.equal(require('node:events').getEventListeners(controller.signal, 'abort').length, 0);
  });
}
for (const mode of ['invoke', 'stream']) {
  test(`${mode}: cancellation during reserve never dispatches the transport`, async () => {
    const f = setup(), controller = new AbortController(), reserve = f.ports.budget.reserve;
    f.ports.budget.reserve = async call => { const result = await reserve(call); controller.abort(); return result; };
    const result = await runPublic(f, mode, controller.signal);
    assert.equal(result.status, 'failed'); assert.equal(result.error.code, 'cancelled');
    assert.equal(f.events.includes('transport'), false); assert.equal(f.events.includes('settle'), false);
    assert.ok(f.events.includes('unknown-usage')); assert.ok(f.events.includes('cancelled'));
  });
  test(`${mode}: cancellation after revocation cannot disclose a result envelope`, async () => {
    const f = setup(), controller = new AbortController();
    const revoke = () => { f.state.active = false; controller.abort(); };
    f.ports.transport.invoke = async () => { revoke(); return f.state.result; };
    f.ports.transport.stream = async function* () { revoke(); yield { kind: 'result', result: f.state.result }; };
    await assert.rejects(runPublic(f, mode, controller.signal), error => error.code === 'FORBIDDEN');
    assert.equal(f.events.includes('settle'), false); assert.equal(f.events.includes('completed'), false);
  });
}
test('cancelling one public invocation cannot cancel a concurrent invocation', async () => {
  const f = setup(), controller = new AbortController(); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  f.ports.transport.invoke = async (_context, request, _route, signal) => {
    if (request.callId === 'request-1') { entered(); await new Promise(resolve => { release = resolve; }); }
    return { text: signal.aborted ? 'late' : request.callId, usage: { inputTokens: 1, outputTokens: 2 } };
  };
  const first = f.service.invoke(f.context, intent(), controller.signal); await ready;
  controller.abort(); release();
  const second = await f.service.invoke(f.context, { ...intent(), requestId: 'request-2' });
  assert.equal((await first).status, 'unknown'); assert.equal(second.status, 'completed'); assert.equal(second.text, 'request-2');
});
test('successful public call detaches its owner cancellation listener', async () => {
  const f = setup(), controller = new AbortController();
  assert.equal((await f.service.invoke(f.context, intent(), controller.signal)).status, 'completed');
  assert.equal(require('node:events').getEventListeners(controller.signal, 'abort').length, 0);
  const events = [...f.events]; controller.abort(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.events, events);
});

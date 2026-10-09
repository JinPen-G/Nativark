'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { prepareGatewayTextIntent: prepare } = require('../apps/api/src/modules/ai-native/gateway-intent');
const { UnifiedAiGatewayService } = require('../apps/api/src/modules/ai-native/unified-ai-gateway.service');
const policy = { sceneCode: 'order.explain', maxOutputTokens: 128 };
const intent = () => ({ draftVersion: 'ain-c03-draft-2', requestId: 'request-1', sceneCode: 'order.explain', messages: [{ role: 'user', content: [{ kind: 'text', text: 'first' }, { kind: 'text', text: ' second' }] }], requiredFeatures: ['text'], optionalFeatures: [], maxOutputTokens: 64 });
const reject = (code, body) => assert.throws(body, e => e.code === code);

test('media resolver revalidates authorization after storage and snapshots caller context', async () => {
  const { AuthorizedGatewayMediaAttachmentResolver } = require('../apps/api/src/modules/ai-native/gateway-media-attachment.resolver');
  const bytes = Buffer.from('bounded image'), contentHash = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const context = { tenantId: 'tenant-1', workspaceId: 'workspace-1', actorId: 'actor-1' };
  const reference = { kind: 'image', attachmentId: 'attachment-1', attachmentRevision: 1 };
  let allowed = true, reads = 0, checks = 0;
  const resolver = new AuthorizedGatewayMediaAttachmentResolver({ authorize: async (c, r) => {
    checks++; assert.equal(c.workspaceId, 'workspace-1'); assert.equal(r.attachmentRevision, 1);
    return allowed ? { ...reference, kind: undefined, mediaType: 'image/png', sizeBytes: bytes.length, contentHash, readBinding: { version: 1 } } : null;
  } }, { read: async () => { reads++; context.workspaceId = 'other'; reference.attachmentRevision = 2; allowed = false; return bytes; } });
  assert.equal(await resolver.resolve(context, reference, new AbortController().signal), null);
  assert.equal(checks, 2); assert.equal(reads, 1);
});

test('media count rejects before attachment reads and cancellation prevents late content', async () => {
  const { prepareGatewayIntent } = require('../apps/api/src/modules/ai-native/gateway-intent');
  const input = intent(); input.requiredFeatures.push('image');
  input.messages[0].content = Array.from({ length: 9 }, (_, i) => ({ kind: 'image', attachmentId: `image-${i}`, attachmentRevision: 1 }));
  let reads = 0;
  await assert.rejects(prepareGatewayIntent(input, policy, 'invoke', {}, { resolve: async () => { reads++; return null; } }), e => e.code === 'INVALID_REQUEST');
  assert.equal(reads, 0);
  input.messages[0].content.length = 1;
  const controller = new AbortController();
  await assert.rejects(prepareGatewayIntent(input, policy, 'invoke', {}, { resolve: async () => { controller.abort(); return null; } }, controller.signal), e => e.code === 'CANCELLED');
});

test('uncooperative media resolution is bounded without routing or dispatch', async () => {
  const h = gateway(), input = intent(); input.requiredFeatures.push('image');
  input.messages[0].content.push({ kind: 'image', attachmentId: 'image-1', attachmentRevision: 1 });
  h.ports.media = { resolve: async () => new Promise(() => {}) };
  const service = new UnifiedAiGatewayService(h.ports, 20, { ...policy, routeScene: 'chat' });
  await assert.rejects(service.invokeIntent(h.context, input), e => e.code === 'TIMEOUT');
  assert.deepEqual(h.events, []);
});
test('text normalization preserves order without adding a provider, model or address', () => {
  const input = intent(), out = prepare(input, policy, 'invoke');
  assert.deepEqual(out.request, { callId: 'request-1', messages: [{ role: 'user', content: 'first second' }], maxOutputTokens: 64 });
  assert.deepEqual(out.requiredCapabilities, ['text']); assert.equal(out.sceneCode, policy.sceneCode);
  input.messages[0].content[0].text = 'changed'; assert.equal(out.request.messages[0].content, 'first second');
});
for (const field of ['model','provider','baseUrl','config','context','credentialRef','authorizedToolRequests']) test(`caller cannot inject ${field}`, () => {
  reject('INVALID_REQUEST', () => prepare({ ...intent(), [field]: 'injected' }, policy, 'invoke'));
});
for (const capability of ['tools','structured_output','image','audio','embedding','reasoning','streaming']) test(`unsupported required ${capability} fails closed`, () => {
  reject('CAPABILITY_UNSUPPORTED', () => prepare({ ...intent(), requiredFeatures: [capability] }, policy, 'invoke'));
});
test('optional capabilities are reported as omitted, never promoted to supported', () => {
  const out = prepare({ ...intent(), optionalFeatures: ['image','tools','reasoning'] }, policy, 'invoke');
  assert.deepEqual(out.omittedOptionalFeatures, ['image','tools','reasoning']); assert.deepEqual(out.requiredCapabilities, ['text']);
});
test('stream mode requires streaming even when the caller did not request it explicitly', () => {
  const out = prepare(intent(), policy, 'stream'); assert.deepEqual(out.requiredCapabilities, ['text','streaming']); assert.deepEqual(out.request.features, ['streaming']);
});
for (const kind of ['image','audio']) test(`${kind} payload is never silently dropped as an optional capability`, () => {
  const input = intent(); input.optionalFeatures = [kind]; input.messages[0].content.push({ kind, attachmentId: 'attachment-1', attachmentRevision: 1 });
  reject('CAPABILITY_UNSUPPORTED', () => prepare(input, policy, 'invoke'));
});
for (const change of [i => { i.requiredFeatures.push('text'); }, i => { i.optionalFeatures = ['text']; }, i => { i.optionalFeatures = ['tools','tools']; }, i => { i.draftVersion = 'wrong'; }, i => { i.messages[0].role = 'tool'; }, i => { i.messages[0].content = []; }, i => { i.messages[0].content[0].url = 'https://example.com'; }]) test('malformed or ambiguous public input is rejected', () => {
  const input = intent(); change(input); reject('INVALID_REQUEST', () => prepare(input, policy, 'invoke'));
});
test('server scene and token ceiling cannot be selected or raised by the caller', () => {
  reject('FORBIDDEN', () => prepare({ ...intent(), sceneCode: 'another.scene' }, policy, 'invoke'));
  reject('INVALID_REQUEST', () => prepare({ ...intent(), maxOutputTokens: 129 }, policy, 'invoke'));
});
test('combined text size is checked after concatenation', () => {
  const input = intent(); input.messages[0].content = [{ kind: 'text', text: 'a'.repeat(20000) }, { kind: 'text', text: 'b'.repeat(20000) }];
  reject('INVALID_REQUEST', () => prepare(input, policy, 'invoke'));
});
function gateway(binding = { ...policy, routeScene: 'chat' }) {
  const events = [], requests = [], hashes = [];
  const context = { tenantId: 'tenant-1', workspaceId: 'workspace-1', actorId: 'actor-1' };
  const ports = require('./fixtures/ai-native/unified-dispatch.cjs')({
    routing: require('./fixtures/ai-native/unified-routing.cjs')(async () => { events.push('route'); return { profile: { id: 'profile-1', model: 'server-selected' } }; }),
    admission: { admit: async input => { events.push('admit'); hashes.push(input.requestHash); return { id: 'admission-1', ...input }; }, transition: async (_s,_c,_f,to) => { events.push(to); } },
    usage: { reserve: async () => { events.push('reserve'); return { id: 'usage-1' }; }, settle: async () => { events.push('settle'); }, markUnknown: async () => { events.push('unknown-usage'); } },
    audit: { append: async () => { events.push('audit'); } },
    transport: { invoke: async (_c, request) => { requests.push(request); return { text: 'done', usage: { inputTokens: 1, outputTokens: 2 } }; },
      stream: async function* (_c, request) { requests.push(request); yield { kind: 'text_delta', delta: 'part' }; yield { kind: 'result', result: { text: 'done', usage: { inputTokens: 1, outputTokens: 2 } } }; } }
  });
  return { events, requests, hashes, context, ports, service: new UnifiedAiGatewayService(ports, 10000, binding) };
}
for (const mode of ['invoke', 'stream']) test(`${mode} text intent enters existing dispatch and accounting lifecycle without model input`, async () => {
  const f = gateway(), input = intent();
  if (mode === 'invoke') assert.equal((await f.service.invokeTextIntent(f.context, input)).text, 'done');
  else { const events = []; for await (const event of f.service.streamTextIntent(f.context, input)) events.push(event); assert.deepEqual(events.map(e => e.kind), ['text_delta','result']); }
  assert.equal(f.requests[0].model, 'server-selected'); assert.equal(f.requests[0].messages[0].content, 'first second');
  assert.deepEqual(f.events, ['route','admit','reserve','audit','settle','completed']); assert.equal('model' in input, false);
});
for (const mode of ['invoke', 'stream']) test(`${mode} text intent rejects invalid capability or scene before routing`, async () => {
  for (const input of [{ ...intent(), model: 'injected' }, { ...intent(), requiredFeatures: ['tools'] }, { ...intent(), sceneCode: 'other' }]) {
    const f = gateway();
    await assert.rejects(async () => { if (mode === 'invoke') await f.service.invokeTextIntent(f.context, input); else for await (const _ of f.service.streamTextIntent(f.context, input)) {} });
    assert.deepEqual(f.events, []);
  }
});
test('server scene mapping is snapshotted and verified against actual route before admission', async () => {
  const binding = { ...policy, routeScene: 'knowledge' }, f = gateway(binding); binding.routeScene = 'chat';
  await assert.rejects(f.service.invokeTextIntent(f.context, intent()), e => e.code === 'CONFIG_INVALID'); assert.deepEqual(f.events, ['route']);
});
test('distinct public scenes sharing a route do not share an invocation fingerprint', async () => {
  const first = gateway(), second = gateway({ ...policy, sceneCode: 'order.check', routeScene: 'chat' });
  await first.service.invokeTextIntent(first.context, intent()); await second.service.invokeTextIntent(second.context, { ...intent(), sceneCode: 'order.check' });
  assert.notEqual(first.hashes[0], second.hashes[0]);
});
test('missing policy cannot enable the intent bridge; pre-cancelled intent has no effects', async () => {
  const f = gateway(), unbound = new UnifiedAiGatewayService(f.ports), signal = new AbortController(); signal.abort();
  await assert.rejects(unbound.invokeTextIntent(f.context, intent()), e => e.code === 'CONFIG_INVALID');
  await assert.rejects(f.service.invokeTextIntent(f.context, intent(), signal.signal), e => e.code === 'CANCELLED'); assert.deepEqual(f.events, []);
});

for (const change of [i => { i.optionalFeatures = ['image']; }, i => { i.requiredFeatures = []; }, i => { i.messages[0].content = [{ kind: 'text', text: 'first second' }]; }]) test('full original intent participates in the admission fingerprint', async () => {
  const first = gateway(), second = gateway(), changed = intent(); change(changed);
  await first.service.invokeTextIntent(first.context, intent()); await second.service.invokeTextIntent(second.context, changed);
  assert.deepEqual(first.requests, second.requests); assert.notEqual(first.hashes[0], second.hashes[0]);
});
for (const mode of ['invoke', 'stream']) for (const result of [
  { text: 'done', toolRequests: [{ tool: 'unrequested' }] }, { text: 'done', structuredOutput: {} },
  { text: 'done', usage: { inputTokens: -1, outputTokens: 0 } }, { text: 'done', privateMetadata: 'do not expose' }
]) test(`${mode} text-only intent rejects malformed or unrequested output before completion`, async () => {
  const f = gateway(); f.ports.transport.invoke = async () => result;
  f.ports.transport.stream = async function* () { yield { kind: 'result', result }; };
  await assert.rejects(async () => {
    if (mode === 'invoke') await f.service.invokeTextIntent(f.context, intent());
    else for await (const _ of f.service.streamTextIntent(f.context, intent())) assert.fail('must not publish terminal output');
  }, e => e.code === 'INVALID_RESPONSE');
  assert.equal(f.events.includes('completed'), false); assert.equal(f.events.includes('settle'), false);
  assert.ok(f.events.includes('unknown')); assert.ok(f.events.includes('unknown-usage'));
});
test('intent stream consumer return closes the underlying lifecycle without a terminal success', async () => {
  const f = gateway(), stream = f.service.streamTextIntent(f.context, intent());
  assert.equal((await stream.next()).value.kind, 'text_delta');
  await stream.return(); assert.ok(f.events.includes('unknown')); assert.equal(f.events.includes('completed'), false);
});
test('intent and context changes while routing waits cannot replace the captured request', async () => {
  const f = gateway(), input = intent(), context = { ...f.context }; let release, entered, seenContext;
  const ready = new Promise(r => { entered = r; });
  const resolve = f.ports.routing.resolve;
  f.ports.routing.resolve = async (...args) => { seenContext = args[0]; await new Promise(r => { release = r; entered(); }); return resolve(...args); };
  const pending = f.service.invokeTextIntent(context, input);
  await ready; input.messages[0].content[0].text = 'changed'; context.actorId = 'another'; release();
  await pending; assert.equal(f.requests[0].messages[0].content, 'first second'); assert.equal(seenContext.actorId, 'actor-1');
});

test('invalid server policy and invocation mode never produce a prepared request', () => {
  reject('CONFIG_INVALID', () => prepare(intent(), { ...policy, maxOutputTokens: 0 }, 'invoke'));
  reject('CONFIG_INVALID', () => prepare(intent(), policy, 'other'));
});

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const base = require('./fixtures/ai-native/contract-consumer.cjs'); base.blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true } });
const { RoutedModelTransport, TenantModelConnectionResolver } = require('../apps/api/src/modules/ai-native/routed-model-transport');
const { ChatCompletionsAdapter } = require('../apps/api/src/modules/ai-native/chat-completions.adapter');
const { TenantModelConfigService } = require('../apps/api/src/modules/ai-native/tenant-model-config.service');
const { SecretBox } = require('../apps/api/src/common/secret-box');
const { PublicAiGatewayModule } = require('../apps/api/src/modules/ai-native/public-ai-gateway.service');
const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
const { ModelGatewayError } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
const context = { tenantId: 'tenant-test', workspaceId: 'space-test', actorId: 'actor-test' };
const request = () => ({ callId: 'call-test', model: 'selected-model', messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 10 });
function setup(mode = 'tenant_managed') {
  const owner = mode === 'tenant_managed' ? { id: 'owner-tenant', kind: 'TENANT', tenantId: context.tenantId } : { id: 'owner-platform', kind: 'PLATFORM' };
  const profile = { id: 'profile-1', scopeId: owner.id, scopeKind: owner.kind, profileKey: 'default', role: 'DEFAULT', serviceMode: mode,
    protocol: 'openai_chat_completions', provider: 'synthetic-provider', model: 'selected-model', credentialRef: 'vault:1', configRevision: 1,
    enabled: true, disabledAt: null, allowedCapabilities: ['text','streaming'] };
  const state = { resolves: [], wire: [], connection: { profileFingerprint: capabilityProfileFingerprint(profile), baseUrl: 'https://provider.invalid/v1', credential: 'synthetic-secret', maxOutputTokens: 100 }, afterResolve: null, afterWire: null };
  const resolver = kind => ({ resolve: async () => { state.resolves.push(kind); if (state.afterResolve) await state.afterResolve(); return structuredClone(state.connection); } });
  const http = { post: async value => { state.wire.push(value); if (state.afterWire) await state.afterWire(); return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }) }; },
    postStream: async function* (value) { state.wire.push(value); yield { kind: 'headers', status: 200 }; yield { kind: 'chunk', bytes: Buffer.from('data: {"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') }; } };
  const connections = { platform: resolver('platform'), tenant: resolver('tenant') }, adapter = new ChatCompletionsAdapter(http);
  return { state, profile, connections, adapter, route: { profile, scope: owner, role: 'DEFAULT', preflight: { allowed: true, required: ['text'], missing: [], stale: [] } },
    transport: new RoutedModelTransport(connections, [adapter]) };
}
for (const mode of ['platform_managed','tenant_managed']) test(`${mode} resolves only its owner and calls the real protocol adapter`, async () => {
  const f = setup(mode), result = await f.transport.invoke(context, request(), f.route, new AbortController().signal);
  assert.equal(result.text, 'answer'); assert.deepEqual(f.state.resolves, Array(3).fill(mode === 'tenant_managed' ? 'tenant' : 'platform'));
  assert.equal(f.state.wire[0].url, 'https://provider.invalid/v1/chat/completions');
  assert.equal(f.state.wire[0].headers.Authorization, 'Bearer synthetic-secret'); assert.equal(JSON.parse(f.state.wire[0].body).model, 'selected-model');
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
});
test('real protocol streaming is passed through with ordered complete output', async () => {
  const f = setup(), out = [];
  for await (const event of f.transport.stream(context, { ...request(), features: ['streaming'] }, f.route, new AbortController().signal)) out.push(event);
  assert.equal(out.filter(e => e.kind === 'text_delta').map(e => e.delta).join(''), 'answer'); assert.equal(out.at(-1).kind, 'result');
  assert.equal(out.at(-1).result.text, 'answer');
});
for (const change of [f => { f.route.scope.tenantId = 'other'; }, f => { f.profile.scopeId = 'other'; }, f => { f.profile.model = 'other'; }, f => { f.profile.enabled = false; }, f => { f.route.preflight.allowed = false; }]) test('invalid routed owner or model never reaches the vault or wire', async () => {
  const f = setup(); change(f); await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal)); assert.deepEqual(f.state.resolves, []); assert.deepEqual(f.state.wire, []);
});
for (const change of [f => { f.state.connection.profileFingerprint = '0'.repeat(64); }, f => { f.state.connection.baseUrl = 'http://127.0.0.1/'; }, f => { f.state.connection.credential = 'bad\nkey'; }]) test('invalid bound credentials or destination never reach the adapter', async () => {
  const f = setup(); change(f); await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal)); assert.equal(f.state.wire.length, 0);
});
test('credential rotation during final pre-wire resolution blocks dispatch', async () => {
  const f = setup(); f.state.afterResolve = () => { if (f.state.resolves.length === 2) f.state.connection.credential = 'rotated'; };
  await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal), e => e.code === 'CONFIG_INVALID'); assert.equal(f.state.wire.length, 0);
});
test('credential rotation after dispatch suppresses result publication', async () => {
  const f = setup(); f.state.afterWire = () => { f.state.connection.credential = 'rotated'; };
  await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal), e => e.code === 'CONFIG_INVALID'); assert.equal(f.state.wire.length, 1);
});
test('absent protocols never fall back to another adapter or owner', async () => {
  const f = setup(); f.profile.protocol = 'unavailable'; f.state.connection.profileFingerprint = capabilityProfileFingerprint(f.profile);
  await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal), e => e.code === 'PROVIDER_UNAVAILABLE'); assert.equal(f.state.resolves.length, 0);
});
test('cancelled vault wait never reaches the adapter', async () => {
  const f = setup(), abort = new AbortController(); f.state.afterResolve = () => abort.abort();
  await assert.rejects(f.transport.invoke(context, request(), f.route, abort.signal), e => e.code === 'CANCELLED'); assert.equal(f.state.wire.length, 0);
});
const encodedCredential = value => [...new Set([Buffer.from(value).toString('base64'),
  Buffer.from(value).toString('base64').replace(/=+$/u, ''), Buffer.from(value).toString('base64url'),
  Buffer.from(value).toString('hex'), Buffer.from(value).toString('hex').toUpperCase(),
  encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])];
test('encoded credential output is rejected by native codecs and routed result projections without losing original usage', async () => {
  const { AnthropicMessagesAdapter, ResponsesAdapter } = require('../apps/api/src/modules/ai-native/native-messages.adapter');
  const credential = 'synthetic-"secret-a/b?c=1';
  for (const encoded of encodedCredential(credential)) {
    for (const [Adapter, raw] of [
      [ChatCompletionsAdapter, { choices: [{ message: { content: encoded }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }],
      [ResponsesAdapter, { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: encoded }] }], usage: { input_tokens: 2, output_tokens: 3 } }],
      [AnthropicMessagesAdapter, { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: encoded }], usage: { input_tokens: 2, output_tokens: 3 } }]
    ]) {
      let calls = 0; const usage = [];
      const adapter = new Adapter({ post: async () => { calls++; return { status: 200, body: JSON.stringify(raw) }; } });
      await assert.rejects(adapter.generate({ ...request(), signal: new AbortController().signal,
        recordUsage: async value => usage.push(value) }, credential, { baseUrl: 'https://provider.invalid/v1' }), e => e.code === 'INVALID_RESPONSE');
      assert.equal(calls, 1); assert.deepEqual(usage, [{ inputTokens: 2, outputTokens: 3 }]);
    }
    for (const mode of ['platform_managed', 'tenant_managed']) {
      const f = setup(mode); f.state.connection.credential = credential;
      for (const result of [{ text: encoded }, { text: 'safe', structured: { [encoded]: 'value' } },
        { text: 'safe', structured: { nested: [encoded] } }]) {
        const adapter = { provider: f.profile.protocol, features: [], generate: async () => result };
        await assert.rejects(new RoutedModelTransport(f.connections, [adapter]).invoke(context, request(), f.route,
          new AbortController().signal), e => e.code === 'INVALID_RESPONSE');
      }
    }
  }
});
test('encoded credential fragments are withheld by routed and native streams before any secret prefix is delivered', async () => {
  const { AnthropicMessagesAdapter, ResponsesAdapter } = require('../apps/api/src/modules/ai-native/native-messages.adapter');
  const credential = 'synthetic-"secret-a/b?c=1';
  const frame = value => Buffer.from(`data: ${JSON.stringify(value)}\n\n`);
  for (const encoded of encodedCredential(credential)) {
    const cut = Math.floor(encoded.length / 2), parts = [encoded.slice(0, cut), encoded.slice(cut)];
    for (const mode of ['platform_managed', 'tenant_managed']) {
      const f = setup(mode); f.state.connection.credential = credential;
      const adapter = { provider: f.profile.protocol, features: ['streaming'], generate: async () => ({ text: 'unused' }),
        stream: async function* () { for (const delta of parts) yield { kind: 'text_delta', delta };
          yield { kind: 'result', result: { text: encoded } }; } };
      const out = [];
      await assert.rejects(async () => { for await (const event of new RoutedModelTransport(f.connections, [adapter])
        .stream(context, request(), f.route, new AbortController().signal)) out.push(event); }, e => e.code === 'INVALID_RESPONSE');
      assert.deepEqual(out, []);
    }
    const responseFrames = [
      { type: 'response.created', sequence_number: 0, response: { id: 'response', output: [] } },
      { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { id: 'message', type: 'message', role: 'assistant', content: [] } },
      { type: 'response.content_part.added', sequence_number: 2, output_index: 0, item_id: 'message', content_index: 0, part: { type: 'output_text', text: '' } },
      ...parts.map((delta, index) => ({ type: 'response.output_text.delta', sequence_number: 3 + index,
        output_index: 0, item_id: 'message', content_index: 0, delta }))
    ];
    const messageFrames = [
      { type: 'message_start', message: { id: 'message', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 2, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      ...parts.map(text => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }))
    ];
    const chatFrames = parts.map(content => ({ choices: [{ index: 0, delta: { content }, finish_reason: null }] }));
    for (const [Adapter, frames] of [[ChatCompletionsAdapter, chatFrames], [ResponsesAdapter, responseFrames], [AnthropicMessagesAdapter, messageFrames]]) {
      let calls = 0, closed = 0, frameCount = 0, transmitted = frames;
      const transport = { post: async () => { throw Error('stream only'); }, postStream: async function* () {
        calls++; try { yield { kind: 'headers', status: 200 }; for (const value of transmitted) { frameCount++; yield { kind: 'chunk', bytes: frame(value) }; } }
        finally { closed++; } } };
      const out = [];
      // Truncated fake bodies cannot complete either way. The assertion here is
      // rejection BEFORE delivery: an encoded credential fragment is not safe text.
      await assert.rejects(async () => { for await (const event of new Adapter(transport).stream({ ...request(),
        signal: new AbortController().signal }, credential, { baseUrl: 'https://provider.invalid/v1' })) out.push(event); }, e => e.code === 'INVALID_RESPONSE');
      assert.deepEqual(out, []); assert.equal(calls, 1); assert.equal(closed, 1); assert.equal(frameCount, frames.length);
      transmitted = frames.map(value => {
        const next = structuredClone(value), ordinary = text => text === parts[0] ? 'ordinary ' : 'answer';
        if (next.choices) next.choices[0].delta.content = ordinary(next.choices[0].delta.content);
        else if (next.type === 'response.output_text.delta') next.delta = ordinary(next.delta);
        else if (next.type === 'content_block_delta') next.delta.text = ordinary(next.delta.text);
        return next;
      });
      calls = closed = frameCount = 0; const safe = [];
      await assert.rejects(async () => { for await (const event of new Adapter(transport).stream({ ...request(),
        signal: new AbortController().signal }, credential, { baseUrl: 'https://provider.invalid/v1' })) safe.push(event); }, e => e.code === 'INVALID_RESPONSE');
      assert.equal(safe.map(event => event.delta ?? '').join(''), 'ordinary answer'); // valid frames reach text; EOF is still not success
      assert.equal(calls, 1); assert.equal(closed, 1); assert.equal(frameCount, frames.length);
    }
  }
  const { ModelResponseSecretGuard } = require('../apps/api/src/modules/ai-native/model-response-secret');
  const maximum = 'z'.repeat(8191) + '?', guard = new ModelResponseSecretGuard(maximum);
  assert.equal(guard.releaseLength('ordinary ' + maximum.slice(0, -1)), 'ordinary '.length);
  assert.equal(guard.releaseLength('ordinary ' + maximum), null);
});

test('encoded directory credentials never become model IDs or metadata candidates', async () => {
  const { discoverProviderMetadata } = require('../apps/api/src/modules/ai-native/provider-discovery.service');
  const credential = 'synthetic-"secret-a/b?c=1';
  const variants = [...new Set([Buffer.from(credential).toString('base64url'), ...encodedCredential(credential)])];
  for (const protocol of ['openai_chat_completions', 'openai_responses', 'anthropic_messages']) {
    const input = { protocol, baseUrl: 'https://provider.invalid/v1', expectedRevision: 1,
      secretChange: { operation: 'replace', apiKey: credential } };
    for (const encoded of variants) for (const escape of [false, true]) {
      let calls = 0;
      const json = JSON.stringify({ data: [{ id: encoded }] });
      const body = escape ? json.replace(/[A-Za-z]/g, c => String.fromCharCode(92) + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0')) : json;
      const result = await discoverProviderMetadata(input, 'models', credential, {
        getModelDirectory: async () => { calls++; return { status: 200, body }; }
      }, async () => {}, new AbortController().signal);
      assert.deepEqual(result.models, []); assert.equal(result.state, 'unavailable');
      assert.equal(result.observation, 'metadata_only'); assert.equal(calls, 1);
      assert.ok(result.protocols.every(item => item.state === 'undetermined'));
    }
    const ordinary = await discoverProviderMetadata(input, 'models', credential, {
      getModelDirectory: async () => ({ status: 200, body: JSON.stringify({ data: [{ id: 'ordinary-model' }] }) })
    }, async () => {}, new AbortController().signal);
    assert.deepEqual(ordinary.models, ['ordinary-model']); assert.equal(ordinary.state, 'listed');
    assert.equal(ordinary.observation, 'metadata_only'); // metadata remains neither inference nor live capability proof
  }
});

test('native non-stream usage requires a terminal response before recording', async () => {
  const { AnthropicMessagesAdapter, ResponsesAdapter } = require('../apps/api/src/modules/ai-native/native-messages.adapter');
  const usage = { input_tokens: 2, output_tokens: 3 }, credential = 'synthetic-secret';
  const cases = [
    [ResponsesAdapter, { status: 'in_progress', output: [], usage }],
    [ResponsesAdapter, { status: 'queued', output: [], usage }],
    [ResponsesAdapter, { status: 'completed', error: { code: 'failure' }, output: [], usage }],
    [ResponsesAdapter, { status: 'completed', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage }],
    [AnthropicMessagesAdapter, { type: 'message', role: 'assistant', stop_reason: null, content: [], usage }],
    [AnthropicMessagesAdapter, { type: 'message', role: 'user', stop_reason: 'end_turn', content: [], usage }],
    [AnthropicMessagesAdapter, { type: 'other', role: 'assistant', stop_reason: 'end_turn', content: [], usage }]
  ];
  for (const finish_reason of [null, undefined, 'unrecognized']) cases.push([ChatCompletionsAdapter,
    { choices: [{ message: { content: 'partial' }, finish_reason }], usage: { prompt_tokens: 2, completion_tokens: 3 } }]);
  for (const [Adapter, raw] of cases) {
    let calls = 0; const recorded = [];
    const adapter = new Adapter({ post: async () => { calls++; return { status: 200, body: JSON.stringify(raw) }; } });
    await assert.rejects(adapter.generate({ ...request(), signal: new AbortController().signal,
      recordUsage: async value => recorded.push(value) }, credential, { baseUrl: 'https://provider.invalid/v1' }), e => e.code === 'INVALID_RESPONSE');
    assert.equal(calls, 1); assert.deepEqual(recorded, []);
  }
  for (const [Adapter, raw] of [
    [ResponsesAdapter, { status: 'completed', output: [], usage }],
    [ResponsesAdapter, { status: 'incomplete', error: null, incomplete_details: { reason: 'max_output_tokens' }, output: [], usage }],
    [ResponsesAdapter, { status: 'failed', error: { code: 'server_error' }, incomplete_details: null, output: [], usage }],
    [AnthropicMessagesAdapter, { type: 'message', role: 'assistant', stop_reason: 'max_tokens', content: [], usage }],
    [ChatCompletionsAdapter, { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 2, completion_tokens: 3 } }]
  ]) {
    const recorded = [], adapter = new Adapter({ post: async () => ({ status: 200, body: JSON.stringify(raw) }) });
    await assert.rejects(adapter.generate({ ...request(), signal: new AbortController().signal,
      recordUsage: async value => recorded.push(value) }, credential, { baseUrl: 'https://provider.invalid/v1' }), e => e.code === 'INVALID_RESPONSE');
    assert.deepEqual(recorded, [{ inputTokens: 2, outputTokens: 3 }]);
  }
});

test('native stream usage requires a consistent terminal state', async () => {
  const { AnthropicMessagesAdapter, ResponsesAdapter } = require('../apps/api/src/modules/ai-native/native-messages.adapter');
  const responseStart = { type: 'response.created', sequence_number: 0, response: { id: 'response', output: [] } };
  const messageStart = { type: 'message_start', message: { id: 'message', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 2, output_tokens: 0 } } };
  const cases = [
    [ResponsesAdapter, [responseStart, { type: 'response.completed', sequence_number: 1, response: { id: 'response', status: 'in_progress', usage: { input_tokens: 2, output_tokens: 3 } } }], false],
    [ResponsesAdapter, [responseStart, { type: 'response.completed', sequence_number: 1, response: { id: 'response', status: 'completed', error: { code: 'failure' }, usage: { input_tokens: 2, output_tokens: 3 } } }], false],
    [ResponsesAdapter, [responseStart, { type: 'response.incomplete', sequence_number: 1, response: { id: 'response', status: 'completed', usage: { input_tokens: 2, output_tokens: 3 } } }], false],
    [ResponsesAdapter, [responseStart, { type: 'response.incomplete', sequence_number: 1, response: { id: 'response', status: 'incomplete', usage: { input_tokens: 2, output_tokens: 3 } } }], true],
    [AnthropicMessagesAdapter, [messageStart, { type: 'message_delta', delta: { stop_reason: 'unknown' }, usage: { output_tokens: 3 } }, { type: 'message_stop' }], false],
    [AnthropicMessagesAdapter, [messageStart, { type: 'message_delta', delta: { stop_reason: 'stop_sequence', stop_sequence: 'registered-stop' }, usage: { output_tokens: 3 } }, { type: 'message_stop' }], true],
    [AnthropicMessagesAdapter, [messageStart, { type: 'message_delta', delta: { stop_reason: null, stop_sequence: 'registered-stop' }, usage: { output_tokens: 3 } }, { type: 'message_stop' }], false],
    [AnthropicMessagesAdapter, [messageStart, { type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: 'registered-stop' }, usage: { output_tokens: 3 } }, { type: 'message_stop' }], false],
    [AnthropicMessagesAdapter, [messageStart, { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 3 } }, { type: 'message_stop' }], true]
  ];
  for (const [Adapter, frames, hasUsage] of cases) {
    const recorded = []; let calls = 0;
    const adapter = new Adapter({ post: async () => assert.fail('stream only'), postStream: async function* () {
      calls++; yield { kind: 'headers', status: 200 };
      for (const frame of frames) yield { kind: 'chunk', bytes: Buffer.from(`data: ${JSON.stringify(frame)}\n\n`) };
    } });
    await assert.rejects(async () => { for await (const _ of adapter.stream({ ...request(), signal: new AbortController().signal,
      recordUsage: async value => recorded.push(value) }, 'synthetic-secret', { baseUrl: 'https://provider.invalid/v1' })) assert.fail('must not deliver'); }, e => e.code === 'INVALID_RESPONSE');
    assert.equal(calls, 1); assert.deepEqual(recorded, hasUsage ? [{ inputTokens: 2, outputTokens: 3 }] : []);
  }
  const item = { id: 'answer', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'answer' }] };
  for (const [Adapter, frames] of [
    [ResponsesAdapter, [responseStart,
      { type: 'response.output_item.added', sequence_number: 1, output_index: 0, item: { id: 'answer', type: 'message', role: 'assistant', content: [] } },
      { type: 'response.content_part.added', sequence_number: 2, output_index: 0, item_id: 'answer', content_index: 0, part: { type: 'output_text', text: '' } },
      { type: 'response.output_text.delta', sequence_number: 3, output_index: 0, item_id: 'answer', content_index: 0, delta: 'answer' },
      { type: 'response.output_text.done', sequence_number: 4, output_index: 0, item_id: 'answer', content_index: 0, text: 'answer' },
      { type: 'response.content_part.done', sequence_number: 5, output_index: 0, item_id: 'answer', content_index: 0, part: { type: 'output_text', text: 'answer' } },
      { type: 'response.output_item.done', sequence_number: 6, output_index: 0, item },
      { type: 'response.completed', sequence_number: 7, response: { id: 'response', status: 'completed', output: [item], usage: { input_tokens: 2, output_tokens: 3 } } }]],
    [AnthropicMessagesAdapter, [messageStart,
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'answer' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }, { type: 'message_stop' }]]
  ]) {
    const recorded = [], events = [], adapter = new Adapter({ post: async () => assert.fail('stream only'), postStream: async function* () {
      yield { kind: 'headers', status: 200 };
      for (const frame of frames) yield { kind: 'chunk', bytes: Buffer.from(`data: ${JSON.stringify(frame)}\n\n`) };
    } });
    for await (const event of adapter.stream({ ...request(), signal: new AbortController().signal,
      recordUsage: async value => recorded.push(value) }, 'synthetic-secret', { baseUrl: 'https://provider.invalid/v1' })) events.push(event);
    assert.equal(events.at(-1).result.text, 'answer'); assert.deepEqual(recorded, [{ inputTokens: 2, outputTokens: 3 }]);
  }
});

test('terminal Chat usage survives rejected delivery and failed accounting is not automatically retried', async () => {
  const credential = 'synthetic-"secret-a/b?c=1';
  for (const content of [credential, encodedCredential(credential)[0]]) {
    for (const usage of [{ prompt_tokens: 2, completion_tokens: 3 }, { prompt_tokens: 0, completion_tokens: 0 }]) {
      let calls = 0, closed = 0; const recorded = [], delivered = [];
      const adapter = new ChatCompletionsAdapter({ post: async () => { throw Error('stream only'); },
        postStream: async function* () { calls++; try { yield { kind: 'headers', status: 200 };
          yield { kind: 'chunk', bytes: Buffer.from(`data: ${JSON.stringify({ choices: [{ index: 0,
            delta: { content }, finish_reason: 'stop' }], usage })}\n\n`) }; } finally { closed++; } } });
      await assert.rejects(async () => { for await (const event of adapter.stream({ ...request(),
        signal: new AbortController().signal, recordUsage: async value => recorded.push(value) }, credential,
        { baseUrl: 'https://provider.invalid/v1' })) delivered.push(event); }, e => e.code === 'INVALID_RESPONSE');
      assert.deepEqual(recorded, [{ inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }]);
      assert.deepEqual(delivered, []); assert.equal(calls, 1); assert.equal(closed, 1);
    }
  }
  let writes = 0;
  const rejected = new ChatCompletionsAdapter({ post: async () => { throw Error('stream only'); }, postStream: async function* () {
    yield { kind: 'headers', status: 200 }; yield { kind: 'chunk', bytes: Buffer.from(`data: ${JSON.stringify({
      choices: [{ index: 0, delta: { content: credential }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 3 } })}\n\n`) };
  } });
  await assert.rejects(async () => { for await (const _ of rejected.stream({ ...request(), signal: new AbortController().signal,
    recordUsage: async () => { writes++; throw new ModelGatewayError('ACCOUNTING_PENDING'); } }, credential,
    { baseUrl: 'https://provider.invalid/v1' })) assert.fail('must not deliver'); }, e => e.code === 'ACCOUNTING_PENDING');
  assert.equal(writes, 1);
});
test('Chat usage remains absent for missing interim or invalid counters and terminal callbacks occur once', async () => {
  const credential = 'synthetic-"secret-a/b?c=1';
  for (const [finish, usage] of [['stop', undefined], [null, { prompt_tokens: 2, completion_tokens: 3 }],
    ['stop', { prompt_tokens: 2, completion_tokens: 3, total_tokens: 99 }]]) {
    const recorded = [];
    const adapter = new ChatCompletionsAdapter({ post: async () => { throw Error('stream only'); }, postStream: async function* () {
      yield { kind: 'headers', status: 200 }; yield { kind: 'chunk', bytes: Buffer.from(`data: ${JSON.stringify({
        choices: [{ index: 0, delta: { content: credential }, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`) };
    } });
    await assert.rejects(async () => { for await (const _ of adapter.stream({ ...request(), signal: new AbortController().signal,
      recordUsage: async value => recorded.push(value) }, credential, { baseUrl: 'https://provider.invalid/v1' })) assert.fail('must not deliver'); }, e => e.code === 'INVALID_RESPONSE');
    assert.deepEqual(recorded, []);
  }
  const recorded = [], events = [];
  const ordinary = new ChatCompletionsAdapter({ post: async () => { throw Error('stream only'); }, postStream: async function* () {
    yield { kind: 'headers', status: 200 };
    yield { kind: 'chunk', bytes: Buffer.from(`data: ${JSON.stringify({ choices: [{ index: 0,
      delta: { content: 'ordinary answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } })}\n\n`) };
    yield { kind: 'chunk', bytes: Buffer.from(': bounded heartbeat\n\n') };
    yield { kind: 'chunk', bytes: Buffer.from('data: [DONE]\n\n') };
  } });
  for await (const event of ordinary.stream({ ...request(), signal: new AbortController().signal,
    recordUsage: async value => recorded.push(value) }, credential, { baseUrl: 'https://provider.invalid/v1' })) events.push(event);
  assert.deepEqual(recorded, [{ inputTokens: 2, outputTokens: 3 }]); assert.equal(events.at(-1).kind, 'result');
  assert.equal(events.at(-1).result.text, 'ordinary answer');
});

test('failed Chat stream terminals retain original counters without completing delivery', async () => {
  const usage = { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, prompt_tokens_details: { cached_tokens: 2 } };
  for (const finish of ['length', 'content_filter']) for (const separate of [false, true]) {
    const recorded = [], delivered = []; let calls = 0, closed = 0;
    const adapter = new ChatCompletionsAdapter({ post: async () => assert.fail('stream only'), postStream: async function* () {
      calls++; try {
        yield { kind: 'headers', status: 200 };
        yield { kind: 'chunk', bytes: Buffer.from(`data: ${JSON.stringify({ choices: [{ index: 0,
          delta: { content: 'unusable answer' }, finish_reason: finish }], ...(separate ? {} : { usage }) })}\n\n`) };
        if (separate) yield { kind: 'chunk', bytes: Buffer.from(`data: ${JSON.stringify({ choices: [], usage })}\n\n`) };
        yield { kind: 'chunk', bytes: Buffer.from('data: [DONE]\n\n') };
      } finally { closed++; }
    } });
    await assert.rejects(async () => { for await (const event of adapter.stream({ ...request(),
      signal: new AbortController().signal, recordUsage: async value => recorded.push(value) }, 'synthetic-secret',
      { baseUrl: 'https://provider.invalid/v1' })) delivered.push(event); }, e => e.code === 'INVALID_RESPONSE');
    assert.deepEqual(recorded, [{ inputTokens: 5, outputTokens: 3,
      billingDetails: { cachedInputTokens: 2, cacheCreationInputTokens: 0 } }]);
    assert.deepEqual(delivered, []); assert.equal(calls, 1); assert.equal(closed, 1);
  }
  for (const finish of [null, 'unrecognized', 'length']) {
    const recorded = [], adapter = new ChatCompletionsAdapter({ post: async () => assert.fail('stream only'), postStream: async function* () {
      yield { kind: 'headers', status: 200 };
      yield { kind: 'chunk', bytes: Buffer.from(`data: ${JSON.stringify({ choices: [{ index: 0,
        delta: {}, finish_reason: finish }], usage: { ...usage, total_tokens: 99 } })}\n\n`) };
    } });
    await assert.rejects(async () => { for await (const _ of adapter.stream({ ...request(),
      signal: new AbortController().signal, recordUsage: async value => recorded.push(value) }, 'synthetic-secret',
      { baseUrl: 'https://provider.invalid/v1' })) assert.fail('must not deliver'); }, e => e.code === 'INVALID_RESPONSE');
    assert.deepEqual(recorded, []);
  }
});

test('failed Chat stream follows both Gateway modes into the original budget receipt and reconciliation', async () => {
  const { PersistentGatewayBudget } = require('../apps/api/src/modules/ai-native/budget/persistent-gateway-budget');
  for (const mode of ['platform_managed', 'tenant_managed']) for (const lostReceipt of [false, true]) {
    const f = setup(mode), current = structuredClone(base.contexts[0]), events = [], receipts = [];
    current.actor = { kind: 'user', userId: context.actorId }; current.scope = { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId };
    const consumerScope = { id: 'consumer', kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId };
    const ports = require('./fixtures/ai-native/unified-dispatch.cjs')({
      routing: { resolve: async (_c, required) => ({ context: current, consumerScope, route: f.route,
        selection: { mode, revision: 1 }, scene: 'chat', requiredCapabilities: required }), assertCurrent: async () => {} },
      admission: { admit: async input => ({ ...input, id: 'admission-failed' }), transition: async (_s, _c, _f, to) => events.push(to) },
      usage: {}, audit: { append: async () => {} }
    });
    ports.budget = new PersistentGatewayBudget({
      reserve: async () => { events.push('reserve'); return 'reservation-failed'; },
      dispatch: async () => ({ id: 'reservation-failed', status: 'reserved', dispatched: true }),
      settle: async () => assert.fail('failed delivery must not settle automatically'),
      release: async () => assert.fail('dispatched call must retain its reservation'),
      markUnknown: async () => events.push('budget-unknown'), reconcile: async () => assert.fail('explicit original evidence required')
    }, { assertClaim: async () => {}, link: async () => {}, dispatch: async () => {}, cancelIfUnsent: async () => false,
      recordUsage: async (call, id, usage) => { receipts.push({ call: structuredClone(call), id, usage });
        if (lostReceipt) throw new ModelGatewayError('ACCOUNTING_PENDING'); return 'original-evidence'; } });
    const adapter = new ChatCompletionsAdapter({ post: async () => assert.fail('stream only'), postStream: async function* (wire) {
      f.state.wire.push(wire); yield { kind: 'headers', status: 200 };
      yield { kind: 'chunk', bytes: Buffer.from('data: {"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}\n\n') };
      yield { kind: 'chunk', bytes: Buffer.from('data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n') };
      yield { kind: 'chunk', bytes: Buffer.from('data: [DONE]\n\n') };
    } });
    const module = PublicAiGatewayModule.registerProtocols({ ports, evidence: 'mock', verifyEvidence: async () => true },
      f.connections, [adapter], [{ sceneCode: 'order.explain', routeScene: 'chat', maxOutputTokens: 100 }]);
    const out = [];
    for await (const event of module.providers[0].useValue.stream(current, { draftVersion: 'ain-c03-draft-2',
      requestId: 'failed-stream', sceneCode: 'order.explain', messages: [{ role: 'user', content: [{ kind: 'text', text: 'hello' }] }],
      requiredFeatures: ['text', 'streaming'], optionalFeatures: [], maxOutputTokens: 10 })) out.push(event);
    assert.deepEqual(out.map(event => event.kind), ['started', 'terminal']);
    assert.equal(out.at(-1).result.status, 'unknown'); assert.equal(out.at(-1).result.error.retryable, false);
    assert.equal(out.at(-1).result.error.nextAction, 'reconcile'); assert.equal(f.state.wire.length, 1);
    assert.deepEqual(events, ['reserve', 'budget-unknown', 'unknown']); assert.equal(receipts.length, 1);
    assert.equal(receipts[0].id, 'reservation-failed'); assert.equal(receipts[0].call.request.callId, 'failed-stream');
    assert.equal(receipts[0].call.binding.scope.tenantId, context.tenantId);
    assert.deepEqual(receipts[0].usage, { inputTokens: 2, outputTokens: 3 });
  }
});

test('a credential split over adapter events is withheld before its prefix is published', async () => {
  const f = setup(), adapter = { provider: f.profile.protocol, features: ['streaming'], generate: async () => ({ text: 'unused' }), stream: async function* () {
    yield { kind: 'text_delta', delta: 'synthetic-' }; yield { kind: 'text_delta', delta: 'secret' }; yield { kind: 'result', result: { text: 'safe' } };
  } };
  const transport = new RoutedModelTransport(f.connections, [adapter]), out = [];
  await assert.rejects(async () => { for await (const event of transport.stream(context, request(), f.route, new AbortController().signal)) out.push(event); }, e => e.code === 'INVALID_RESPONSE');
  assert.deepEqual(out, []);
});
test('credential characters escaped by JSON cannot bypass result scanning in text, keys or nested values', async () => {
  for (const credential of ['synthetic-"secret', 'synthetic-\\secret']) {
    for (const result of [{ text: credential }, { text: 'safe', structured: { [credential]: 'value' } },
      { text: 'safe', structured: { nested: [credential] } }]) {
      const f = setup(); f.state.connection.credential = credential;
      const adapter = { provider: f.profile.protocol, features: [], generate: async () => result };
      await assert.rejects(new RoutedModelTransport(f.connections, [adapter]).invoke(context, request(), f.route,
        new AbortController().signal), error => error.code === 'INVALID_RESPONSE');
    }
  }
});
test('native decoded Messages and Responses reject credentials containing quotes or backslashes', async () => {
  const { AnthropicMessagesAdapter, ResponsesAdapter } = require('../apps/api/src/modules/ai-native/native-messages.adapter');
  for (const credential of ['synthetic-"secret', 'synthetic-\\secret']) {
    for (const [Adapter, raw] of [[AnthropicMessagesAdapter, { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: credential }] }],
      [ResponsesAdapter, { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: credential }] }] }]]) {
      const adapter = new Adapter({ post: async () => ({ status: 200, body: JSON.stringify(raw) }) });
      await assert.rejects(adapter.generate({ ...request(), signal: new AbortController().signal }, credential,
        { baseUrl: 'https://provider.invalid/v1' }), error => error.code === 'INVALID_RESPONSE');
    }
  }
});
test('adapter errors are sanitized rather than carrying credential messages', async () => {
  const f = setup(), adapter = { provider: f.profile.protocol, features: [], generate: async () => { throw Error('synthetic-secret'); } };
  await assert.rejects(new RoutedModelTransport(f.connections, [adapter]).invoke(context, request(), f.route, new AbortController().signal), e => e.code === 'PROVIDER_FAILED' && e.message === 'PROVIDER_FAILED');
});
test('BYOK resolver consumes actual encrypted config service and reauthorizes invoke', async () => {
  const f = setup(); let record = null; const actions = [];
  const config = new TenantModelConfigService({ authorize: async (_c, action) => { actions.push(action); }, repository: {
    read: async () => structuredClone(record), compareAndSwap: async (_t, revision, next) => { if ((record?.revision ?? 0) !== revision) return false; record = structuredClone(next); return true; }
  } }, new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY' ? 'synthetic-encryption-only-32-characters' : key === 'NODE_ENV' ? 'production' : undefined }));
  await config.save(context, { expectedRevision: 0, enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://provider.invalid/v1', model: 'selected-model', apiKey: 'synthetic-secret' });
  const selected = await config.profile(context); f.profile.credentialRef = selected.credentialRef;
  const resolver = new TenantModelConnectionResolver(config), resolved = await resolver.resolve(context, f.profile);
  assert.equal(resolved.credential, 'synthetic-secret'); assert.equal(resolved.profileFingerprint, capabilityProfileFingerprint(f.profile));
  assert.ok(actions.includes('invoke')); assert.equal(record.credentialsEncrypted.includes('synthetic-secret'), false);
  await assert.rejects(resolver.resolve({ ...context, tenantId: 'other' }, f.profile));
});
test('profile output ceiling is enforced before the protocol call', async () => {
  const f = setup(); f.state.connection.maxOutputTokens = 5;
  await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal), e => e.code === 'INVALID_REQUEST'); assert.equal(f.state.wire.length, 0);
});
test('duplicate protocol registration is refused instead of choosing by array order', () => {
  const f = setup(); assert.throws(() => new RoutedModelTransport(f.connections, [f.adapter, f.adapter]), e => e.code === 'CONFIG_INVALID');
});
test('public module composes real protocol transport with public C03 and existing lifecycle', async () => {
  const f = setup('platform_managed'), current = structuredClone(base.contexts[0]);
  current.actor = { kind: 'user', userId: context.actorId }; current.scope = { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId };
  const consumerScope = { id: 'consumer', kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId };
  const ports = require('./fixtures/ai-native/unified-dispatch.cjs')({
    routing: { resolve: async (_c, required) => ({ context: current, consumerScope, route: f.route, selection: { mode: 'platform_managed', revision: 1 }, scene: 'chat', requiredCapabilities: required }), assertCurrent: async () => {} },
    admission: { admit: async input => ({ ...input, id: 'admission-1' }), transition: async () => {} },
    usage: { reserve: async () => ({ id: 'usage-1' }), settle: async () => {}, markUnknown: async () => {} }, audit: { append: async () => {} }
  });
  const module = PublicAiGatewayModule.registerProtocols({ ports, evidence: 'mock', verifyEvidence: async () => true }, f.connections, [f.adapter], [{ sceneCode: 'order.explain', routeScene: 'chat', maxOutputTokens: 100 }]);
  const service = module.providers[0].useValue;
  const result = await service.invoke(current, { draftVersion: 'ain-c03-draft-2', requestId: 'request-1', sceneCode: 'order.explain', messages: [{ role: 'user', content: [{ kind: 'text', text: 'hello' }] }], requiredFeatures: ['text'], optionalFeatures: [], maxOutputTokens: 10 });
  assert.equal(result.status, 'completed'); assert.equal(result.text, 'answer'); assert.equal(result.actual.model, 'selected-model'); assert.equal(result.evidence, 'mock'); assert.equal(f.state.wire.length, 1);
});

// Store, Core authorization/receipt, capability and financial persistence below
// are explicit doubles. Public/Unified Gateway, original result resolver,
// Routed transport and all three protocol codecs are the actual source modules.
async function nativeCoreFixture(protocol, mode = 'tenant_managed') {
  const { createNativeModelAdapter } = require('../apps/api/src/modules/ai-native/native-model-adapters');
  const { PublicAiGatewayService } = require('../apps/api/src/modules/ai-native/public-ai-gateway.service');
  const { OriginalNativeToolResultSource } = require('../apps/api/src/modules/ai-native/model-input/original-native-tool-result.source');
  const model = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const { requestFingerprint: hash } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const f = setup(mode), current = structuredClone(base.contexts[0]);
  current.actor = { kind: 'user', userId: context.actorId }; current.scope = { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId };
  f.profile.protocol = protocol; f.profile.allowedCapabilities = ['text', 'tools'];
  f.state.connection.profileFingerprint = capabilityProfileFingerprint(f.profile);
  const call = { id: 'original_native_call', type: 'function', function: { name: 'rental_order_explain', arguments: '{"orderId":"original-order"}' } };
  let afterNativeWire;
  const http = { post: async wire => {
    f.state.wire.push(wire); const first = f.state.wire.length === 1;
    let raw;
    if (protocol === 'openai_chat_completions') raw = { choices: [{ message: { content: first ? null : 'native answer', ...(first ? { tool_calls: [call] } : {}) }, finish_reason: first ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: first ? 2 : 7, completion_tokens: 3 } };
    else if (protocol === 'openai_responses') raw = { status: 'completed', output: first
      ? [{ type: 'function_call', status: 'completed', call_id: call.id, name: call.function.name, arguments: call.function.arguments }]
      : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'native answer' }] }], usage: { input_tokens: first ? 2 : 7, output_tokens: 3 } };
    else raw = { type: 'message', role: 'assistant', stop_reason: first ? 'tool_use' : 'end_turn', content: first
      ? [{ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) }]
      : [{ type: 'text', text: 'native answer' }], usage: { input_tokens: first ? 2 : 7, output_tokens: 3 } };
    if (!first && afterNativeWire) await afterNativeWire();
    return { status: 200, body: JSON.stringify(raw) };
  } };
  const adapter = createNativeModelAdapter(protocol, { orderExplainTool: { name: call.function.name, version: 'draft-1' } }, http);
  const routed = new RoutedModelTransport(f.connections, [adapter]);
  const receipts = [], reservations = [], settled = [], abandoned = [], captured = new Map();
  const consumerScope = { id: 'consumer', kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId };
  let permitted = true, factsChanged = false, reads = 0, afterReserve, accountingFailure = false;
  const ports = require('./fixtures/ai-native/unified-dispatch.cjs')({
    routing: { resolve: async (_context, required) => ({ context: current, consumerScope, route: f.route, selection: { mode, revision: 1 }, scene: 'chat', requiredCapabilities: required }), assertCurrent: async () => {} },
    admission: { admit: async input => ({ ...input, id: `admission:${input.callId}` }), transition: async () => {} },
    usage: { reserve: async () => ({ id: 'unused' }), settle: async () => {}, markUnknown: async () => {} }, audit: { append: async () => {} }
  });
  ports.budget = {
    reserve: async value => { reservations.push(structuredClone(value)); if (afterReserve && value.request.callId === 'native-answer') await afterReserve(); return { id: `reservation:${value.request.callId}` }; },
    dispatch: async () => {}, recordUsage: async (value, id, usage) => { receipts.push({ callId: value.request.callId, id, usage }); if (accountingFailure && value.request.callId === 'native-answer') throw new ModelGatewayError('ACCOUNTING_PENDING'); },
    settle: async value => { settled.push(value.request.callId); }, abandon: async value => { abandoned.push(value.request.callId); }
  };
  const visible = result => { const publicResult = { ...result }; delete publicResult.nativeToolCalls; return publicResult; };
  ports.transport = {
    invoke: async (...args) => { const result = await routed.invoke(...args);
      assert.deepEqual(result.nativeToolCalls, [call]);
      captured.set(args[1].callId, { call: structuredClone(result.nativeToolCalls[0]), inputHash: hash(result.toolRequests[0]) });
      return visible(result); },
    invokeNativeToolResult: async (...args) => visible(await routed.invokeNativeToolResult(...args)),
    nativeInputBoundHash: routed.nativeInputBoundHash.bind(routed),
    inputBoundHash: request => { assert.notEqual(request.callId, 'native-answer', 'Never count a native result through the text fallback'); return undefined; },
    stream: routed.stream.bind(routed)
  };
  const policy = { sceneCode: 'order.explain', routeScene: 'chat', maxOutputTokens: 100, orderExplainTool: true, nativeToolResults: true };
  const { routeScene: _routeScene, ...taskPolicy } = policy;
  const runtime = { ports, evidence: 'mock', verifyEvidence: async () => true };
  const firstIntent = { draftVersion: 'ain-c03-draft-2', requestId: 'model-original', sceneCode: policy.sceneCode,
    messages: [{ role: 'user', content: [{ kind: 'text', text: 'Read the original order' }] }], requiredFeatures: ['text', 'tools'], optionalFeatures: [], maxOutputTokens: 10 };
  const first = await new PublicAiGatewayService(runtime, [policy]).invoke(current, firstIntent);
  assert.equal(first.status, 'completed'); assert.equal(first.toolRequests.length, 1);
  assert.equal(JSON.stringify(first).includes(call.id), false); assert.equal(captured.size, 1);
  const reference = { referenceVersion: 'ain-tool-result-reference-1', taskId: 'original-task', runId: 'original-run', modelRegistrationRef: 'original-model', toolRegistrationRef: 'original-read', callIndex: 0 };
  const candidate = first.toolRequests[0];
  const frozen = { mode: 'invoke', intent: firstIntent, configuration: first.actual, priceVersion: 'fixture-price-version', routingHash: 'a'.repeat(64), identityHash: model.taskModelIdentity(current) };
  const fingerprint = model.taskModelFingerprint(frozen, taskPolicy);
  const facts = { requestId: 'original-read', audience: current.audience, scope: current.scope, observedAt: base.time,
    order: { id: candidate.input.orderId, status: 'ORIGINAL_CORE_FACT', retained: 'x'.repeat(33000) }, sources: [{ resourceId: candidate.input.orderId, observedAt: base.time, basis: { kind: 'snapshot', version: 'original' } }] };
  const artifact = { resultId: 'original-core-result', runId: reference.runId, stepId: 'read-step', actionId: 'read-action', status: 'succeeded', completeMeasurement: true, payload: facts, contentHash: hash(facts) };
  const source = new OriginalNativeToolResultSource({
    db: { aiTask: { findFirst: async () => ({ id: reference.taskId, scopeId: 'consumer' }) },
      aiTaskActionInput: { findFirst: async query => query.where.registrationRef === reference.modelRegistrationRef
        ? { id: 'model-input', scopeId: 'consumer', toolCode: model.TASK_TEXT_MODEL_TOOL, payload: frozen, fingerprint }
        : { id: 'read-input', toolCode: 'rental.order.explain' } },
      aiStep: { findFirst: async query => query.where.inputRef === 'model-input' ? { id: 'model-step', sequence: 1, resultRef: 'original-model-result' }
        : { id: artifact.stepId, sequence: 2, resultRef: artifact.resultId, actionId: artifact.actionId, requestFingerprint: hash(candidate) } } },
    tasks: { resolveAccess: async () => ({ where: { id: reference.taskId }, bindingKey: 'original-access' }) },
    execution: { authorize: async () => current }, policy: taskPolicy,
    task: { taskId: reference.taskId, runId: reference.runId, modelRegistrationRef: reference.modelRegistrationRef, orderRegistrationRef: reference.toolRegistrationRef },
    modelEvidence: { readCompletedEvidence: async () => ({ artifact: { id: 'original-model-result', contentHash: hash(first), payload: first }, evidence: { invocationId: 'original-invocation' } }) },
    toolInputs: { readReadonlyResultInput: async () => ({ context: current, input: candidate, inputRef: 'read-input', fingerprint: hash(candidate), registrationRef: reference.toolRegistrationRef }) },
    toolResults: { read: async () => structuredClone(artifact) },
    reopenBusinessSource: async () => { reads++; if (!permitted) throw new ModelGatewayError('FORBIDDEN'); const value = structuredClone(facts); if (factsChanged) value.order.status = 'CHANGED'; return { facts: value }; },
    bindings: { readOriginal: async () => ({ invocationId: 'original-invocation', callIndex: 0, configurationHash: hash(first.actual), bindingHash: 'b'.repeat(64), ...captured.get(firstIntent.requestId) }) },
    routing: ports.routing
  });
  ports.nativeToolResults = source;
  const nextIntent = { ...firstIntent, requestId: 'native-answer', messages: [{ role: 'user', content: [{ kind: 'tool_result_reference', reference }] }] };
  const nativeRequest = { callId: nextIntent.requestId, model: f.profile.model, messages: [{ role: 'user', content: 'Read the original order' }], features: ['tools'], maxOutputTokens: 10 };
  const resolved = await source.resolve(context, reference, new AbortController().signal);
  return { f, first, adapter, routed, runtime, policy, current, nextIntent, nativeRequest, resolved, source, facts,
    receipts, reservations, settled, abandoned, captured, call, hash, reads: () => reads,
    setAfterReserve: value => { afterReserve = value; }, setAfterNativeWire: value => { afterNativeWire = value; },
    revoke: () => { permitted = false; }, changeFacts: () => { factsChanged = true; }, failAccounting: () => { accountingFailure = true; },
    invoke: () => new PublicAiGatewayService(runtime, [policy]).invoke(current, nextIntent) };
}

test('native core three protocols consume original R0 receipts through two independent Gateway calls and one ledger', async () => {
  for (const protocol of ['openai_chat_completions', 'openai_responses', 'anthropic_messages']) for (const mode of ['platform_managed', 'tenant_managed']) {
    const f = await nativeCoreFixture(protocol, mode), result = await f.invoke();
    assert.equal(result.status, 'completed'); assert.equal(result.text, 'native answer'); assert.equal(result.evidence, 'mock');
    assert.equal(f.f.state.wire.length, 2); assert.equal(f.reservations.length, 2);
    assert.deepEqual(f.receipts.map(value => value.callId), ['model-original', 'native-answer']);
    assert.deepEqual(f.receipts.map(value => value.usage), [{ inputTokens: 2, outputTokens: 3 }, { inputTokens: 7, outputTokens: 3 }]);
    assert.deepEqual(f.settled, ['model-original', 'native-answer']); assert.deepEqual(f.abandoned, []); assert.ok(f.reads() > 2);
    const wire = JSON.parse(f.f.state.wire[1].body), expectedJson = JSON.stringify(f.facts);
    assert.equal(f.reservations[1].request.countRequestHash, f.routed.nativeInputBoundHash(f.nativeRequest, f.f.route, f.resolved));
    if (protocol === 'openai_chat_completions') {
      assert.deepEqual(wire.messages.at(-2), { role: 'assistant', content: null, tool_calls: [f.call] });
      assert.deepEqual(wire.messages.at(-1), { role: 'tool', tool_call_id: f.call.id, content: expectedJson });
    } else if (protocol === 'openai_responses') {
      assert.deepEqual(wire.input.at(-2), { type: 'function_call', call_id: f.call.id, name: f.call.function.name, arguments: f.call.function.arguments });
      assert.deepEqual(wire.input.at(-1), { type: 'function_call_output', call_id: f.call.id, output: expectedJson });
    } else {
      assert.deepEqual(wire.messages.at(-2), { role: 'assistant', content: [{ type: 'tool_use', id: f.call.id, name: f.call.function.name, input: JSON.parse(f.call.function.arguments) }] });
      assert.deepEqual(wire.messages.at(-1), { role: 'user', content: [{ type: 'tool_result', tool_use_id: f.call.id, content: expectedJson }] });
    }
    assert.equal(JSON.stringify(result).includes(f.call.id), false); assert.equal(JSON.stringify(result).includes('ORIGINAL_CORE_FACT'), false);
    assert.equal(f.f.state.wire[1].body.includes('sourceInvocationId'), false); assert.equal(wire.previous_response_id, undefined);
  }
});

test('native core rejects changed authority input bindings missing real methods and unknown without replay', async () => {
  for (const protocol of ['openai_chat_completions', 'openai_responses', 'anthropic_messages']) {
    const f = await nativeCoreFixture(protocol), signal = new AbortController().signal;
    for (const change of [value => { value.call.id = 'different_call'; }, value => { value.resultJson = '{"changed":true}'; }]) {
      const altered = structuredClone(f.resolved); change(altered);
      assert.notEqual(f.adapter.nativeInputBoundHash(f.nativeRequest, altered), f.adapter.nativeInputBoundHash(f.nativeRequest, f.resolved));
      await assert.rejects(f.routed.invokeNativeToolResult(context, f.nativeRequest, f.f.route, signal, altered, undefined,
        f.adapter.nativeInputBoundHash(f.nativeRequest, f.resolved)), { code: 'CONFIG_INVALID' });
    }
    await assert.rejects(f.routed.invokeNativeToolResult(context, { ...f.nativeRequest, messages: [{ role: 'user', content: 'unbound history' }] }, f.f.route, signal, f.resolved), { code: 'INVALID_REQUEST' });
    const marker = { provider: protocol, features: ['tools'], supportsNativeToolResults: true, generate: async () => assert.fail('No ordinary fallback') };
    await assert.rejects(new RoutedModelTransport(f.f.connections, [marker]).invokeNativeToolResult(context, f.nativeRequest, f.f.route, signal, f.resolved), { code: 'CAPABILITY_UNSUPPORTED' });
    assert.equal(f.f.state.wire.length, 1);
    f.setAfterReserve(f.revoke);
    const denied = await f.invoke(); assert.equal(denied.status, 'failed'); assert.equal(f.f.state.wire.length, 1);
    for (const outcome of ['changed-after-wire', 'usage-write-unknown']) {
      const g = await nativeCoreFixture(protocol);
      if (outcome === 'changed-after-wire') g.setAfterNativeWire(g.changeFacts); else g.failAccounting();
      const unknown = await g.invoke(); assert.equal(unknown.status, 'unknown'); assert.equal(unknown.error.retryable, false);
      assert.equal(g.f.state.wire.length, 2); assert.equal(g.receipts.filter(value => value.callId === 'native-answer').length, 1);
      assert.equal(g.settled.includes('native-answer'), false); assert.ok(g.abandoned.includes('native-answer'));
      assert.equal(JSON.stringify(unknown).includes(g.call.id), false);
    }
  }
});

test('native private call retention preserves existing format-only public tool results', async () => {
  const { createNativeModelAdapter } = require('../apps/api/src/modules/ai-native/native-model-adapters');
  for (const protocol of ['openai_chat_completions', 'openai_responses', 'anthropic_messages']) {
    const f = setup('platform_managed'), current = structuredClone(base.contexts[0]);
    current.actor = { kind: 'user', userId: context.actorId }; current.scope = { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId };
    f.profile.protocol = protocol; f.state.connection.profileFingerprint = capabilityProfileFingerprint(f.profile);
    const call = { id: 'format_only_private_call', type: 'function', function: { name: 'rental_order_explain', arguments: '{"orderId":"original-order"}' } };
    const raw = protocol === 'openai_chat_completions' ? { choices: [{ message: { content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }
      : protocol === 'openai_responses' ? { status: 'completed', output: [{ type: 'function_call', status: 'completed', call_id: call.id, name: call.function.name, arguments: call.function.arguments }], usage: { input_tokens: 2, output_tokens: 3 } }
        : { type: 'message', role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: call.id, name: call.function.name, input: JSON.parse(call.function.arguments) }], usage: { input_tokens: 2, output_tokens: 3 } };
    const adapter = createNativeModelAdapter(protocol, { orderExplainTool: { name: call.function.name, version: 'draft-1' } },
      { post: async wire => { f.state.wire.push(wire); return { status: 200, body: JSON.stringify(raw) }; } });
    const consumerScope = { id: 'consumer', kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId };
    const ports = require('./fixtures/ai-native/unified-dispatch.cjs')({
      routing: { resolve: async (_c, required) => ({ context: current, consumerScope, route: f.route, selection: { mode: 'platform_managed', revision: 1 }, scene: 'chat', requiredCapabilities: required }), assertCurrent: async () => {} },
      admission: { admit: async value => ({ ...value, id: 'format-only-admission' }), transition: async () => {} },
      usage: { reserve: async () => ({ id: 'format-only-reservation' }), settle: async () => {}, markUnknown: async () => {} }, audit: { append: async () => {} }
    });
    const module = PublicAiGatewayModule.registerProtocols({ ports, evidence: 'mock', verifyEvidence: async () => true }, f.connections, [adapter],
      [{ sceneCode: 'order.explain', routeScene: 'chat', maxOutputTokens: 100, orderExplainTool: true }]);
    const result = await module.providers[0].useValue.invoke(current, { draftVersion: 'ain-c03-draft-2', requestId: 'format-only', sceneCode: 'order.explain', messages: [{ role: 'user', content: [{ kind: 'text', text: 'hello' }] }], requiredFeatures: ['text', 'tools'], optionalFeatures: [], maxOutputTokens: 10 });
    assert.equal(result.status, 'completed'); assert.deepEqual(result.toolRequests[0].input, { orderId: 'original-order' });
    assert.equal(JSON.stringify(result).includes(call.id), false); assert.equal(f.state.wire.length, 1);
  }
});

async function nativeCountingFixture(mode = 'tenant_managed', missingNative = false) {
  const f = await nativeCoreFixture('anthropic_messages', mode);
  const { InputCountTokensService } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.service');
  const { PrismaCountTokensReceipts } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.receipt');
  const { PrismaGatewayPricingRecords } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-pricing-records');
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  const { nativeToolResultIntentFingerprint } = require('../apps/api/src/modules/ai-native/model-input/native-tool-result.ports');
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const now = new Date(), expiry = new Date(now.getTime() + 600000), scope = { id: 'consumer', ...aiPersistenceScopeColumns(f.current.scope) };
  const owner = { id: f.f.profile.scopeId, ...aiPersistenceScopeColumns(f.first.actual.configurationScope) };
  const { routeScene: _route, ...policy } = f.policy;
  const invocation = { id: 'native-answer-invocation', scopeId: scope.id, actorId: context.actorId,
    taskId: f.resolved.reference.taskId, runId: f.resolved.reference.runId, stepId: 'native-answer-step', actionId: 'native-answer-action',
    callId: f.nextIntent.requestId, registrationHash: 'c'.repeat(64), intentHash: nativeToolResultIntentFingerprint(f.nextIntent, policy),
    configurationHash: f.hash(f.first.actual), configuration: f.first.actual, priceVersion: 'fixture-model-price',
    maxOutputTokens: 10, sceneCode: f.nextIntent.sceneCode, expiresAt: expiry };
  const store = createTaskInputStore({ aiScope: [scope, owner], aiGatewayInvocation: [invocation], aiProviderProfile: [f.f.profile],
    aiGatewayPriceRecord: [], aiGatewayInputBoundRecord: [], aiBudgetReservation: [], aiBudgetLedgerEntry: [], operationLog: [] });
  const prices = new PrismaGatewayPricingRecords(store.db);
  // Synthetic price validity only. This does not claim an actual supplier rate,
  // platform financial grant or certified live counting evidence.
  const price = { kind: 'gateway-price-1', priceVersion: invocation.priceVersion, configuration: invocation.configuration,
    usageClass: 'plain_text_input_output_tokens', additionalBillingDimensions: 'none', validFrom: new Date(now.getTime() - 1000).toISOString(), expiresAt: expiry.toISOString(),
    billing: mode === 'tenant_managed' ? { unit: 'tokens', metric: 'input_plus_output', scale: 0, rounding: 'exact' }
      : { unit: 'money', currency: 'CNY', scale: 6, inputPerMillion: '1.000000', outputPerMillion: '1.000000', rounding: 'ceil_total_micro_units' },
    provenance: { reference: 'fixture-price', revision: '1', documentHash: 'd'.repeat(64) } };
  store.state.aiGatewayPriceRecord.push({ id: prices.priceId(scope.id, invocation.configurationHash, price.priceVersion), scopeId: scope.id,
    configurationHash: invocation.configurationHash, priceVersion: price.priceVersion, sourceReference: price.provenance.reference, payload: price, payloadHash: f.hash(price) });
  const receipts = new PrismaCountTokensReceipts(store.db), events = [], wires = [];
  let afterDispatch, afterWire;
  const read = (id, association) => { const row = store.state.aiBudgetReservation.find(row => row.id === id); if (row) assert.deepEqual(row.association, association); return row ? structuredClone(row) : null; };
  const settle = async (id, association, _key, reference) => {
    const receipt = await receipts.read(reference); assert.equal(receipt.state, 'observed');
    assert.deepEqual(receipt.admission.reservationId, id); read(id, association);
    store.state.aiBudgetReservation[0].status = 'settled'; events.push({ kind: 'count.settled', calls: 1 });
    return read(id, association);
  };
  const budget = { reserve: async command => {
    events.push({ kind: 'count.reserved' }); const a = command.association;
    const prior = store.state.aiBudgetReservation.find(row => row.callId === command.callId); if (prior) return structuredClone(prior);
    const row = { id: 'native-count-reservation', scopeId: scope.id, scopeKind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId,
      actorId: context.actorId, callId: command.callId, requestId: a.requestId, idempotencyKey: a.idempotencyKey, runId: a.runId, stepId: a.stepId, actionId: a.actionId,
      sceneCode: command.sceneCode, priceVersion: a.priceVersion, unitKind: 'calls', configurationHash: f.hash(a.config), configRevision: a.config.configRevision,
      reservedCalls: 1, reservedTokens: null, reservedMoney: null, moneyCurrency: null, status: 'reserved', dispatchState: 'not_dispatched',
      reserved: { unit: 'calls', value: 1 }, dispatched: false, association: structuredClone(a) };
    store.state.aiBudgetReservation.push(row); return structuredClone(row);
  }, read: async (id, association) => read(id, association), dispatch: async (id, association) => {
    read(id, association); store.state.aiBudgetReservation[0].dispatched = true; store.state.aiBudgetReservation[0].dispatchState = 'dispatched'; events.push({ kind: 'count.dispatched' });
    if (afterDispatch) await afterDispatch(); return read(id, association);
  }, settle, reconcile: settle, release: async () => assert.fail('No automatic release'),
    markUnknown: async (id, association) => { read(id, association); store.state.aiBudgetReservation[0].status = 'pending_reconciliation'; return read(id, association); } };
  const frozen = { scopeId: scope.id, actorId: context.actorId, context: f.current, invocation, intent: f.nextIntent, configuration: f.first.actual };
  const dependencies = { db: store.db, scopes: { resolveCurrent: async () => ({ scope, context: f.current }) },
    authorization: { authorize: async () => assert.fail('Task counting must not borrow settings authority'), authorizeObservation: async () => f.current },
    taskExecution: { authorize: async taskId => { assert.equal(taskId, invocation.taskId); return f.current; } }, budget,
    frozen: { readFrozenCountingInput: async () => structuredClone(frozen) }, resolvers: f.f.connections,
    transport: { post: async value => { wires.push(value); if (afterWire) await afterWire(); return { status: 200, body: '{"input_tokens":7}' }; } },
    policyOptions: { orderExplainTool: { name: 'rental_order_explain', version: 'draft-1' } },
    countingPriceVersion: 'fixture-count-price', ...(missingNative ? {} : { nativeToolResults: f.source }), clock: () => now };
  const service = new InputCountTokensService(dependencies);
  return { f, service, dependencies, frozen, prices, price, store, receipts, events, wires,
    setAfterDispatch: value => { afterDispatch = value; }, setAfterWire: value => { afterWire = value; } };
}

function nativeApiCountingSource(h, afterCreate) {
  const { composeRequestNativeCountingSource } = require('../apps/api/src/modules/ai-native/input-counting/input-counting-request.factory');
  const { routeScene: _route, ...scenePolicy } = h.f.policy;
  let active = true, current = h.f.current, creations = 0;
  const guard = { canActivate: async () => assert.fail('Bridge must reuse, not invoke a fabricated Guard') };
  const credentials = { current: async () => {
    if (!active) throw new ModelGatewayError('FORBIDDEN');
    return { authorization: 'Bearer synthetic-count-only', audience: 'operator', requestId: 'fixture-count-request' };
  } };
  const source = composeRequestNativeCountingSource({
    create: async input => {
      creations++; assert.equal(input.db, h.store.db); assert.equal(input.guard, guard);
      assert.equal(input.credentials, credentials);
      assert.equal(input.execution, h.dependencies.taskExecution);
      assert.deepEqual(input.reference, h.f.resolved.reference);
      assert.equal(input.scenePolicy.nativeToolResults, true);
      if (afterCreate) await afterCreate();
      return h.f.source;
    },
    request: { db: h.store.db, guard, credentials, execution: h.dependencies.taskExecution,
      taskAuthority: { resolve: async taskId => { assert.equal(taskId, h.frozen.invocation.taskId); return h.f.current; } },
      scenePolicy, clock: h.dependencies.clock },
    task: { id: () => h.frozen.invocation.taskId, resolve: async () => structuredClone(current) }, active: () => active
  });
  return { source, creations: () => creations, close: () => { active = false; },
    changeIdentity: () => { current = { ...current, actor: { ...current.actor, userId: 'different-request-actor' } }; } };
}

test('native counted input uses original Core result and matches generation wire in both modes', async () => {
  const { CountTokensGatewayPricingEvidenceSource } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.composition');
  const { countTokensMaterialHash, prepareCountTokensMaterial, messagesGenerationInputHash } = require('../apps/api/src/modules/ai-native/input-counting/count-tokens.protocol');
  const { ChatProtocolPolicy } = require('../apps/api/src/modules/ai-native/chat-completions.adapter');
  for (const mode of ['platform_managed', 'tenant_managed']) {
    const h = await nativeCountingFixture(mode), bridge = nativeApiCountingSource(h);
    assert.equal(bridge.creations(), 0, 'Request-local native source must be inert before frozen selection');
    const service = new (require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.service').InputCountTokensService)({ ...h.dependencies, nativeToolResults: bridge.source });
    const result = await service.taskCount({ invocationId: h.frozen.invocation.id });
    assert.equal(bridge.creations(), 1);
    assert.equal(result.state, 'observed'); assert.equal(result.inputTokens, 7); assert.equal(result.admission.status, 'settled');
    assert.equal(h.wires.length, 1); assert.equal(h.wires[0].url, 'https://provider.invalid/v1/messages/count_tokens');
    const body = JSON.parse(h.wires[0].body); assert.deepEqual(body.messages.at(-1), { role: 'user', content: [{ type: 'tool_result', tool_use_id: h.f.call.id, content: JSON.stringify(h.f.facts) }] });
    const pricing = new CountTokensGatewayPricingEvidenceSource(h.store.db), binding = { invocationId: h.frozen.invocation.id, scopeId: 'consumer',
      registrationHash: h.frozen.invocation.registrationHash, intentHash: h.frozen.invocation.intentHash, configurationHash: h.frozen.invocation.configurationHash,
      priceVersion: h.price.priceVersion, priceHash: h.f.hash(h.price), maxOutputTokens: 10 };
    const bound = await pricing.readInputBound(result.reference, h.f.current, binding);
    assert.equal(bound.countRequestHash, h.f.routed.nativeInputBoundHash(h.f.nativeRequest, h.f.f.route, h.f.resolved));
    assert.equal(bound.maxInputTokens, 7); assert.equal(bound.countRequestHash, countTokensMaterialHash({ body: h.wires[0].body, pathname: '/messages/count_tokens' }));
    const answer = await h.f.invoke(); assert.equal(answer.status, 'completed'); assert.equal(h.f.f.state.wire.length, 2);
    assert.equal(h.f.reservations[1].request.countRequestHash, bound.countRequestHash);
    const original = await new (require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.service').InputCountTokensService)({ ...h.dependencies, nativeToolResults: undefined, frozen: undefined, resolvers: undefined, transport: undefined }).readCountReceipt({ invocationId: h.frozen.invocation.id });
    assert.equal(original.inputTokens, 7); assert.equal(h.wires.length, 1);
    assert.equal(h.events.filter(value => value.kind === 'count.dispatched').length, 1); assert.equal(h.events.filter(value => value.kind === 'count.settled').length, 1);
    assert.equal(JSON.stringify(result).includes(h.f.call.id), false); assert.equal(JSON.stringify(bound).includes('ORIGINAL_CORE_FACT'), false);
  }
  // The existing ordinary text count binding is not changed by native support.
  const input = { ...request(), features: ['tools'] }, policy = new ChatProtocolPolicy({ orderExplainTool: { name: 'rental_order_explain', version: 'draft-1' } });
  const material = prepareCountTokensMaterial(input, policy);
  assert.equal(messagesGenerationInputHash(JSON.stringify({ ...JSON.parse(material.body), stream: false, max_tokens: 10 })), countTokensMaterialHash(material));
});

test('original count receipt survives revoked delivery, late response and a lost storage reply in both modes', async () => {
  const { InputCountTokensService } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.service');
  const tick = () => new Promise(resolve => setImmediate(resolve));
  for (const mode of ['platform_managed', 'tenant_managed']) for (const window of ['facts-changed', 'configuration-changed', 'cancelled-response', 'late-response', 'unreadable-write-reply']) {
    const h = await nativeCountingFixture(mode), controller = new AbortController();
    let current = true, release, entered, writes = 0;
    const ready = new Promise(resolve => { entered = resolve; });
    const resolver = h.f.f.connections[mode === 'platform_managed' ? 'platform' : 'tenant'];
    const dependencies = { ...h.dependencies, resolvers: { ...h.dependencies.resolvers,
      [mode === 'platform_managed' ? 'platform' : 'tenant']: { ...resolver,
        assertCurrent: async () => { if (!current) throw new ModelGatewayError('CONFIG_INVALID'); } } } };
    const create = h.store.db.operationLog.create, read = h.store.db.operationLog.findUnique;
    h.store.db.operationLog.create = async query => {
      if (query.data.action === 'ai.model.count_tokens') writes++;
      return create(query);
    };
    if (window === 'facts-changed') h.setAfterWire(h.f.changeFacts);
    if (window === 'configuration-changed') h.setAfterWire(() => { current = false; });
    if (window === 'cancelled-response') h.setAfterWire(() => controller.abort());
    if (window === 'unreadable-write-reply') h.store.db.operationLog.findUnique = async query => {
      if (writes) throw Error('Synthetic receipt acknowledgement unavailable');
      return read(query);
    };
    if (window === 'late-response') dependencies.transport = { post: async value => {
      h.wires.push(value); entered(); return new Promise(resolve => { release = resolve; });
    } };
    const service = new InputCountTokensService(dependencies);
    const result = service.taskCount({ invocationId: h.frozen.invocation.id }, controller.signal);
    if (window === 'late-response') {
      await ready; controller.abort();
      await assert.rejects(result, { code: 'PENDING_RECONCILIATION' });
      assert.equal(writes, 0, 'An unanswered original must not acquire a fabricated terminal receipt');
      release({ status: 200, body: '{"input_tokens":7}' });
    } else await assert.rejects(result, { code: 'PENDING_RECONCILIATION' });
    await tick(); await tick();
    assert.equal(writes, 1); assert.equal(h.wires.length, 1);
    const rows = h.store.state.operationLog.filter(row => row.action === 'ai.model.count_tokens');
    assert.equal(rows.length, 1); const receipt = rows[0].detail;
    assert.equal(receipt.state, 'observed'); assert.equal(receipt.inputTokens, 7);
    assert.equal(receipt.callId, h.frozen.invocation.callId); assert.equal(receipt.invocationId, h.frozen.invocation.id);
    assert.equal(receipt.admission.reservationId, 'native-count-reservation');
    assert.equal(JSON.stringify(receipt).includes('ORIGINAL_CORE_FACT'), false);
    assert.equal(JSON.stringify(receipt).includes('synthetic-secret'), false);
    assert.equal(h.events.filter(event => event.kind === 'count.reserved').length, 1);
    assert.equal(h.events.filter(event => event.kind === 'count.settled').length, 0);
    assert.equal(h.store.state.aiBudgetReservation[0].status, 'reserved');
    h.store.db.operationLog.findUnique = read;
    const history = new InputCountTokensService({ ...h.dependencies, frozen: undefined, resolvers: undefined,
      transport: undefined, nativeToolResults: undefined, taskExecution: undefined });
    const observed = await history.readCountReceipt({ invocationId: h.frozen.invocation.id });
    assert.equal(observed.inputTokens, 7); assert.equal(observed.textDispatch, 'not_attested');
    assert.equal(observed.executionPermission, false); assert.equal(writes, 1); assert.equal(h.wires.length, 1);
    assert.equal(h.f.f.state.wire.length, 1, 'No new generation or replacement count follows revoked delivery');
  }
});

test('native counting fails closed on absent evidence and changed originals while factory requires real codec methods', async () => {
  const { createNativeModelAdapter } = require('../apps/api/src/modules/ai-native/native-model-adapters');
  for (const protocol of ['openai_chat_completions', 'openai_responses', 'anthropic_messages']) {
    const transport = { post: async () => assert.fail('Registry inspection cannot dispatch') };
    const adapter = createNativeModelAdapter(protocol, { orderExplainTool: { name: 'rental_order_explain', version: 'draft-1' }, nativeToolResults: true }, transport);
    assert.equal(adapter.supportsNativeToolResults, true); assert.equal(typeof adapter.generateNativeToolResult, 'function');
    assert.throws(() => createNativeModelAdapter(protocol, { nativeToolResults: true }, transport), { code: 'CAPABILITY_UNSUPPORTED' });
  }
  const missing = await nativeCountingFixture('tenant_managed', true);
  await assert.rejects(missing.service.taskCount({ invocationId: missing.frozen.invocation.id }), { code: 'UNAVAILABLE' });
  assert.deepEqual(missing.events, []); assert.deepEqual(missing.wires, []);
  for (const timing of ['before-dispatch', 'after-wire']) {
    const h = await nativeCountingFixture();
    if (timing === 'before-dispatch') h.setAfterDispatch(h.f.changeFacts); else h.setAfterWire(h.f.changeFacts);
    await assert.rejects(h.service.taskCount({ invocationId: h.frozen.invocation.id }), { code: 'PENDING_RECONCILIATION' });
    assert.equal(h.wires.length, timing === 'after-wire' ? 1 : 0); assert.equal(h.events.filter(value => value.kind === 'count.dispatched').length, 1);
    assert.equal(h.events.filter(value => value.kind === 'count.settled').length, 0);
    const receipts = h.store.state.operationLog.filter(row => row.action === 'ai.model.count_tokens');
    assert.equal(receipts.length, timing === 'after-wire' ? 1 : 0);
    if (timing === 'after-wire') { assert.equal(receipts[0].detail.state, 'observed'); assert.equal(receipts[0].detail.inputTokens, 7); }
    const observation = await h.service.observeCountKey({ callId: h.frozen.invocation.callId });
    assert.deepEqual(observation.lifecycle, timing === 'after-wire' ? { receiptRecorded: 'observed' } : 'claimed_dispatched');
    assert.equal(h.wires.length, timing === 'after-wire' ? 1 : 0);
    assert.equal(h.f.f.state.wire.length, 1, 'Do not start generation after current input was revoked');
  }
  for (const outcome of ['closed-before', 'different-task', 'identity-during-create', 'cancel-during-create', 'invalid-methods', 'closed-after']) {
    const h = await nativeCountingFixture(), controller = new AbortController();
    const bridge = nativeApiCountingSource(h, async () => {
      if (outcome === 'identity-during-create') bridge.changeIdentity();
      if (outcome === 'cancel-during-create') controller.abort();
      if (outcome === 'invalid-methods') h.f.source = { resolve: async () => h.f.resolved };
    });
    const reference = structuredClone(h.f.resolved.reference);
    if (outcome === 'closed-before') bridge.close();
    if (outcome === 'different-task') reference.taskId = 'another-original-task';
    if (outcome === 'closed-after') {
      const value = await bridge.source.resolve(context, reference, controller.signal);
      bridge.close();
      await assert.rejects(bridge.source.assertCurrent(context, value, controller.signal), { code: 'FORBIDDEN' });
    } else {
      await assert.rejects(bridge.source.resolve(context, reference, controller.signal),
        { code: outcome === 'cancel-during-create' ? 'CANCELLED' : outcome === 'invalid-methods' ? 'CONFIG_INVALID' : 'FORBIDDEN' }, outcome);
    }
    assert.equal(bridge.creations(), ['closed-before', 'different-task'].includes(outcome) ? 0 : 1);
    assert.deepEqual(h.events, []); assert.deepEqual(h.wires, []);
    assert.equal(h.f.f.state.wire.length, 1);
  }
  const { InputCountingRequestFactory } = require('../apps/api/src/modules/ai-native/input-counting/input-counting-request.factory');
  const server = { db: { $transaction: async () => assert.fail('No factory IO'), aiScope: { findFirst: async () => null } },
    auth: { resolveAccessContext: async () => assert.fail('No factory IO') }, guard: { canActivate: async () => assert.fail('No factory IO') },
    subscriptions: { readCategoryCommercialContext: async () => assert.fail('No factory IO') },
    configuration: { sceneCode: 'order.explain', countingPriceVersion: 'count-price', sceneMaxOutputTokens: 10,
      toolPolicy: { orderExplainTool: { name: 'rental_order_explain', version: 'draft-1' } }, nativeToolResults: true } };
  assert.doesNotThrow(() => new InputCountingRequestFactory(server), 'Absent native source must not block original receipt hosts');
  assert.throws(() => new InputCountingRequestFactory({ ...server, nativeToolResultsForRequest: {} }), { code: 'UNAVAILABLE' });
  assert.throws(() => new InputCountingRequestFactory({ ...server, configuration: { ...server.configuration, nativeToolResults: 'true' } }), { code: 'UNAVAILABLE' });
});

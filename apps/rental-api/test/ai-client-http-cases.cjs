'use strict';
/** Twelve selected methods per client channel, using real Nest metadata and the
 * original Controller. The application fixture only reads fixed receipts;
 * refusal audit storage is in memory. The parent owns loading/offline cleanup. */
module.exports = async function runCases({ t }) {
  const assert = require('node:assert/strict');
  const { EventEmitter } = require('node:events');
  const { MetadataScanner } = require('@nestjs/core/metadata-scanner');
  const { PATH_METADATA, METHOD_METADATA, HTTP_CODE_METADATA, HEADERS_METADATA,
    ROUTE_ARGS_METADATA, SELF_DECLARED_DEPS_METADATA } = require('@nestjs/common/constants');
  const { RequestMethod } = require('@nestjs/common');
  const shared = require('@rental-os/shared');
  const { AiClientEntryController } = require('@rental-os/ai-native-server/runtime/scenes/client-entry.controller');
  const { AiClientEntryError } = require('@rental-os/ai-native-server/runtime/scenes/client-entry-action');
  const { recordClientEntryRefusal } = require('@rental-os/ai-native-server/runtime/scenes/client-entry.audit');
  const { AI_WEBSITE_ENTRY, AI_WECHAT_ENTRY, WebsiteClientEntryController, WechatClientEntryController } =
    require('@rental-os/ai-native-server/runtime/scenes/standard-client-entry.application');
  const { RentalWebsiteClientEntryController, RentalWechatClientEntryController } = require('../src/ai-client-http.ts');
  const methods = ['prepareOrderMaterial', 'readOrderMaterialReceipt', 'createTask', 'readTaskCreation'];
  const executionMethods = ['startTaskModel', 'submitTaskInput', 'continueTaskInput', 'recoverTaskModel',
    'reconcileTaskModel', 'readTaskInput', 'readTaskInputReceipt', 'readTaskModelResult'];
  const mountedMethods = [...methods, ...executionMethods];
  const channels = [
    { Controller: RentalWebsiteClientEntryController, original: WebsiteClientEntryController, token: AI_WEBSITE_ENTRY,
      prefix: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath, channel: 'web' },
    { Controller: RentalWechatClientEntryController, original: WechatClientEntryController, token: AI_WECHAT_ENTRY,
      prefix: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath, channel: 'wechat_miniprogram' }
  ];
  const material = Object.freeze({ materialRef: '11111111-1111-4111-8111-111111111111', materialHash: 'a'.repeat(64),
    expiresAt: '2099-01-01T00:00:00.000Z' });
  const materialCommand = Object.freeze({ operationKey: 'read-original-material', orderId: 'order-original' });
  const taskCommand = Object.freeze({ creationKey: 'original-task-creation', materialRef: material.materialRef });
  const task = Object.freeze({ state: 'observed', inputRef: '22222222-2222-4222-8222-222222222222', inputHash: 'b'.repeat(64),
    task: Object.freeze({ taskId: 'task-original', runId: 'run-original', status: 'queued', revision: 1, replayed: true }) });
  const command = name => name.includes('Material') ? materialCommand : taskCommand;
  const receipt = shared.aiClientOrderMaterialReceiptSchema.parse({ contractVersion: shared.AI_CLIENT_MATERIAL_RECEIPT_VERSION,
    operationKey: materialCommand.operationKey, state: 'observed', ...material, execution: 'not_attested',
    freshness: 'revalidate_before_execution', retryable: false, nextAction: 'read_original_material_receipt' });
  const expectedNext = name => name.includes('Material') ? 'read_original_material_receipt' : 'read_original_task_creation';
  const request = () => Object.assign(new EventEmitter(), { headers: { authorization: 'Bearer offline-http-fixture',
    'x-user-assertion': 'must-not-forward' }, ip: '192.0.2.1', body: { untrusted: true },
    res: Object.assign(new EventEmitter(), { writableFinished: false, destroyed: false }) });
  const projected = req => ({ headers: { authorization: req.headers.authorization }, ip: req.ip });

  function fixture(channel) {
    const state = { calls: [], observations: [], logs: [] };
    const store = { operationLog: { async create({ data }) {
      if (state.auditFailure) throw Error('private-audit-storage-failure');
      state.logs.push(structuredClone(data)); return { id: 'audit-original' };
    } } };
    const identity = { tenantId: 'tenant-original', workspaceId: 'workspace-original', customerId: 'customer-original' };
    const consume = name => async (current, value, signal) => {
      assert(signal instanceof AbortSignal);
      state.calls.push({ name, current: structuredClone(current), value: structuredClone(value), signal });
      if (state.onCall) await state.onCall(name, signal);
      if (state.error) throw state.error;
      if (state.result !== undefined) return state.result;
      if (name === 'prepare') return material;
      if (name === 'readOrderMaterialReceipt') { shared.aiClientOrderMaterialRequestSchema.parse(value); return receipt; }
      shared.aiClientTaskReadRequestSchema.parse(value); return task;
    };
    const application = Object.freeze({ prepare: consume('prepare'), readOrderMaterialReceipt: consume('readOrderMaterialReceipt'),
      createTask: consume('createTask'), readTaskCreation: consume('readTaskCreation'),
      async observeEntryRefusal(current, error, observation) {
        state.observations.push({ current: structuredClone(current), error, observation });
        const { clientEntryRefusalCode } = require('@rental-os/ai-native-server/runtime/scenes/client-entry.controller');
        await recordClientEntryRefusal(store, identity, { channel: channel.channel, operation: 'original_http_observation',
          code: clientEntryRefusalCode(error), durationMs: observation.durationMs });
      }
    });
    return { state, application, controller: new channel.Controller(application), original: new AiClientEntryController(application) };
  }
  const response = error => ({ status: error.getStatus(), body: error.getResponse() });
  async function rejection(work) {
    try { await work(); } catch (error) { return response(error); }
    assert.fail('expected original HTTP refusal');
  }

  await t.test('客户两渠道只挂 12 个原方法，Nest 方法/路径/状态/header/参数与原定义一致', () => {
    const scanner = new MetadataScanner(), routes = [];
    for (const channel of channels) {
      const { Controller, original, prefix, token } = channel;
      assert.equal(Reflect.getMetadata(PATH_METADATA, Controller), prefix);
      assert.equal(Reflect.getMetadata(PATH_METADATA, Controller), Reflect.getMetadata(PATH_METADATA, original));
      assert.deepEqual(Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, Controller), [{ index: 0, param: token }]);
      assert(!(Controller.prototype instanceof AiClientEntryController), 'must not inherit unreviewed client actions');
      const mounted = scanner.getAllMethodNames(Controller.prototype)
        .filter(name => Reflect.hasMetadata(METHOD_METADATA, Controller.prototype[name]));
      assert.deepEqual(mounted.sort(), [...mountedMethods].sort());
      for (const name of mountedMethods) {
        const actual = Controller.prototype[name], expected = AiClientEntryController.prototype[name];
        for (const key of [PATH_METADATA, METHOD_METADATA, HTTP_CODE_METADATA, HEADERS_METADATA])
          assert.deepEqual(Reflect.getMetadata(key, actual), Reflect.getMetadata(key, expected), `${Controller.name}.${name}:${key}`);
        assert.equal(Reflect.getMetadata(PATH_METADATA, actual), shared.AI_CLIENT_ENTRY_HTTP_DRAFT[name]);
        assert.equal(Reflect.getMetadata(METHOD_METADATA, actual), RequestMethod.POST);
        assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, actual), 200);
        assert.deepEqual(Reflect.getMetadata(HEADERS_METADATA, actual), [{ name: 'Cache-Control', value: 'no-store' }]);
        assert.deepEqual(Reflect.getMetadata(ROUTE_ARGS_METADATA, Controller, name), Reflect.getMetadata(ROUTE_ARGS_METADATA, AiClientEntryController, name));
        routes.push(prefix + '/' + Reflect.getMetadata(PATH_METADATA, actual));
      }
      for (const name of scanner.getAllMethodNames(AiClientEntryController.prototype).filter(name => !mountedMethods.includes(name)))
        assert.equal(Controller.prototype[name], undefined, `unexpected inherited entry: ${name}`);
    }
    assert.equal(routes.length, 24); assert.equal(new Set(routes).size, 24);
  });

  await t.test('两渠道委托真实原 Controller，原 schema 投影及只读收据逐方法保持', async () => {
    for (const channel of channels) for (const name of methods) {
      const f = fixture(channel), req = request(), originalRequest = request(), value = command(name);
      const result = await f.controller[name](req, value), expected = await f.original[name](originalRequest, value);
      assert.deepEqual(result, expected);
      const schema = name.includes('Material') ? shared.aiClientOrderMaterialReceiptSchema : shared.aiClientTaskCreationReceiptSchema;
      assert(schema.safeParse(result).success); assert.equal(result.execution, 'not_attested'); assert.equal(result.retryable, false);
      assert.equal(f.state.calls.length, 2);
      const [actual, direct] = f.state.calls;
      assert.deepEqual({ ...actual, signal: undefined }, { ...direct, signal: undefined });
      assert.equal(actual.name, name === 'prepareOrderMaterial' ? 'prepare' : name);
      assert.deepEqual(actual.current, projected(req));
      assert.deepEqual(actual.value, name === 'prepareOrderMaterial'
        ? { operationKey: value.operationKey, command: { kind: 'order', orderId: value.orderId } } : value);
      assert.equal(f.state.logs.length, 0); assert.equal(f.state.observations.length, 0);
      assert.equal(req.listenerCount('aborted'), 0); assert.equal(req.res.listenerCount('close'), 0);
    }
  });

  await t.test('原拒绝/schema/unknown及一次拒绝审计保留，不泄露内部错误或命令', async () => {
    for (const channel of channels) for (const name of methods) {
      for (const [error, status, code] of [
        [new AiClientEntryError('AI_ACCESS_DENIED', 'private-denial-detail'), 403, 'AI_ACCESS_DENIED'],
        [new Error('private-provider-detail'), 503, 'AI_RESOURCE_UNAVAILABLE'],
        [new AiClientEntryError('AI_RESULT_UNKNOWN', 'private-result-detail'), 409, 'AI_RESULT_UNKNOWN']
      ]) {
        const f = fixture(channel), req = request(); f.state.error = error;
        const actual = await rejection(() => f.controller[name](req, command(name)));
        assert.deepEqual(actual, { status, body: { code, retryable: false,
          ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: expectedNext(name) } : {}) } });
        assert.equal(f.state.calls.length, 1); assert.equal(f.state.observations.length, 1); assert.equal(f.state.logs.length, 1);
        assert.equal(f.state.observations[0].error, error); assert.deepEqual(f.state.observations[0].current, projected(req));
        assert.equal(f.state.logs[0].detail.metadata.refusalCode, code);
        assert.equal(f.state.logs[0].detail.metadata.surface, channel.channel === 'web' ? 'tenant_website' : 'client_miniprogram');
        assert(!JSON.stringify([actual, f.state.logs]).match(/private-|offline-http-fixture|must-not-forward|order-original/u));
      }
      const invalid = fixture(channel);
      const invalidResult = await rejection(() => invalid.controller[name](request(), { ...command(name), tenantId: 'caller-authority' }));
      assert.deepEqual(invalidResult, { status: 400, body: { code: 'AI_INVALID_INPUT', retryable: false } });
      assert.equal(invalid.state.observations.length, 1); assert.equal(invalid.state.logs.length, 1);
      if (name !== 'readOrderMaterialReceipt') assert.equal(invalid.state.calls.length, 0);
    }
    const brokenReceipt = fixture(channels[0]); brokenReceipt.state.result = {};
    assert.deepEqual(await rejection(() => brokenReceipt.controller.createTask(request(), taskCommand)),
      { status: 409, body: { code: 'AI_RESULT_UNKNOWN', retryable: false, nextAction: 'read_original_task_creation' } });
    const lostAudit = fixture(channels[1]); lostAudit.state.auditFailure = true;
    lostAudit.state.error = new AiClientEntryError('AI_RESULT_UNKNOWN', 'unknown');
    assert.equal((await rejection(() => lostAudit.controller.createTask(request(), taskCommand))).body.code, 'AI_RESULT_UNKNOWN');
    lostAudit.state.error = new AiClientEntryError('AI_ACCESS_DENIED', 'denied');
    assert.equal((await rejection(() => lostAudit.controller.createTask(request(), taskCommand))).body.code, 'AI_RESOURCE_UNAVAILABLE');
  });

  await t.test('原 abort 语义不重发：预关闭不进入应用，在途断线返回 unknown 并清监听', async () => {
    for (const channel of channels) {
      const before = fixture(channel), closed = request(); closed.aborted = true;
      assert.deepEqual(await rejection(() => before.controller.prepareOrderMaterial(closed, materialCommand)),
        { status: 503, body: { code: 'AI_RESOURCE_UNAVAILABLE', retryable: false } });
      assert.equal(before.state.calls.length, 0); assert.equal(before.state.logs.length, 1);
      const f = fixture(channel), req = request(); let entered, release;
      const started = new Promise(resolve => { entered = resolve; }), held = new Promise(resolve => { release = resolve; });
      f.state.onCall = async () => { entered(); await held; };
      const running = f.controller.createTask(req, taskCommand);
      try {
        await started; req.emit('aborted');
        assert.deepEqual(await rejection(() => running), { status: 409,
          body: { code: 'AI_RESULT_UNKNOWN', retryable: false, nextAction: 'read_original_task_creation' } });
        assert.equal(f.state.calls[0].signal.aborted, true); assert.equal(f.state.calls.length, 1);
        assert.equal(req.listenerCount('aborted'), 0); assert.equal(req.res.listenerCount('close'), 0);
        assert.equal(f.state.logs.length, 1);
      } finally { release(); await running.catch(() => undefined); }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.state.calls.length, 1); assert.equal(f.state.logs.length, 1, 'late completion cannot replace the unknown receipt or retry');
    }
  });
};

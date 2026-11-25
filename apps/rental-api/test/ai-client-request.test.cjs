'use strict';
/** 客户短请求接点：复用原 selected fixture 的真实 Guard/ClientAuth/access/Controller。
 * 只以原内存运输替代持久化，不执行被引用测试的 main，不读取环境文件或连接服务。
 * node --no-compilation-cache apps/rental-api/test/ai-client-request.test.cjs --deps <node_modules>
 * 原 fixture/preload 不创建临时目录；finally 核实仍无磁盘输出。 */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const { getEventListeners } = require('node:events');
const root = path.resolve(__dirname, '../../..');
const temporary = path.resolve(root, 'output/.tmp/dev2-original-scene-transactions');
const originalLoad = Module._load;
let groups = 0, cases = 0, complete = false;
const forbidden = error => error?.getStatus?.() === 403 || error?.code === 'denied';
const never = () => assert.fail('拒绝后不能执行 consumer');
const command = key => ({ operationKey: key, orderId: 'own-order' });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function check(name, consume) { await consume(); groups++; console.log(`PASS ${name}`); }
async function one(consume) { await consume(); cases++; }

async function main() {
  const priorSecret = process.env.AUTH_TOKEN_SECRET;
  Module._load = function (name, ...rest) {
    if (name === '@prisma/client') throw Error('本测试禁止加载默认生成 Client');
    return originalLoad.call(this, name, ...rest);
  };
  try {
    // Same static signing key used by the original session fixture; not a host
    // credential, and never exposed by the production helper or test output.
    process.env.AUTH_TOKEN_SECRET = 'client-current-session-offline-secret';
    const { fixture } = require('../../../packages/ai-native-server/test/client-selected-transactions.test.cjs');
    const { fixture: operatorFixture, load, shared, identity } =
      require('../../../packages/ai-native-server/test/original-scene-transactions.test.cjs');
    const { withRentalAiClientRequest } = load('apps/rental-api/src/ai-client-request.ts');
    const { captureRentalClientInternalAuthority } = load('packages/rental-core/src/application-internal-authority.ts');
    const invoke = (f, method, value) => f.invoke(method, value, request =>
      withRentalAiClientRequest(request, () => f.controller[method](request, value)));
    assert.equal(path.resolve(process.env.AI_OFFLINE_WRITE_ROOT), temporary);
    assert.equal(fs.existsSync(temporary), false);

    for (const channel of ['web', 'wechat_miniprogram']) await check(`${channel} 四个原 Controller 与同键任务收据`, async () => {
      const f = fixture(channel), value = command(channel);
      let material, created, task;
      await one(async () => {
        material = await invoke(f, 'prepareOrderMaterial', value);
        assert.equal(material.state, 'observed');
        assert.equal(f.state.aiClientSceneMaterial.length, 1);
        assert.equal(f.state.aiClientSceneMaterial[0].material.__aiBody, 'rental-os-ai-body-1');
      });
      await one(async () => assert.equal((await invoke(f, 'readOrderMaterialReceipt', value)).materialRef, material.materialRef));
      await one(async () => {
        task = { materialRef: material.materialRef, creationKey: `${channel}-task` };
        created = await invoke(f, 'createTask', task);
        assert.equal(created.state, 'observed'); assert.equal(created.task.status, 'queued');
      });
      await one(async () => assert.equal((await invoke(f, 'readTaskCreation', task)).task.taskId, created.task.taskId));
      await one(async () => {
        assert.equal((await invoke(f, 'createTask', task)).task.taskId, created.task.taskId);
        assert.equal(f.state.aiTask.length, 1); assert.equal(f.state.aiRun.length, 1);
        assert.equal(f.state.aiClientTaskInput.length, 1); assert.equal(f.state.aiTask[0].ownerKind, 'CUSTOMER');
        assert.equal(f.state.aiTask[0].audience, 'CLIENT'); assert.equal(f.state.aiTask[0].ownerId, 'customer');
        assert(!f.state.events.some(event => event.sql?.includes('platform_member_core_assignments')));
      });
    });

    await check('仅生命周期同步复核；已提交资料不追加撤权查询', async () => {
      await one(async () => {
        const f = fixture();
        await f.invoke('prepareOrderMaterial', command('no-new-query'), async request => {
          const before = f.state.events.length, guards = f.state.guardCalls, value = Object.freeze({ marker: 'lifecycle' });
          assert.equal(await withRentalAiClientRequest(request, async () => value), value);
          assert.equal(f.state.events.length, before); assert.equal(f.state.guardCalls, guards);
        });
      });
      await one(async () => {
        const f = fixture(), value = command('committed'); let original, afterCommit;
        const result = await f.invoke('prepareOrderMaterial', value, request => withRentalAiClientRequest(request, async () => {
          original = await f.controller.prepareOrderMaterial(request, value);
          assert.equal(original.state, 'observed'); afterCommit = f.state.events.length;
          f.state.grant = 'disabled'; f.state.authRows.state.session.revokedAt = new Date();
          return original;
        }));
        assert.equal(result, original); assert.equal(f.state.events.length, afterCommit);
        assert.equal(f.state.aiClientSceneMaterial.length, 1);
      });
    });

    await check('拒绝未绑定客户、营运请求、克隆请求和未挂载动作', async () => {
      let saved, source;
      await fixture().invoke('prepareOrderMaterial', command('save-context'), async request => {
        saved = request; source = identity.getRequestIdentity();
      });
      await one(() => assert.rejects(() => withRentalAiClientRequest(saved, never), forbidden));
      await one(() => assert.rejects(() => identity.runWithRequestIdentity(source,
        () => withRentalAiClientRequest(saved, never)), forbidden));
      await one(() => operatorFixture().invoke(async request => {
        assert.equal(identity.getRequestIdentity().audience, 'operator');
        await assert.rejects(() => withRentalAiClientRequest(request, never), forbidden);
      }, { seed: false }));
      await one(() => fixture().invoke('prepareOrderMaterial', command('cloned-request'), async request => {
        // All values, including the actual Client object, are equal. Only the
        // original access scope's owning request reference may enter.
        await assert.rejects(() => withRentalAiClientRequest({ ...request }, never), forbidden);
      }));
      await one(() => fixture().invoke('prepareOrderMaterial', command('cloned-client'), async request => {
        request.client = { ...request.client };
        await assert.rejects(() => withRentalAiClientRequest(request, never), forbidden);
      }));
      for (const mutate of [
        request => { request.url += '/unmounted'; },
        request => { request.method = 'GET'; },
        request => { request.url = `/api/${shared.AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath}/${shared.AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial}`; },
        request => { request.staffApiRequest = true; },
        request => { request.headers.authorization = ['Bearer invalid']; }
      ]) await one(() => fixture().invoke('prepareOrderMaterial', command('entry-tamper'), async request => {
        mutate(request); await assert.rejects(() => withRentalAiClientRequest(request, never), forbidden);
      }));
    });

    await check('已核客户执行和原收据八方法可进入同一原客户请求范围', async () => {
      for (const method of ['startTaskModel', 'submitTaskInput', 'continueTaskInput', 'recoverTaskModel',
        'reconcileTaskModel', 'readTaskInput', 'readTaskInputReceipt', 'readTaskModelResult']) {
        for (const channel of ['web', 'wechat_miniprogram']) await one(async () => {
          const f = fixture(channel);
          await f.invoke(method, {}, async request => {
            const before = f.state.events.length, guards = f.state.guardCalls, result = Object.freeze({ method, channel });
            assert.equal(await withRentalAiClientRequest(request, async () => result), result);
            assert.equal(f.state.events.length, before); assert.equal(f.state.guardCalls, guards);
          });
        });
      }
    });

    await check('等待期间请求、客户和原 ALS 身份快照不可换借', async () => {
      for (const mutate of [
        request => { request.method = 'post'; },
        request => { request.url += '?changed=1'; },
        request => { request.originalUrl = request.url; },
        request => { request.headers = { ...request.headers }; },
        request => { request.headers.authorization += '.changed'; },
        request => { request.staffApiRequest = true; },
        request => { request.aborted = true; },
        request => { request.client = { ...request.client }; },
        request => { request.client.sessionId = 'different-session'; },
        () => { identity.getRequestIdentity().tenantId = 'different-tenant'; },
        () => { identity.getRequestIdentity().permissions = ['*']; }
      ]) await one(async () => {
        const f = fixture(); let calls = 0;
        await assert.rejects(() => f.invoke('prepareOrderMaterial', command('during-tamper'), request =>
          withRentalAiClientRequest(request, async () => { calls++; await Promise.resolve(); mutate(request); return 'unreturned'; })), forbidden);
        assert.equal(calls, 1); assert.equal(f.state.aiClientSceneMaterial.length, 0);
      });
      await one(() => fixture().invoke('prepareOrderMaterial', command('copied-identity'), async request => {
        await assert.rejects(() => identity.runWithRequestIdentity(identity.getRequestIdentity(),
          () => withRentalAiClientRequest(request, never)), forbidden);
      }));
    });

    await check('一次进入、禁止嵌套、异步逃逸和请求结束后恢复', async () => {
      await one(() => fixture().invoke('prepareOrderMaterial', command('nested'), async request => {
        let calls = 0;
        assert.equal(await withRentalAiClientRequest(request, async () => {
          calls++; await assert.rejects(() => withRentalAiClientRequest(request, never), forbidden); return 'original';
        }), 'original');
        assert.equal(calls, 1);
        await assert.rejects(() => withRentalAiClientRequest(request, never), forbidden);
      }));
      await one(() => fixture().invoke('prepareOrderMaterial', command('async-escape'), async request => {
        const gate = deferred(); let escaped;
        await withRentalAiClientRequest(request, async () => {
          escaped = gate.promise.then(() => withRentalAiClientRequest(request, never));
        });
        // Still inside selected access: only this short request has ended.
        const rejected = assert.rejects(escaped, forbidden); gate.resolve(); await rejected;
      }));
      await one(async () => {
        let resume, request;
        await fixture().invoke('prepareOrderMaterial', command('ended'), async value => {
          request = value; resume = AsyncLocalStorage.snapshot();
          await withRentalAiClientRequest(request, async () => undefined);
        });
        await resume(async () => {
          assert.throws(() => captureRentalClientInternalAuthority(request), forbidden);
          await assert.rejects(() => withRentalAiClientRequest(request, never), forbidden);
        });
      });
    });

    await check('中止和异常释放监听；原异常及 unknown 不被改写', async () => {
      for (const already of [true, false]) await one(() => fixture().invoke('prepareOrderMaterial', command('abort'), async request => {
        const abort = new AbortController(); let called = 0;
        if (already) abort.abort();
        const listeners = getEventListeners(abort.signal, 'abort').length;
        await assert.rejects(() => withRentalAiClientRequest(request, async () => {
          called++; abort.abort(); await Promise.resolve();
        }, abort.signal), forbidden);
        assert.equal(called, already ? 0 : 1);
        assert.equal(getEventListeners(abort.signal, 'abort').length, listeners);
      }));
      await one(() => fixture().invoke('prepareOrderMaterial', command('original-error'), async request => {
        const abort = new AbortController(), original = new Error('original-action-error');
        await assert.rejects(() => withRentalAiClientRequest(request, async () => { abort.abort(); throw original; }, abort.signal),
          error => error === original);
        assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
        await assert.rejects(() => withRentalAiClientRequest(request, never), forbidden);
      }));
      for (const lost of ['material', 'task']) await one(async () => {
        const f = fixture(), value = command(`unknown-${lost}`);
        let method = 'prepareOrderMaterial', body = value;
        if (lost === 'task') {
          const material = await invoke(f, 'prepareOrderMaterial', value);
          method = 'createTask'; body = { materialRef: material.materialRef, creationKey: 'unknown-task' };
        }
        f.state.lost = lost; let original;
        await assert.rejects(() => f.invoke(method, body, request => withRentalAiClientRequest(request, async () => {
          try { return await f.controller[method](request, body); } catch (error) { original = error; throw error; }
        })), error => error === original && error.getResponse?.().code === 'AI_RESULT_UNKNOWN');
        f.state.lost = undefined;
        const receipt = await invoke(f, lost === 'material' ? 'readOrderMaterialReceipt' : 'readTaskCreation', body);
        assert.equal(receipt.state, 'observed'); assert.equal(f.state.aiClientSceneMaterial.length, 1);
        assert.equal(f.state.aiTask.length, lost === 'task' ? 1 : 0);
      });
    });

    await check('并发原请求不串用身份和短请求范围', () => one(async () => {
      const gate = deferred(), scopes = []; let entered = 0;
      const values = await Promise.all(['web', 'wechat_miniprogram'].map(channel => {
        const f = fixture(channel);
        return f.invoke('prepareOrderMaterial', command(`parallel-${channel}`), request => withRentalAiClientRequest(request, async () => {
          const current = identity.getRequestIdentity(); scopes.push(current);
          if (++entered === 2) gate.resolve(); await gate.promise;
          assert.equal(identity.getRequestIdentity(), current); return channel;
        }));
      }));
      assert.notEqual(scopes[0], scopes[1]); assert.deepEqual(values, ['web', 'wechat_miniprogram']);
    }));
    complete = true;
    console.log(JSON.stringify({ groups, cases, diskOutputs: 0, realDatabaseCalls: 0, realModelCalls: 0 }));
  } finally {
    Module._load = originalLoad;
    if (priorSecret === undefined) delete process.env.AUTH_TOKEN_SECRET; else process.env.AUTH_TOKEN_SECRET = priorSecret;
    assert.equal(fs.existsSync(temporary), false, '原离线夹具不得留下临时产物');
  }
}
process.once('beforeExit', () => assert(complete || process.exitCode === 1, '不能遗留未结束的异步验证'));
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

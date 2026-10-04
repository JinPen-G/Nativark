'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mountWorkbench } = require('./fixtures/ai-native/b12-native-host.cjs');

for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(`B14-D ${app} source opening passes only id/version, never a model URL`, async () => {
    const { instance, children } = mountWorkbench(app);
    const opened = [];
    instance.attachHost({ context: { audience: 'tenant', tenantId: 'tenant-a', workspaceId: 'space-a' }, readDetail: async () => ({
      sources: [{ id: 'doc-1', version: '3', title: '合同', location: 'javascript:alert(1)', status: 'published' }],
    }), openSource: async (_context, ref) => opened.push(ref) });
    instance.hostShow(true);
    await instance.selectTask({ detail: { taskId: 'task-source' } });
    await children['#sources'].onOpen({ currentTarget: { dataset: { id: 'doc-1', version: '3' } } });
    assert.equal(JSON.stringify(opened), JSON.stringify([{ resourceId: 'doc-1', version: '3' }]));
    assert.equal(JSON.stringify(opened).includes('javascript:'), false);
  });

  test(`B14-D ${app} withdrawn and revoked content is immediately non-readable`, async () => {
    const { instance, children } = mountWorkbench(app);
    instance.attachHost({ context: { audience: 'tenant', tenantId: 'tenant-a', workspaceId: 'space-a' }, readDetail: async () => ({
      sources: [{ id: 'doc-1', version: '4', title: '撤回文档', status: 'withdrawn' }],
      memories: [{ id: 'memory-1', revision: '2', label: '偏好', value: 'secret-like text', status: 'revoked', actorKind: 'human', expiresAt: '2099-01-01T00:00:00Z' }],
    }) });
    instance.hostShow(true);
    await instance.selectTask({ detail: { taskId: 'task-revoked' } });
    assert.equal(children['#sources'].data.visibleSources[0].title, '来源不可用');
    assert.equal(children['#sources'].data.visibleSources[0].statusLabel, '已撤回');
    assert.equal(children['#memory'].data.rows[0].value, '内容不可用');
  });

  test(`B14-D ${app} switching to a fresh snapshot clears old source and memory rows`, async () => {
    let current = { sources: [{ id: 'old', version: '1', title: '旧', status: 'published' }], memories: [{ id: 'old-memory', revision: '1', label: '旧', value: '旧', status: 'revoked' }] };
    const { instance, children } = mountWorkbench(app);
    instance.attachHost({ context: { audience: 'tenant', tenantId: 'tenant-a', workspaceId: 'space-a' }, readDetail: async () => current });
    instance.hostShow(true);
    await instance.selectTask({ detail: { taskId: 'task-old' } });
    assert.equal(children['#sources'].data.visibleSources.length, 1);
    current = { sources: [], memories: [] };
    await instance.readSnapshot();
    assert.equal(children['#sources'].data.visibleSources.length, 0);
    assert.equal(children['#memory'].data.rows.length, 0);
  });
}

'use strict';
/** Original scene Result/Source -> persisted knowledge -> sensitive read audit.
 * The parent test owns the official selected Client, loader and offline cleanup.
 * Only stored rows and object transport are synthetic; Auth/Guard, selected
 * access, task/input/result provenance, knowledge ACL and logger are original.
 */
const assert = require('node:assert/strict');
const prepared = new WeakSet();

function prepareFixture(f) {
  if (prepared.has(f.db)) return;
  prepared.add(f.db);
  const { getRequestIdentity } = require('@rental-os/platform-server/request-identity');
  const state = f.state;
  state.knowledgeAuditTrace = [];
  const transaction = f.db.$transaction;
  f.db.$transaction = (consume, options) => transaction(async tx => {
    const query = tx.$queryRaw;
    tx.$queryRaw = async value => {
      const sql = value.sql.replace(/\s+/gu, ' ').trim();
      state.knowledgeAuditTrace.push(sql);
      await state.knowledgePhase?.(sql);
      if (sql.includes('FROM `User`')) return [{ id: state.user.id, roleId: null }];
      if (sql.includes('FROM auth_sessions')) return state.active ? [{ id: 'session-a' }] : [];
      if (sql.includes('FROM workspace_members')) return state.active ? [{ roleId: null }] : [];
      if (sql.includes('FROM `UserRole`')) return [];
      return query(value);
    };
    tx.authSession = { findFirst: async ({ where }) => {
      assert.equal(state.depth, 1);
      assert.equal(where.id, 'session-a');
      assert.equal(where.userId, state.user.id);
      assert.equal(where.revokedAt, null);
      return state.active ? { audience: 'operator', currentWorkspaceId: state.workspace } : null;
    } };
    tx.workspaceMember = { findFirst: async ({ where }) => {
      assert.equal(state.depth, 1);
      assert.equal(where.userId, state.user.id);
      assert.equal(where.workspace.status, 'ACTIVE');
      return state.active && where.workspaceId === state.workspace
        ? { role: null, dataScope: null, locationScope: structuredClone(state.user.locationScope) } : null;
    } };
    const create = tx.operationLog.create;
    tx.operationLog.create = async input => {
      state.knowledgeAuditTrace.push('operationLog.create');
      assert.equal(getRequestIdentity()?.accessSession?.sessionId, 'session-a');
      assert.equal(input.data.workspaceId, 'workspace-a');
      const result = await create(input);
      await state.afterKnowledgeAudit?.(input);
      return result;
    };
    return consume(tx);
  }, options);
}

module.exports = async function knowledgeSceneCases({ t, knowledgeFixture }) {
  const { AsyncLocalStorage } = require('node:async_hooks');
  const shared = require('@rental-os/shared');
  const { getRequestIdentity, runWithRequestIdentity } = require('@rental-os/platform-server/request-identity');
  const { KnowledgeError } = require('@rental-os/ai-native-server/runtime/knowledge/knowledge-errors');
  const { AiTaskRepositoryError } = require('@rental-os/ai-native-server/task-errors');
  const { composeOriginalSceneKnowledge } = require('@rental-os/ai-native-server/runtime/scenes/original-scene-knowledge');
  const { requestFingerprint: hash } = require('@rental-os/ai-native-server/runtime/rental-adapters/rental-idempotency.repository');
  const { fingerprint: knowledgeHash, persistedKnowledgeChunkSchema } = require('@rental-os/ai-native-server/runtime/knowledge/knowledge-validation');
  const { RentalAiCompositionModule } = require('../src/ai-composition.ts');
  const { OperationLogService } = require('@rental-os/ai-native-server/runtime/rental-adapters/operation-log.service');
  const { composePersistedTaskAuthorization } = require('@rental-os/ai-native-server/runtime/task-authorization.composition');
  const { AiCurrentOriginalRequestAuthority, originalIdentityHash } = require('@rental-os/ai-native-server/runtime/task-request/original-request.authority');
  const { PrismaOriginalRequestRepository } = require('@rental-os/ai-native-server/runtime/task-request/prisma-original-request.repository');
  const { AiBusinessReadRouteAuthority } = require('@rental-os/ai-native-server/runtime/business-read-route.authority');
  const { AiOriginalSceneResultService } = require('@rental-os/ai-native-server/runtime/scenes/original-scene-result.service');
  const { taskModelIntent, taskModelFingerprint, TASK_TEXT_MODEL_TOOL } = require('@rental-os/ai-native-server/runtime/model-input/task-model-input');
  const { aiPersistenceScopeColumns } = require('@rental-os/ai-native-server/runtime/persistence-scope');
  const { validateAiSceneModelObservation, validateAiSceneSourceObservation } = require('@rental-os/ai-native-server/runtime/scenes/scene-observation-contracts');
  const unavailable = error => error instanceof KnowledgeError && error.code === 'unavailable'
    || error instanceof AiTaskRepositoryError && error.code === 'AI_RESOURCE_UNAVAILABLE';
  const inputRef = '00000000-0000-4000-8000-000000000001';

  function fixture() {
    const f = knowledgeFixture(), { state, db } = f;
    prepareFixture(f);
    const document = f.row.state.document, sourceHash = f.row.state.contentHash;
    const chunk = persistedKnowledgeChunkSchema.parse({ draftVersion: shared.AI_KNOWLEDGE_DRAFT_VERSION,
      documentId: document.documentId, documentVersion: document.documentVersion, chunkId: 'chunk-a',
      scope: document.scope, aclRevision: 1, locator: { kind: 'page', page: 1, paragraph: 1 },
      text: 'Synthetic original scene knowledge', trust: 'untrusted_data' });
    const chunkRow = { id: 'chunk-row-a', versionId: 'version-row-a', chunkIndex: 0, text: chunk.text,
      state: { chunk, sourceContentHash: sourceHash, chunkHash: knowledgeHash(chunk) } };
    state.chunkReads = 0;
    db.aiKnowledgeChunk.findMany = async ({ where }) => {
      const version = where.version;
      assert.equal(version.documentId, document.documentId);
      assert.equal(version.contentHash, document.documentVersion);
      assert.equal(version.document.tenantId, 'tenant-a');
      assert.equal(version.document.workspaceId, 'workspace-a');
      state.chunkReads++;
      return [structuredClone(chunkRow)];
    };
    db.aiKnowledgeDocument.findMany = async ({ where }) => {
      assert.equal(where.tenantId, 'tenant-a'); assert.equal(where.workspaceId, 'workspace-a');
      assert.equal(where.status, 'published'); return [structuredClone(f.row)];
    };
    db.aiKnowledgeOperation.findFirst = async ({ where }) => {
      assert.equal(where.operationId, 'source-content:' + knowledgeHash(document.documentVersion));
      return { ...where, fingerprint: sourceHash, failure: null };
    };
    // Exact fixed persisted grants, not a policy adapter that always authorizes.
    const resources = [{}, { documentId: document.documentId, documentVersion: document.documentVersion,
      attachmentId: document.attachmentId, aclRevision: document.aclRevision }];
    const policies = ['search', 'snippet', 'read_body', 'resolve_source', 'read_metadata'].flatMap(action =>
      resources.map(resource => ({ tenantId: 'tenant-a', workspaceId: 'workspace-a', actorKind: 'user',
        actorId: state.user.id, audience: 'operator', domain: 'knowledge', action,
        resourceKey: knowledgeHash(resource), resource, enabled: true, revision: 1,
        requiredPermissions: ['system:params:manage'], expiresAt: new Date(Date.now() + 600000) })));
    db.aiKnowledgeActionPolicy.findUnique = async ({ where }) => {
      state.policyReads++;
      if (state.policyThrows) throw Error('private policy failure');
      const key = where.tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey;
      const row = policies.find(policy => Object.entries(key).every(([name, value]) => policy[name] === value));
      return row ? { ...structuredClone(row), enabled: state.policyEnabled } : null;
    };
    const provider = RentalAiCompositionModule.registerFactory({ inject: [], useFactory: () => f.binding })
      .providers.find(value => value.provide === OperationLogService);
    assert(provider, 'actual host provider exists');
    const logs = provider.useFactory(f.binding);
    state.auditInputs = [];
    const scene = req => composeOriginalSceneKnowledge({ db: f.binding.bodyDatabase,
      policyDb: f.binding.bodyDatabase, fileRuntime: f.binding.files, includePreferences: false,
      operationLogs: { record(input) {
        const projection = getRequestIdentity();
        assert.equal(projection.accessSession, undefined, 'original audit uses only its projected ALS');
        assert.equal(projection.permissions, undefined);
        state.auditInputs.push(structuredClone(input));
        return logs.record(input);
      } } }, { auth: f.rental.auth, credentials: credentials(req) }, () => new Date());
    const credentials = req => ({ current: async () => ({ authorization: req.headers.authorization,
      audience: 'operator', requestId: 'scene-knowledge-a' }) });
    const collect = api => api.collect(inputRef, { sceneCode: 'opening_diagnosis', input: { sections: ['Synthetic'] } });

    // Result reader uses its actual original/task/step/Run/invocation algorithms.
    // These are persisted synthetic rows, never a Runner or a model dispatch.
    async function resultReader(req, knowledge, snapshot) {
      const identity = credentials(req), clock = () => new Date();
      const scope = { id: 'scope-a', ...aiPersistenceScopeColumns(document.scope) };
      db.aiScope.findFirst = async ({ where }) => Object.entries(where).every(([k, v]) => scope[k] === v)
        ? structuredClone(scope) : null;
      const routes = new AiBusinessReadRouteAuthority(f.guard, identity, clock);
      const rules = [{ sceneCode: 'opening_diagnosis', sceneVersion: 'scene-1', revision: 1,
        audiences: ['operator'], requiredPermissions: ['system:params:manage'], maxInputAgeMs: 600000 }];
      const authority = new AiCurrentOriginalRequestAuthority(db, { auth: f.rental.auth, credentials: identity,
        subscriptions: f.rental.subscriptions, creationRules: rules,
        authorizeResources: () => routes.withRead('opening', {}, context => context) }, clock);
      const context = (await authority.current()).context;
      const saved = { id: inputRef, contractVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION,
        scopeId: scope.id, audience: 'OPERATOR', ownerKind: 'USER', ownerId: state.user.id,
        sceneCode: 'opening_diagnosis', sceneVersion: 'scene-1', revision: 1, requestKey: 'original-a',
        previousRequestId: null, payload: { sections: ['item_groups'] }, status: 'STORED', erasedAt: null,
        authorizationBindingHash: originalIdentityHash(context), expiresAt: new Date(Date.now() + 600000),
        createdAt: new Date(), policyHash: 'a'.repeat(64), policyRevision: 1 };
      saved.contentHash = hash({ version: saved.contractVersion, scopeId: saved.scopeId, audience: saved.audience,
        ownerKind: saved.ownerKind, ownerId: saved.ownerId, sceneCode: saved.sceneCode, sceneVersion: saved.sceneVersion,
        revision: saved.revision, previousInputRef: saved.previousRequestId, input: saved.payload });
      const run = { id: 'run-a', scopeId: scope.id, taskId: 'task-a', actorKind: 'USER', actorId: state.user.id,
        sequence: 1, inputReceiptId: null, resourceOriginRunId: null, executionPlan: null };
      const task = { id: 'task-a', scopeId: scope.id, scopeKind: 'WORKSPACE', scope, audience: 'OPERATOR',
        ownerKind: 'USER', ownerId: state.user.id, creationKey: 'scene-request:' + inputRef,
        inputRef, inputRevision: saved.revision, inputHash: saved.contentHash, sceneCode: saved.sceneCode,
        sceneVersion: saved.sceneVersion, archivedAt: null, status: 'SUCCEEDED', revision: 1,
        contractVersion: shared.AI_TASK_DRAFT_VERSION, resultRef: 'result-a', runs: [run] };
      db.aiTaskOriginalRequest.findFirst = async () => structuredClone(saved);
      db.aiTask.findFirst = async () => structuredClone(task);
      db.aiRun.findFirst = async () => structuredClone(run);
      db.aiTaskActionPolicy.findUnique = async ({ where }) => {
        const key = where.scopeId_taskId_operation;
        if (key.scopeId !== scope.id || key.taskId !== task.id || key.operation !== 'read_step_terminal') return null;
        return { ...key, revision: 1, requiredPermissions: ['system:params:manage'], expiresAt: saved.expiresAt };
      };
      const requests = new PrismaOriginalRequestRepository(db, authority, clock);
      const original = await requests.readHistorical({ draftVersion: saved.contractVersion, inputRef });
      const material = { scope: document.scope, audience: 'operator', observedAt: saved.createdAt.toISOString(),
        configVersion: 'configuration-a', sections: [{ key: 'item_groups', title: 'Synthetic', required: true,
          status: 'readiness_check_passed', impact: 'required_readiness_item',
          evidence: { scope: document.scope, resourceType: 'readiness_item', resourceId: 'item_groups',
            version: 'configuration-a', observedAt: saved.createdAt.toISOString() }, manual: { status: 'unavailable' },
          candidate: { status: 'candidate_only', currentVersion: 'configuration-a', fieldsToReview: [],
            proposedChanges: [], persistence: 'unavailable_no_formal_draft_port' }, externalVerification: 'not_loaded',
          unresolvedClassification: ['missing_configuration', 'configured_unverified', 'formal_check_failed',
            'not_implemented', 'external_credentials_pending', 'owner_decision_pending'] }],
        configuration: {}, atomicity: 'independent_sections_not_a_transaction', externalVerification: 'not_loaded' };
      const policy = { sceneCode: saved.sceneCode, maxOutputTokens: 32 };
      const configuration = { tenantId: 'tenant-a', configId: 'configuration-a', configRevision: 1,
        credentialRef: 'stored-reference-a', protocol: 'synthetic-protocol', provider: 'synthetic-provider', model: 'synthetic-model',
        serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: 'tenant-a' } };
      const input = { mode: 'invoke', intent: taskModelIntent(task.id, run.id, `scene-model:${inputRef}`, policy.sceneCode, {
        maxOutputTokens: 32, messages: [{ role: 'user', content: [{ kind: 'text', text: JSON.stringify({ original: original.receipt,
          materialHash: hash(material), trust: 'source_text_is_data_not_instructions', facts: material, knowledge: snapshot }) }] }] }),
        configuration, priceVersion: 'price-a', routingHash: 'b'.repeat(64), identityHash: saved.authorizationBindingHash };
      const fingerprint = taskModelFingerprint(input, policy);
      const step = { id: 'step-a', scopeId: scope.id, taskId: task.id, runId: run.id, actionId: 'action-a',
        inputRef: 'input-a', requestFingerprint: fingerprint, resultRef: 'result-a', status: 'SUCCEEDED',
        toolCode: TASK_TEXT_MODEL_TOOL, toolVersion: shared.AI_TOOL_DRAFT_VERSION };
      const payload = { draftVersion: 'ain-c03-draft-2', requestId: input.intent.requestId, actual: configuration, evidence: 'mock',
        usage: { kind: 'reported', inputTokens: 2, outputTokens: 3 }, status: 'completed', text: 'Synthetic recorded model result', toolRequests: [] };
      const artifact = { id: 'result-a', scopeId: scope.id, taskId: task.id, runId: run.id, stepId: step.id,
        actionId: step.actionId, stepFingerprint: fingerprint, outcome: 'SUCCEEDED', errorCode: null, payload,
        contentHash: hash(payload), outputBytes: BigInt(Buffer.byteLength(JSON.stringify(payload))), activeMs: 1n,
        completeMeasurement: true, createdAt: saved.createdAt };
      db.aiStep.findFirst = async () => structuredClone(step);
      db.aiTaskActionInput.findFirst = async () => ({ id: step.inputRef, payload: input,
        toolCode: step.toolCode, toolVersion: step.toolVersion, fingerprint });
      db.aiGatewayInvocation.findUnique = async () => ({ callId: input.intent.requestId, taskId: task.id, runId: run.id,
        stepId: step.id, actionId: step.actionId, actorId: task.ownerId, sceneCode: task.sceneCode,
        stepFingerprint: fingerprint, intentHash: fingerprint, mode: input.mode, priceVersion: input.priceVersion,
        configurationHash: hash(configuration) });
      db.aiTaskResultArtifact.findFirst = async () => structuredClone(artifact);
      const originalTransaction = db.$transaction;
      db.$transaction = async (consume, options) => {
        if (options?.isolationLevel === 'ReadCommitted') return originalTransaction(consume, options);
        assert(!options || options.isolationLevel === 'RepeatableRead');
        assert.equal(state.depth, 0);
        state.depth++;
        const tx = { ...db }; delete tx.$transaction;
        tx.operationLog = { create() { throw Error('result read cannot write logs inside its snapshot'); } };
        try { return await consume(tx); } finally { state.depth--; }
      };
      const tasks = composePersistedTaskAuthorization({ db, auth: f.rental.auth, credentials: identity,
        subscriptions: f.rental.subscriptions, clock }).tasks;
      const scenes = { requests, readTaskReceipt: requests.readTaskReceipt.bind(requests), tools: { scenes: {
        prepareOpeningDiagnosis: () => routes.withRead('opening', {}, () => ({ payload: { materials: structuredClone(material) } })) } } };
      const reader = new AiOriginalSceneResultService(db, tasks, scenes, policy, clock, knowledge);
      return { reader, command: { original: { draftVersion: saved.contractVersion, inputRef }, resultId: artifact.id }, artifact };
    }
    return { ...f, chunk, policies, logs, scene, collect, resultReader };
  }

  await t.test('原场景 collect/Result/Source 经投影审计回到真实 Auth/Core 事务', async () => {
    const f = fixture();
    await f.invoke(req => f.binding.withRequest(req, async () => {
      const originalStore = getRequestIdentity(), knowledge = f.scene(req);
      const snapshot = await f.collect(knowledge);
      assert.equal(snapshot.material.sources[0].snippet, f.chunk.text);
      const { reader, command } = await f.resultReader(req, knowledge, snapshot);
      const result = await reader.read(command);
      assert.equal(result.status, 'available');
      assert.deepEqual(validateAiSceneModelObservation(result), result);
      const sourceCommand = { ...command, sourceIndex: 0, sourceKind: 'knowledge' };
      const source = await reader.reopenSource(sourceCommand);
      assert.equal(source.source.text, f.chunk.text);
      assert.deepEqual(validateAiSceneSourceObservation(source, sourceCommand), source);
      assert.equal(getRequestIdentity(), originalStore, 'original store restored after every projection');
      assert(f.state.auditInputs.some(row => row.action === 'ai.knowledge.input.collect'));
      assert(f.state.auditInputs.some(row => row.action === 'ai.knowledge.input.revalidate'));
      assert(f.state.auditInputs.some(row => row.action === 'ai.knowledge.source.read'));
      for (const log of f.state.committedLogs) {
        assert.equal(log.data.workspaceId, 'workspace-a'); assert.equal(log.data.userId, 'operator-a');
        assert.equal(log.data.detail.metadata.originalInputRef, inputRef);
      }
      const trace = f.state.knowledgeAuditTrace;
      const write = trace.indexOf('operationLog.create');
      assert(write > trace.findIndex(sql => sql.includes('FROM Tenant') && sql.includes('FOR UPDATE')));
      assert(write > trace.findIndex(sql => sql.includes('FROM auth_sessions')));
      assert(write > trace.findIndex(sql => sql.includes('FROM platform_core_access_locks')));
      assert(!JSON.stringify(f.state.committedLogs).includes(f.chunk.text));
      assert.equal(f.state.dispatches, 0, 'parsed source is reopened from original chunks, no object GET');
    }));
  });

  await t.test('场景已保存知识在日志锁等待前撤销 Core/分配/部署时不交付', async () => {
    for (const change of ['core', 'assignment', 'deployment']) {
      const f = fixture();
      await f.invoke(req => f.binding.withRequest(req, async () => {
        const api = f.scene(req), snapshot = await f.collect(api), before = f.state.committedLogs.length;
        f.state.knowledgePhase = sql => {
          if (!sql.includes('FROM Tenant') || !sql.includes('FOR UPDATE')) return;
          if (change === 'core') f.state.grant = 'disabled';
          if (change === 'assignment') f.state.assigned = 'unassigned';
          if (change === 'deployment') f.state.available = false;
        };
        await assert.rejects(api.revalidate(snapshot, inputRef), unavailable);
        assert.equal(f.state.committedLogs.length, before);
      }));
    }
  });

  await t.test('必需审计提交前末次 Auth/Core 复验失败使原日志回滚', async () => {
    for (const change of ['role', 'location', 'session', 'workspace', 'core']) {
      const f = fixture();
      await f.invoke(req => f.binding.withRequest(req, async () => {
        const api = f.scene(req), snapshot = await f.collect(api), before = f.state.committedLogs.length;
        f.state.afterKnowledgeAudit = () => {
          if (change === 'role') f.state.user.permissions = [];
          if (change === 'location') f.state.user.locationScope = { mode: 'selected', locationIds: ['other-place'] };
          if (change === 'session') f.state.active = false;
          if (change === 'workspace') f.state.workspace = 'workspace-other';
          if (change === 'core') f.state.grant = 'disabled';
        };
        await assert.rejects(api.open(snapshot, inputRef, 0), unavailable);
        assert.equal(f.state.committedLogs.length, before);
        assert.equal(f.state.dispatches, 0);
      }));
    }
  });

  await t.test('场景政策 unknown 与 requireSuccess 日志故障均拒绝且不暴露内部错误', async () => {
    for (const fault of ['policy', 'log']) {
      const f = fixture();
      await f.invoke(req => f.binding.withRequest(req, async () => {
        const api = f.scene(req), snapshot = await f.collect(api), before = f.state.committedLogs.length;
        if (fault === 'policy') f.state.policyThrows = true;
        else f.state.logFailure = true;
        await assert.rejects(api.open(snapshot, inputRef, 0), error => unavailable(error) && !error.message.includes('private'));
        assert.equal(f.state.committedLogs.length, before);
      }));
    }
  });

  await t.test('缺少请求 scope 或复制的投影身份不能自行取得敏感审计权', async () => {
    const f = fixture();
    await f.invoke(req => f.binding.withRequest(req, async () => { await f.collect(f.scene(req)); }));
    const record = f.state.auditInputs[0], before = f.state.committedLogs.length;
    const projection = { tenantId: 'tenant-a', workspaceId: 'workspace-a', userId: 'operator-a', audience: 'operator',
      isSaasAdmin: false, dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } };
    await assert.rejects(runWithRequestIdentity(projection, () => f.logs.record(record)), unavailable);
    assert.equal(f.state.committedLogs.length, before);
  });

  await t.test('篡改的动作/审计 scope/authorityHash 不进入恢复通道，普通日志沿原服务', async () => {
    const f = fixture();
    await f.invoke(req => f.binding.withRequest(req, async () => {
      await f.collect(f.scene(req));
      const record = f.state.auditInputs[0], before = f.state.committedLogs.length;
      for (const change of [value => { value.action = 'ai.other.write'; },
        value => { value.metadata.scope.workspaceId = 'workspace-other'; },
        value => { value.metadata.authorityHash = '0'.repeat(64); }, value => { value.requireSuccess = false; },
        value => { value.tenantId = 'tenant-other'; }]) {
        const changed = structuredClone(record); change(changed);
        await assert.rejects(f.logs.record(changed), unavailable);
      }
      assert.equal(f.state.committedLogs.length, before);
      let originalCalls = 0;
      const original = f.rental.operationLog.record;
      f.rental.operationLog.record = async input => { originalCalls++; assert.equal(input.action, 'ai.configuration.read'); };
      try { await f.logs.record({ action: 'ai.configuration.read', targetType: 'configuration' }); }
      finally { f.rental.operationLog.record = original; }
      assert.equal(originalCalls, 1);
    }));
  });

  await t.test('知识请求结束后捕获的异步审计回调失活', async () => {
    const f = fixture(); let escaped, record;
    await f.invoke(req => f.binding.withRequest(req, async () => {
      await f.collect(f.scene(req)); record = f.state.auditInputs[0]; escaped = AsyncLocalStorage.snapshot();
    }));
    const before = f.state.transactions;
    await assert.rejects(escaped(() => f.logs.record(record)), unavailable);
    assert.equal(f.state.transactions, before);
  });
};
module.exports.prepareFixture = prepareFixture;

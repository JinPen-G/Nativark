'use strict';
const { Prisma } = require('../../../apps/api/node_modules/@prisma/client');

function clone(value) {
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value);
  if (value instanceof Date) return new Date(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}
function matches(value, where) {
  if (where instanceof Date) return value instanceof Date && value.getTime() === where.getTime();
  if (where instanceof Prisma.Decimal) return value !== undefined && String(value) === String(where);
  if (value instanceof Prisma.Decimal && (typeof where === 'string' || typeof where === 'number')) return value.equals(where);
  if (where === null || typeof where !== 'object') return value === where;
  return Object.entries(where).every(([key, rule]) => {
    if (key === 'AND') return (Array.isArray(rule) ? rule : [rule]).every(r => matches(value, r));
    if (key === 'OR') return rule.some(r => matches(value, r));
    if (key === 'is') return matches(value, rule);
    if (key === 'in') return rule.includes(value);
    if (key === 'notIn') return !rule.includes(value);
    if (key === 'path') return true;
    if (key === 'equals' && where.path) {
      const keys = Array.isArray(where.path) ? where.path : where.path.replace(/^\$\./u, '').split('.');
      return keys.reduce((row, field) => row?.[field], value) === rule;
    }
    if (key === 'not') return !matches(value, rule);
    if (key === 'gt') return value !== null && value !== undefined && value > rule;
    if (key === 'lt') return value !== null && value !== undefined && value < rule;
    if (key === 'lte') return value !== null && value !== undefined && value <= rule;
    if (key === 'some') return Array.isArray(value) && value.some(r => matches(r, rule));
    return matches(value?.[key], rule);
  });
}
const unique = {
  aiTask: [['id']], aiRun: [['id']], aiStep: [['scopeId', 'taskId', 'actionId'], ['scopeId', 'taskId', 'runId', 'sequence']],
  aiTaskRunPlan: [['scopeId', 'taskId', 'runId']],
  aiTaskRunPreparation: [['scopeId', 'taskId', 'id'], ['scopeId', 'taskId', 'runId', 'fencingToken']],
  aiTaskResultArtifact: [['scopeId', 'taskId', 'id'], ['scopeId', 'taskId', 'runId', 'stepId', 'fencingToken']],
  aiTaskExecutionBudget: [['scopeId', 'taskId']], aiTaskExecutionCharge: [['scopeId', 'taskId', 'chargeId']],
  aiTaskEvent: [['scopeId', 'taskId', 'cursor']],
  aiBudgetReservation: [['scopeId', 'scopeKind', 'idempotencyKey']],
  aiBudgetAllocation: [['policyId', 'reservationId']], aiBudgetLedgerEntry: [['reservationId', 'eventKey']],
  aiGatewayAccountingReceipt: [['invocationId'], ['reservationId'], ['admissionId']],
  customerApprovedProfileChange: [['id'], ['tenantId', 'customerId', 'actorId', 'changeKey']],
  customerApprovedProfileOperation: [['id'], ['tenantId', 'customerId', 'operationKey'], ['tenantId', 'customerId', 'changeId']]
};

// Serialized Prisma-shaped transaction double with rollback and lost COMMIT replies; not MySQL.
function createTaskInputStore(initial, constraints = {}) {
  const state = clone({ aiTaskQuoteSelection: [], aiTaskRunPreparation: [], aiTaskRunOverhead: [], ...initial }), trace = [];
  const control = { beforeRead: null, beforeWrite: null, beforeCommit: null, loseReply: false, settingsSchemaDefaults: false };
  const moneyColumns = { aiBudgetReservation: ['reservedMoney', 'actualMoney'], aiBudgetLedgerEntry: ['moneyAmount'] };
  const hydrateMoney = (name, row) => {
    for (const key of moneyColumns[name] ?? []) if (row[key] !== null && row[key] !== undefined) row[key] = new Prisma.Decimal(row[key]);
  };
  function related(row, name, data) {
    if (!row) return row;
    const out = clone(row);
    if (name === 'aiTask' && data.aiScope) out.scope = clone(data.aiScope.find(scope => scope.id === row.scopeId) ?? row.scope);
    if (name === 'aiRun') {
      const task = data.aiTask.find(t => t.id === row.taskId);
      out.task = task ? { ...clone(task), scope: clone(data.aiScope?.find(scope => scope.id === task.scopeId) ?? task.scope),
        runs: data.aiRun.filter(r => r.taskId === task.id).map(r => ({
        ...clone(r), steps: data.aiStep.filter(s => s.runId === r.id),
        executionCharges: data.aiTaskExecutionCharge.filter(c => c.runId === r.id),
        executionPlan: data.aiTaskRunPlan.find(p => p.runId === r.id) ?? null
      })) } : null;
      out.steps = data.aiStep.filter(s => s.runId === row.id);
      out.executionCharges = data.aiTaskExecutionCharge.filter(c => c.runId === row.id);
      out.executionPlan = data.aiTaskRunPlan.find(p => p.runId === row.id) ?? null;
    }
    if (name === 'aiTask') out.runs = data.aiRun.filter(r => r.taskId === row.id).map(r => related(r, 'aiRun', data));
    if (name === 'aiBudgetAllocation') out.reservation = clone(data.aiBudgetReservation.find(reservation => reservation.id === row.reservationId) ?? null);
    if (name === 'aiBudgetReservation') out.allocations = clone((data.aiBudgetAllocation ?? []).filter(allocation => allocation.reservationId === row.id));
    if (name === 'aiProposal') out.currentVersion = (data.aiProposalVersion ?? []).find(version =>
      version.scopeId === row.scopeId && version.taskId === row.taskId && version.proposalId === row.id && version.revision === row.currentRevision) ?? null;
    if (name === 'aiProposalAction') out.step = data.aiStep.find(step =>
      step.scopeId === row.scopeId && step.taskId === row.taskId && step.actionId === row.actionId) ?? null;
    if (name === 'aiTaskResultArtifact') out.step = data.aiStep.find(step =>
      step.scopeId === row.scopeId && step.taskId === row.taskId && step.id === row.stepId) ?? null;
    return out;
  }
  const hydrate = (row, select) => {
    if (!row) return null;
    if (!select) return clone(row);
    return Object.fromEntries(Object.entries(select).filter(([, rule]) => rule).map(([key, rule]) => [key,
      rule === true ? clone(row[key]) : Array.isArray(row[key])
        ? row[key].filter(child => matches(child, rule.where ?? {})).map(child => hydrate(child, rule.select))
        : hydrate(row[key], rule.select)]));
  };
  function delegates(data) {
    const all = {};
    for (const name of Object.keys(data)) {
      const rows = () => data[name];
      const selected = where => rows().filter(row => matches(related(row, name, data), where));
      const insert = value => {
        for (const keys of constraints[name] ?? unique[name] ?? [['scopeId', 'taskId', 'id']]) {
          if (keys.every(k => value[k] !== undefined) && rows().some(row => keys.every(k => String(row[k]) === String(value[k])))) throw Error(`synthetic unique ${name}`);
        }
        const row = { ...(!['aiTaskExecutionPhaseStart', 'aiTaskExecutionPhaseReceipt',
          'customerApprovedProfileChange', 'customerApprovedProfileOperation'].includes(name)
          && !(control.settingsSchemaDefaults && ['rentalApprovedSettingsChange', 'rentalApprovedSettingsOperation'].includes(name)) ? { revision: 1 } : {}),
          createdAt: new Date('2026-10-06T12:00:00Z'), ...clone(value) };
        // Prisma schema defaults, applied only when the real service inserts its receipt.
        if (name === 'rentalOrderIdempotencyRecord') {
          row.id ??= require('node:crypto').randomUUID();
          row.status ??= 'succeeded';
        }
        if (name === 'aiApprovalConsumption') row.updatedAt ??= new Date('2026-10-06T12:00:00Z');
        if (name === 'aiTask') { row.archivedAt ??= null; row.cancelRequestedAt ??= null; row.updatedAt ??= row.createdAt; }
        if (name === 'aiTaskOriginalRequest') { row.creationClosedAt ??= null; row.creationCloseKey ??= null; row.erasedAt ??= null; }
        if (name === 'aiGatewayInvocation') row.id ??= require('node:crypto').randomUUID();
        if (name === 'aiInvocationAdmission') {
          row.scopeKind ??= 'WORKSPACE'; // Real schema default for existing workspace admissions.
          row.platformDedupKey ??= null;
          row.admittedAt ??= row.createdAt; row.updatedAt ??= row.createdAt;
          for (const field of ['dispatchId', 'unknownReason', 'revokedAt', 'completedAt']) row[field] ??= null;
        }
        if (name === 'aiBudgetReservation') {
          row.updatedAt ??= new Date('2026-10-06T12:00:00Z');
          for (const field of ['reservedTokens', 'reservedCalls', 'reservedMoney', 'moneyCurrency', 'actualTokens', 'actualCalls', 'actualMoney', 'unknownReason']) row[field] ??= null;
        }
        if (name === 'aiGatewayAccountingReceipt') {
          row.id ??= require('node:crypto').randomUUID(); row.updatedAt ??= new Date('2026-10-06T12:00:00Z');
          for (const field of ['inputTokens', 'outputTokens', 'usageHash']) row[field] ??= null;
        }
        if (name === 'aiTaskRunOverhead') {
          for (const field of ['chargeId', 'requestFingerprint', 'completedAt', 'activeMs', 'measurementHash']) row[field] ??= null;
        }
        if (name === 'aiTaskRunPreparation') {
          row.prepared ??= false;
          for (const field of ['chargeId', 'requestFingerprint', 'completedAt', 'activeMs', 'planHash', 'measurementHash']) row[field] ??= null;
        }
        if (name === 'aiTaskExecutionBudget') for (const prefix of ['reserved', 'consumed']) for (const kind of ['Steps', 'Calls', 'ActiveMs', 'OutputBytes']) row[`${prefix}${kind}`] ??= 0n;
        hydrateMoney(name, row);
        rows().push(row); return hydrate(row);
      };
      all[name] = {
        // Prisma-shaped aggregate support for the real budget repository; no quota decisions here.
        count: async args => { trace.push(`${name}.count`); if (control.beforeRead) await control.beforeRead(name, args, data); return selected(args.where ?? {}).length; },
        groupBy: async args => {
          trace.push(`${name}.groupBy`); if (control.beforeRead) await control.beforeRead(name, args, data);
          const groups = new Map();
          for (const row of selected(args.where ?? {})) {
            const key = JSON.stringify(args.by.map(field => row[field]));
            let group = groups.get(key);
            if (!group) { group = { ...Object.fromEntries(args.by.map(field => [field, clone(row[field])])), _count: {}, _sum: {} }; groups.set(key, group); }
            for (const field of Object.keys(args._count ?? {})) group._count[field] = (group._count[field] ?? 0) + Number(field === '_all' || row[field] != null);
            for (const field of Object.keys(args._sum ?? {})) {
              const value = row[field], sum = group._sum[field];
              group._sum[field] = value == null ? sum ?? null : sum == null ? clone(value) : sum instanceof Prisma.Decimal ? sum.add(value) : sum + value;
            }
          }
          let result = [...groups.values()];
          for (const order of [...(Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [])].reverse()) {
            const [field, direction] = Object.entries(order)[0];
            result.sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === 'desc' ? -1 : 1));
          }
          return result.slice(0, args.take);
        },
        findFirst: async args => { trace.push(`${name}.read`); if (control.beforeRead) await control.beforeRead(name, args, data);
          // Prisma applies ordering before selecting the first record. In
          // particular, a new held preparation must not read an older phase.
          let found = selected(args.where ?? {});
          for (const order of [...(Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [])].reverse()) {
            const [field, direction] = Object.entries(order)[0];
            found = found.sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === 'desc' ? -1 : 1));
          }
          const row = found[0]; return hydrate(row && (args.select || args.include) ? related(row,name,data) : row, args.select); },
        findUnique: async args => { trace.push(`${name}.read`); if (control.beforeRead) await control.beforeRead(name, args, data);
          const where = Object.keys(args.where).length === 1 && Object.keys(args.where)[0].includes('_') ? Object.values(args.where)[0] : args.where;
          return hydrate(selected(where)[0], args.select); },
        findMany: async args => { trace.push(`${name}.readMany`); if (control.beforeRead) await control.beforeRead(name, args, data);
          let found = selected(args.where ?? {});
          for (const order of [...(Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [])].reverse()) {
            const [field, direction] = Object.entries(order)[0];
            found = found.sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === 'desc' ? -1 : 1));
          }
          return found.slice(0, args.take).map(row => hydrate(name === 'aiBudgetAllocation' ? related(row, name, data) : row, args.select)); },
        create: async args => { trace.push(`${name}.create`); if (control.beforeWrite) await control.beforeWrite(name, args, data); return hydrate(insert(args.data), args.select); },
        createMany: async args => { trace.push(`${name}.createMany`); if (control.beforeWrite) await control.beforeWrite(name, args, data);
          for (const row of args.data) insert(row); return { count: args.data.length }; },
        updateMany: async args => { trace.push(`${name}.update`); if (control.beforeWrite) await control.beforeWrite(name, args, data);
          const found = selected(args.where);
          for (const row of found) for (const [k, v] of Object.entries(args.data)) {
            if (v && typeof v === 'object' && 'increment' in v) row[k] = row[k] instanceof Prisma.Decimal ? row[k].add(v.increment) : row[k] + v.increment;
            else if (v && typeof v === 'object' && 'decrement' in v) row[k] -= v.decrement;
            else row[k] = clone(v);
          }
          for (const row of found) hydrateMoney(name, row);
          if (['aiBudgetReservation', 'aiGatewayAccountingReceipt'].includes(name)) for (const row of found) {
            row.updatedAt = new Date(row.updatedAt.getTime() + 1);
          }
          return { count: found.length }; },
        upsert: async args => { trace.push(`${name}.upsert`); if (control.beforeWrite) await control.beforeWrite(name, args, data);
          const first = Object.values(args.where)[0], where = first && typeof first === 'object' ? first : args.where;
          const prior = selected(where)[0]; return prior ? hydrate(prior, args.select) : insert(args.create); }
      };
    }
    return all;
  }
  let tail = Promise.resolve();
  const db = delegates(state);
  // Only the existing repositories' parameterized receipt/client-input SQL is
  // simulated. No authorization, financial or capability decisions live here.
  function raw(data, readOnly = false) {
    return {
      $queryRaw: async sql => {
        const text = sql.sql ?? '', values = sql.values ?? [];
        if (text.replace(/\s+/g, ' ').trim() === 'SELECT id FROM Tenant WHERE id=? LOCK IN SHARE MODE') {
          if (!Array.isArray(data.tenant) || values.length !== 1) throw Error('tenant lock facts not configured');
          trace.push('row.lock');
          return data.tenant.filter(row => row.id === values[0]).map(row => ({ id: row.id }));
        }
        if (text.includes('FROM business_workspaces')) {
          if (!Array.isArray(data.businessWorkspace)) throw Error('workspace lock facts not configured');
          // Raw SQL returns the schema's mapped enum value, not Prisma's
          // ACTIVE/FROZEN/DISABLED projection. Preserve unavailable states.
          const statuses = { ACTIVE: 'active', FROZEN: 'frozen', DISABLED: 'disabled' };
          return clone(data.businessWorkspace.filter(row => row.tenantId === values[0] && row.id === values[1]))
            .map(row => ({ ...row, status: statuses[row.status] ?? row.status }));
        }
        if (text.includes('FROM ai_client_task_policies')) {
          if (!Array.isArray(data.aiClientTaskPolicy)) throw Error('client policy table not configured');
          const keys = ['tenantId', 'workspaceId', 'channel', 'customerType', 'sceneCode', 'sceneVersion'];
          return clone(data.aiClientTaskPolicy.filter(row => keys.every((key, i) => row[key] === values[i])).slice(0, 1));
        }
        if (text.includes('FROM ai_client_task_inputs')) {
          if (!Array.isArray(data.aiClientTaskInput)) throw Error('client input table not configured');
          const keys = ['tenantId', 'workspaceId', 'channel', 'principalHash', 'creationKey'];
          return clone(data.aiClientTaskInput.filter(row => keys.every((key, i) => row[key] === values[i])).slice(0, 1));
        }
        if (text.includes('FROM ai_scopes')) return data.aiScope.filter(row => row.id === values[0]
          && row.kind === 'WORKSPACE' && row.tenantId === values[1] && row.workspaceId === values[2]).map(row => ({ id: row.id }));
        if (!text.includes('ai_text_capability_receipts')) { trace.push('row.lock'); return []; }
        if (!Array.isArray(data.aiTextCapabilityReceipt)) throw Error('receipt table not configured');
        const rows = data.aiTextCapabilityReceipt.filter(row => text.includes('WHERE scopeId')
          ? row.scopeId === values[0] && row.operationId === values[1] : row.id === values[0]);
        return clone(rows);
      },
      $executeRaw: async sql => {
        if (readOnly) throw Error('read-only snapshot cannot write receipts');
        const text = sql.sql ?? '', values = sql.values ?? [], rows = data.aiTextCapabilityReceipt;
        if (text.startsWith('INSERT INTO ai_client_task_inputs')) {
          if (!Array.isArray(data.aiClientTaskInput)) throw Error('client input table not configured');
          const columns = ['id', 'tenantId', 'workspaceId', 'channel', 'principalKind', 'principalHash', 'creationKey',
            'materialRef', 'materialInputHash', 'materialHash', 'materialRevision', 'bindingHash', 'policyId', 'policyRevision',
            'policyHash', 'sceneCode', 'sceneVersion', 'inputHash', 'revision', 'dispatchState', 'createdAt', 'expiresAt'];
          if (values.length !== columns.length) throw Error('unsupported client input insert');
          const row = Object.fromEntries(columns.map((key, i) => [key, clone(values[i])]));
          const key = ['tenantId', 'workspaceId', 'channel', 'principalHash', 'creationKey'];
          if (data.aiClientTaskInput.some(prior => prior.id === row.id || key.every(field => prior[field] === row[field])))
            throw Error('client input unique');
          trace.push('aiClientTaskInput.create'); data.aiClientTaskInput.push(row); return 1;
        }
        if (!text.includes('ai_text_capability_receipts') || !Array.isArray(rows)) throw Error('unsupported offline SQL');
        if (text.startsWith('INSERT')) {
          const [id, scopeId, profileId, operationId, descriptor, descriptorHash] = values;
          if (rows.some(row => row.id === id || row.scopeId === scopeId && row.operationId === operationId)) throw Error('receipt unique');
          rows.push({ id, scopeId, profileId, operationId, descriptor, descriptorHash, observation: null, observationHash: null }); return 1;
        }
        if (text.startsWith('UPDATE')) {
          const [observation, observationHash, id, descriptorHash] = values;
          const found = rows.filter(row => row.id === id && row.descriptorHash === descriptorHash && row.observationHash === null);
          for (const row of found) Object.assign(row, { observation, observationHash });
          return found.length;
        }
        throw Error('unsupported receipt SQL');
      }
    };
  }
  Object.assign(db, raw(state));
  db.$transaction = (callback, options) => {
    // Independent non-locking authorization snapshots may run while a write
    // transaction holds policy locks. Never publish this snapshot or permit
    // writes; this models read visibility, not MySQL lock behavior.
    if (options?.isolationLevel === 'RepeatableRead') {
      const readers = delegates(clone(state));
      for (const delegate of Object.values(readers)) for (const method of ['create', 'createMany', 'updateMany', 'upsert']) {
        delegate[method] = async () => { throw Error('read-only authorization snapshot cannot write'); };
      }
      trace.push('transaction.readSnapshot');
      return Promise.resolve().then(() => callback({ ...readers, ...raw(clone(state), true) }));
    }
    const work = tail.then(async () => {
      const draft = clone(state); trace.push('transaction.begin');
      try {
        const result = await callback({ ...delegates(draft), ...raw(draft) });
        if (control.beforeCommit) await control.beforeCommit(draft);
        Object.assign(state, draft); trace.push('transaction.commit');
        if (control.loseReply) { control.loseReply = false; throw Error('synthetic lost COMMIT reply'); }
        return result;
      } catch (error) { control.lastTransactionError = error; trace.push('transaction.error'); throw error; }
    });
    tail = work.catch(() => {}); return work;
  };
  return { state, db, trace, control };
}
module.exports = { createTaskInputStore, clone, matches };

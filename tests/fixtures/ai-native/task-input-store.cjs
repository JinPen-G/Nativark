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
    if (key === 'not') return !matches(value, rule);
    if (key === 'gt') return value !== null && value !== undefined && value > rule;
    if (key === 'lte') return value !== null && value !== undefined && value <= rule;
    if (key === 'some') return Array.isArray(value) && value.some(r => matches(r, rule));
    return matches(value?.[key], rule);
  });
}
const unique = {
  aiTask: [['id']], aiRun: [['id']], aiStep: [['scopeId', 'taskId', 'actionId'], ['scopeId', 'taskId', 'runId', 'sequence']],
  aiTaskRunPlan: [['scopeId', 'taskId', 'runId']],
  aiTaskResultArtifact: [['scopeId', 'taskId', 'id'], ['scopeId', 'taskId', 'runId', 'stepId', 'fencingToken']],
  aiTaskExecutionBudget: [['scopeId', 'taskId']], aiTaskExecutionCharge: [['scopeId', 'taskId', 'chargeId']],
  aiTaskEvent: [['scopeId', 'taskId', 'cursor']]
};

// Serialized Prisma-shaped transaction double with rollback and lost COMMIT replies; not MySQL.
function createTaskInputStore(initial, constraints = {}) {
  const state = clone(initial), trace = [];
  const control = { beforeRead: null, beforeWrite: null, beforeCommit: null, loseReply: false };
  function related(row, name, data) {
    if (!row) return row;
    const out = clone(row);
    if (name === 'aiRun') {
      const task = data.aiTask.find(t => t.id === row.taskId);
      out.task = task ? { ...clone(task), runs: data.aiRun.filter(r => r.taskId === task.id).map(r => ({
        ...clone(r), steps: data.aiStep.filter(s => s.runId === r.id),
        executionPlan: data.aiTaskRunPlan.find(p => p.runId === r.id) ?? null
      })) } : null;
      out.steps = data.aiStep.filter(s => s.runId === row.id);
      out.executionPlan = data.aiTaskRunPlan.find(p => p.runId === row.id) ?? null;
    }
    if (name === 'aiTask') out.runs = data.aiRun.filter(r => r.taskId === row.id).map(r => related(r, 'aiRun', data));
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
        const row = { ...(!['aiTaskExecutionPhaseStart', 'aiTaskExecutionPhaseReceipt'].includes(name) ? { revision: 1 } : {}),
          createdAt: new Date('2026-10-06T12:00:00Z'), ...clone(value) };
        if (name === 'aiApprovalConsumption') row.updatedAt ??= new Date('2026-10-06T12:00:00Z');
        if (name === 'aiTaskExecutionBudget') for (const prefix of ['reserved', 'consumed']) for (const kind of ['Steps', 'Calls', 'ActiveMs', 'OutputBytes']) row[`${prefix}${kind}`] ??= 0n;
        rows().push(row); return hydrate(row);
      };
      all[name] = {
        findFirst: async args => { trace.push(`${name}.read`); if (control.beforeRead) await control.beforeRead(name, args, data); return hydrate(selected(args.where ?? {})[0], args.select); },
        findUnique: async args => { trace.push(`${name}.read`); if (control.beforeRead) await control.beforeRead(name, args, data);
          const where = Object.keys(args.where).length === 1 && Object.keys(args.where)[0].includes('_') ? Object.values(args.where)[0] : args.where;
          return hydrate(selected(where)[0], args.select); },
        findMany: async args => { trace.push(`${name}.readMany`); if (control.beforeRead) await control.beforeRead(name, args, data);
          let found = selected(args.where ?? {});
          for (const order of [...(Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : [])].reverse()) {
            const [field, direction] = Object.entries(order)[0];
            found = found.sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === 'desc' ? -1 : 1));
          }
          return found.slice(0, args.take).map(row => hydrate(row, args.select)); },
        create: async args => { trace.push(`${name}.create`); if (control.beforeWrite) await control.beforeWrite(name, args, data); return insert(args.data); },
        updateMany: async args => { trace.push(`${name}.update`); if (control.beforeWrite) await control.beforeWrite(name, args, data);
          const found = selected(args.where);
          for (const row of found) for (const [k, v] of Object.entries(args.data)) {
            if (v && typeof v === 'object' && 'increment' in v) row[k] = row[k] instanceof Prisma.Decimal ? row[k].add(v.increment) : row[k] + v.increment;
            else if (v && typeof v === 'object' && 'decrement' in v) row[k] -= v.decrement;
            else row[k] = clone(v);
          }
          return { count: found.length }; },
        upsert: async args => { trace.push(`${name}.upsert`); if (control.beforeWrite) await control.beforeWrite(name, args, data);
          const where = Object.values(args.where)[0], prior = selected(where)[0]; return prior ? hydrate(prior) : insert(args.create); }
      };
    }
    return all;
  }
  let tail = Promise.resolve();
  const db = delegates(state);
  db.$transaction = callback => {
    const work = tail.then(async () => {
      const draft = clone(state); trace.push('transaction.begin');
      try {
        const result = await callback({ ...delegates(draft), $queryRaw: async () => { trace.push('row.lock'); return []; } });
        if (control.beforeCommit) await control.beforeCommit(draft);
        Object.assign(state, draft); trace.push('transaction.commit');
        if (control.loseReply) { control.loseReply = false; throw Error('synthetic lost COMMIT reply'); }
        return result;
      } catch (error) { trace.push('transaction.error'); throw error; }
    });
    tail = work.catch(() => {}); return work;
  };
  return { state, db, trace, control };
}
module.exports = { createTaskInputStore, clone, matches };

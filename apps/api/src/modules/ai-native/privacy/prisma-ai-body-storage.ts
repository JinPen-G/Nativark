/** AI专属Prisma视图：只编解码列清单中的正文和已声明关系的嵌套写读。
 * 原业务数据库与PrismaService不变；当前授权、CAS、hash、账和原收据
 * 仍由原服务负责。只支持原回调事务，不拦截raw SQL，SQL正文由原仓储显式处理。 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AI_BODY_STORAGE, AI_BODY_TITLE_PLACEHOLDER, AiBodyStorageCodec, isAiBodyRecord,
  type AiBodyCipher } from './ai-body-storage.codec';

type Value = Record<string, unknown>;
type Definition = { keys: readonly string[]; paths: readonly string[]; text?: readonly string[]; queryPaths?: readonly string[] };
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export class AiBodyStorageUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN'; readonly retryable = false;
  readonly nextAction = 'observe_same_storage_page';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}
const nativeClients = new WeakMap<object, { native: object; codec: AiBodyStorageCodec;
  bind<C extends object>(client: C): C }>();
const definitions: Record<string, Definition> = {
  aiTaskActionInput: { keys: ['scopeId', 'taskId', 'id'], paths: ['payload'] },
  aiTaskResultArtifact: { keys: ['scopeId', 'taskId', 'id'], paths: ['payload'] },
  aiTaskOriginalRequest: { keys: ['scopeId', 'id', 'audience', 'ownerKind', 'ownerId'], paths: ['payload'] },
  aiTaskQuoteSelection: { keys: ['scopeId', 'taskId', 'runId', 'id', 'audience', 'ownerKind', 'ownerId'], paths: ['payload'] },
  aiApprovedOrderSnapshot: { keys: ['scopeId', 'taskId', 'recordId', 'revision', 'kind', 'actorKind', 'actorId', 'audience'], paths: ['payload'] },
  aiTaskInputRequest: { keys: ['scopeId', 'taskId', 'id'], paths: ['allowedFields'] },
  aiTaskInputReceipt: { keys: ['scopeId', 'taskId', 'id'], paths: ['answers'] },
  aiTaskEvent: { keys: ['scopeId', 'taskId', 'cursor'], paths: ['payload.previousRequest.allowedFields'],
    queryPaths: ['$.data.', '$.confirmation.'] },
  aiKnowledgeChunk: { keys: ['id'], paths: ['text', 'state.chunk.text'], text: ['text'], queryPaths: ['$.chunk.chunkId'] },
  aiKnowledgeDocument: { keys: ['id', 'tenantId', 'workspaceId'], paths: ['state.document.title'], queryPaths: ['$.document.attachmentId'] },
  aiStructuredMemory: { keys: ['id', 'tenantId', 'workspaceId', 'ownerKind', 'ownerId'], paths: ['content', 'state.preference'] },
  aiHumanConfirmation: { keys: ['id', 'tenantId', 'workspaceId', 'subjectId', 'confirmedBy'], paths: ['state.preference'],
    queryPaths: ['$.memoryId', '$.owner.actorKind', '$.owner.actorId'] },
  aiClientSceneMaterial: { keys: ['id', 'tenantId', 'workspaceId', 'channel', 'principalKind', 'principalHash'],
    paths: ['command', 'material', 'publication'] },
  aiInspectionDraft: { keys: ['id', 'tenantId', 'workspaceId', 'ownerId', 'audience'], paths: ['state'] },
};
const delegates = new Map(Prisma.dmmf.datamodel.models.map(model =>
  [model.name, model.name[0].toLowerCase() + model.name.slice(1)]));
const relations = new Map(Prisma.dmmf.datamodel.models.map(model => [delegates.get(model.name)!,
  new Map(model.fields.filter(field => field.kind === 'object' && delegates.has(field.type))
    .map(field => [field.name, delegates.get(field.type)!]))]));
const bodyColumns = (model: string) => new Set((definitions[model]?.paths ?? []).map(path => path.split('.')[0]));

function equalities(value: unknown, result: Value = {}): Value {
  if (!isAiBodyRecord(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (['string', 'number', 'bigint'].includes(typeof item)) result[key] = item;
    else if (key === 'AND' && Array.isArray(item)) for (const clause of item) equalities(clause, result);
    else if (isAiBodyRecord(item) && Object.keys(item).length === 1 && 'equals' in item) result[key] = item.equals;
    else if (isAiBodyRecord(item) && key.includes('_')) equalities(item, result);
  }
  return result;
}

function at(value: Value, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split('.')) {
    if (!isAiBodyRecord(current) || !Object.prototype.hasOwnProperty.call(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function replace(value: Value, path: string, update: (value: unknown) => unknown): Value {
  const [key, ...rest] = path.split('.');
  if (!Object.prototype.hasOwnProperty.call(value, key)) return value;
  if (!rest.length) return { ...value, [key]: update(value[key]) };
  if (!isAiBodyRecord(value[key])) return value;
  return { ...value, [key]: replace(value[key], rest.join('.'), update) };
}

function assertQuery(model: string, where: unknown): void {
  if (!isAiBodyRecord(where)) return;
  const columns = bodyColumns(model), relation = relations.get(model);
  for (const [field, clause] of Object.entries(where)) {
    if (['AND', 'OR', 'NOT'].includes(field)) {
      for (const item of Array.isArray(clause) ? clause : [clause]) assertQuery(model, item);
    } else if (columns.has(field) || model === 'aiKnowledgeDocument' && field === 'title') {
      const path = isAiBodyRecord(clause) ? clause.path : undefined;
      if (typeof path !== 'string' || !(definitions[model].queryPaths ?? []).some(allowed =>
        allowed.endsWith('.') ? path.startsWith(allowed) : path === allowed)) throw unavailable();
    } else if (relation?.has(field) && isAiBodyRecord(clause)) {
      const target = relation.get(field)!;
      for (const mode of ['some', 'every', 'none', 'is', 'isNot']) if (mode in clause) assertQuery(target, clause[mode]);
      assertQuery(target, clause);
    }
  }
}

type Projection = { extra: Set<string>; relations: Map<string, Projection> };
function prepareRead(model: string, args: Value): { args: Value; projection: Projection } {
  let next = { ...args };
  const projection: Projection = { extra: new Set(), relations: new Map() };
  assertQuery(model, args.where);
  for (const kind of ['select', 'include'] as const) {
    if (!isAiBodyRecord(args[kind])) continue;
    const fields = { ...args[kind] };
    for (const [name, target] of relations.get(model) ?? []) {
      if (!isAiBodyRecord(fields[name])) continue;
      const nested = prepareRead(target, fields[name]);
      fields[name] = nested.args; projection.relations.set(name, nested.projection);
    }
    if (kind === 'select' && definitions[model]) {
      const body = [...bodyColumns(model)].some(column => fields[column] === true)
        || model === 'aiKnowledgeDocument' && fields.title === true;
      if (body) {
        const required = [...definitions[model].keys,
          ...(model === 'aiKnowledgeDocument' && fields.title === true ? ['state'] : [])];
        for (const key of required) if (fields[key] !== true) { fields[key] = true; projection.extra.add(key); }
      }
    }
    next = { ...next, [kind]: fields };
  }
  return { args: next, projection };
}

function encodeData(codec: AiBodyStorageCodec, model: string, value: unknown, where?: unknown, inherited: Value = {},
  protectLegacy = false): unknown {
  if (Array.isArray(value)) return value.map(item => encodeData(codec, model, item, where, inherited, protectLegacy));
  if (!isAiBodyRecord(value)) return value;
  const keys = { ...inherited, ...equalities(where), ...equalities(value) };
  let result = { ...value };
  const definition = definitions[model];
  if (definition) {
    const binding = definition.keys.map(key => keys[key]);
    for (const path of definition.paths) result = replace(result, path, item => {
      if (model === 'aiKnowledgeDocument' && path === 'state.document.title'
        && item === '[已删除]' && at(value, 'state.document.publication') === 'deleted'
        && value.title === '[已删除]') return item;
      if (protectLegacy && codec.isSealed(item)) {
        codec.decode(model, path, binding, item, definition.text?.includes(path));
        return item;
      }
      const actual = definition.text?.includes(path) && isAiBodyRecord(item)
        && Object.keys(item).length === 1 && 'set' in item ? item.set : item;
      const encoded = codec.encode(model, path, binding, actual, definition.text?.includes(path));
      return actual === item ? encoded : { set: encoded };
    });
    if (model === 'aiKnowledgeDocument' && Object.prototype.hasOwnProperty.call(value, 'title')) {
      const title = value.title, stateTitle = at(value, 'state.document.title');
      const plainTitle = codec.isSealed(stateTitle)
        ? codec.decode(model, 'state.document.title', binding, stateTitle) : stateTitle;
      if (typeof title !== 'string' || plainTitle !== title
        && !(protectLegacy && title === AI_BODY_TITLE_PLACEHOLDER && typeof plainTitle === 'string')) throw unavailable();
      result.title = title === '[已删除]' && at(value, 'state.document.publication') === 'deleted'
        ? title : AI_BODY_TITLE_PLACEHOLDER;
    }
  }
  for (const [field, target] of relations.get(model) ?? []) {
    const nested = result[field];
    if (!isAiBodyRecord(nested)) continue;
    const operations = { ...nested }, childKeys = { ...keys };
    // Child IDs cannot borrow a parent's ID; immutable nested chunks always
    // supply their own ID. The original relation handles parent FK columns.
    delete childKeys.id;
    for (const operation of ['create', 'update', 'upsert', 'createMany', 'updateMany']) {
      const item = operations[operation];
      if (item === undefined) continue;
      const apply = (entry: unknown): unknown => {
        if (!isAiBodyRecord(entry)) return entry;
        if (operation === 'upsert') return { ...entry,
          create: encodeData(codec, target, entry.create, entry.where, childKeys, protectLegacy),
          update: encodeData(codec, target, entry.update, entry.where, childKeys, protectLegacy) };
        if (operation === 'create') return encodeData(codec, target, entry, undefined, childKeys, protectLegacy);
        return 'data' in entry ? { ...entry, data: encodeData(codec, target, entry.data, entry.where, childKeys, protectLegacy) }
          : encodeData(codec, target, entry, undefined, childKeys, protectLegacy);
      };
      operations[operation] = Array.isArray(item) ? item.map(apply) : apply(item);
    }
    result[field] = operations;
  }
  return result;
}

function decodeRows(codec: AiBodyStorageCodec, model: string, value: unknown, projection?: Projection): unknown {
  if (Array.isArray(value)) return value.map(row => decodeRows(codec, model, row, projection));
  if (!isAiBodyRecord(value)) return value;
  let result = { ...value };
  const definition = definitions[model];
  if (definition) {
    const binding = definition.keys.map(key => value[key]);
    for (const path of definition.paths) result = replace(result, path,
      body => codec.decode(model, path, binding, body, definition.text?.includes(path)));
    if (model === 'aiKnowledgeDocument' && result.title === AI_BODY_TITLE_PLACEHOLDER
      && codec.isSealed(at(value, 'state.document.title'))) {
      if (typeof at(result, 'state.document.title') !== 'string') throw unavailable();
      result.title = at(result, 'state.document.title');
    }
  }
  for (const [field, target] of relations.get(model) ?? []) if (field in result) {
    result[field] = decodeRows(codec, target, result[field], projection?.relations.get(field));
  }
  for (const key of projection?.extra ?? []) delete result[key];
  return result;
}

/** This view is injected only into AI factories. Original Core/Auth/logging
 * keep their existing client; metadata reads do not require a body key. */
function createAiBodyStorageView<T extends object>(db: T, codec: AiBodyStorageCodec): T {
  const clients = new WeakMap<object, object>();
  const wrap = <C extends object>(client: C): C => {
    const existing = clients.get(client);
    if (existing) return existing as C;
    const models = new Map<PropertyKey, object>();
    const proxy = new Proxy(client, { get(target, key) {
      if (key === AI_BODY_STORAGE) return codec;
      const member: unknown = Reflect.get(target, key);
      if (key === '$transaction' && typeof member === 'function') return (callback: unknown, options?: unknown) => {
        if (typeof callback !== 'function') throw unavailable();
        return member.call(target, (transaction: object) => callback(wrap(transaction)), options);
      };
      if (typeof key !== 'string' || !relations.has(key) || !member || typeof member !== 'object') {
        return typeof member === 'function' ? member.bind(target) : member;
      }
      const previous = models.get(key);
      if (previous) return previous;
      const delegate = new Proxy(member, { get(original, method) {
        const call: unknown = Reflect.get(original, method);
        if (typeof call !== 'function' || typeof method !== 'string') return call;
        return async (input: unknown = {}) => {
          if (!isAiBodyRecord(input)) throw unavailable();
          const prepared = prepareRead(key, input);
          let args = prepared.args;
          if (['create', 'createMany', 'update', 'updateMany'].includes(method)) args = {
            ...args, data: encodeData(codec, key, args.data, args.where) };
          else if (method === 'upsert') args = { ...args,
            create: encodeData(codec, key, args.create, args.where),
            update: encodeData(codec, key, args.update, args.where) };
          const result: unknown = await call.call(original, args);
          return decodeRows(codec, key, result, prepared.projection);
        };
      } });
      models.set(key, delegate); return delegate;
    } });
    clients.set(client, proxy); nativeClients.set(proxy, { native: client, codec, bind: wrap }); return proxy;
  };
  return wrap(db);
}

export function createAiBodyStorageDatabase<T extends object>(db: T, cipher: AiBodyCipher): T {
  return createAiBodyStorageView(db, new AiBodyStorageCodec(cipher));
}

/** Original Core transactions arrive from its unchanged PrismaService. Bind
 * only the AI participant's view to this SAME transaction and codec; never
 * start/nest a transaction or copy data. Legacy explicitly plain internal
 * stores retain their original view; all standard AI providers use the codec. */
export function bindAiBodyStorageTransaction<T extends object>(db: object, transaction: T): T {
  const current = nativeClients.get(db);
  if (!current) {
    if (Reflect.get(db, AI_BODY_STORAGE) !== undefined) throw unavailable();
    return transaction;
  }
  const bound = nativeClients.get(transaction);
  if (bound) {
    if (bound.codec !== current.codec) throw unavailable();
    return transaction;
  }
  return current.bind(transaction);
}

export const AI_BODY_STORAGE_KINDS = Object.freeze(Object.keys(definitions));
export type AiBodyStorageKind = keyof typeof definitions;
export type AiBodyStorageCursor = { id: string } | { taskId: string; cursor: string }
  | { recordId: string; revision: number };

/** Host-only bounded upgrade. The original retention authority supplies the
 * current workspace or independent platform scope/check; no body leaves this port, no hash or
 * lifecycle is rewritten, and already protected cells are never encrypted
 * again. A lost COMMIT is unknown; the same cursor page can be observed again. */
export async function protectAiBodyStorageRows(db: PrismaClient, input: {
  model: AiBodyStorageKind; scopeId: string; tenantId: string | null; workspaceId: string | null;
  limit: number; after?: AiBodyStorageCursor; check(): Promise<void>;
}) {
  const stored = nativeClients.get(db), definition = definitions[input.model];
  if (!stored || !definition || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) throw unavailable();
  const native = stored.native as PrismaClient, event = input.model === 'aiTaskEvent', snapshot = input.model === 'aiApprovedOrderSnapshot';
  const platform = input.tenantId === null && input.workspaceId === null;
  const scopeModels = ['aiTaskActionInput', 'aiTaskResultArtifact', 'aiTaskOriginalRequest', 'aiTaskQuoteSelection', 'aiApprovedOrderSnapshot',
    'aiTaskInputRequest', 'aiTaskInputReceipt', 'aiTaskEvent'];
  if (platform ? !scopeModels.includes(input.model) : input.tenantId === null || input.workspaceId === null) throw unavailable();
  if (input.after && (event ? !('taskId' in input.after) || !/^[1-9][0-9]{0,19}$/u.test(input.after.cursor)
    || BigInt(input.after.cursor) > 18446744073709551615n : snapshot ? !('recordId' in input.after)
      || !Number.isSafeInteger(input.after.revision) || input.after.revision < 1 : !('id' in input.after))) throw unavailable();
  const scope = scopeModels.includes(input.model)
    ? { scopeId: input.scopeId } : input.model === 'aiKnowledgeChunk'
      ? { version: { document: { tenantId: input.tenantId, workspaceId: input.workspaceId } } }
      : { tenantId: input.tenantId, workspaceId: input.workspaceId };
  const after = input.after ? 'id' in input.after ? { id: { gt: input.after.id } }
    : 'recordId' in input.after ? { OR: [{ recordId: { gt: input.after.recordId } },
      { recordId: input.after.recordId, revision: { gt: input.after.revision } }] }
    : { OR: [{ taskId: { gt: input.after.taskId } }, { taskId: input.after.taskId, cursor: { gt: BigInt(input.after.cursor) } }] } : {};
  let wrote = false, completed = false;
  try {
    const result = await native.$transaction(async tx => {
      await input.check();
      const ownerWhere = { id: input.scopeId, kind: platform ? 'PLATFORM' as const : 'WORKSPACE' as const,
        tenantId: input.tenantId, workspaceId: input.workspaceId, ...(platform ? { scopeKey: 'platform' } : {}) };
      const owner = await tx.aiScope.findFirst({ where: ownerWhere });
      if (!owner || (await tx.aiScope.updateMany({ where: ownerWhere, data: { id: owner.id } })).count !== 1) throw unavailable();
      const delegate = Reflect.get(tx, input.model) as {
        findMany(value: unknown): Promise<Value[]>; updateMany(value: unknown): Promise<{ count: number }>;
      };
      const rows = await delegate.findMany({ where: { ...scope, ...after }, take: input.limit + 1,
        orderBy: event ? [{ taskId: 'asc' }, { cursor: 'asc' }] : snapshot
          ? [{ recordId: 'asc' }, { revision: 'asc' }] : { id: 'asc' } });
      if (!Array.isArray(rows) || rows.length > input.limit + 1) throw unavailable();
      let protectedRows = 0;
      for (const row of rows.slice(0, input.limit)) {
        await input.check();
        if (!isAiBodyRecord(row)) throw unavailable();
        const encoded = encodeData(stored.codec, input.model, row, undefined, {}, true) as Value;
        const columns = [...bodyColumns(input.model), ...(input.model === 'aiKnowledgeDocument' ? ['title'] : [])];
        const changed = columns.filter(column => JSON.stringify(row[column]) !== JSON.stringify(encoded[column]));
        if (!changed.length) continue;
        const where: Value = { ...scope, ...Object.fromEntries(definition.keys.map(key => [key, row[key]])) };
        for (const column of changed) where[column] = ['text', 'title'].includes(column)
          ? row[column] : { equals: row[column] };
        // Prisma's automatic updatedAt must not change the original content's
        // retention age or current observation fingerprint during encryption.
        if (row.updatedAt instanceof Date) where.updatedAt = row.updatedAt;
        const data = { ...Object.fromEntries(changed.map(column => [column, encoded[column]])),
          ...(row.updatedAt instanceof Date ? { updatedAt: row.updatedAt } : {}) };
        await input.check(); wrote = true;
        if ((await delegate.updateMany({ where, data })).count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        protectedRows++;
      }
      await input.check(); completed = true;
      const last = rows[Math.min(rows.length, input.limit) - 1];
      return { model: input.model, scanned: Math.min(rows.length, input.limit), protectedRows,
        nextAfter: rows.length > input.limit && last ? event
          ? { taskId: String(last.taskId), cursor: String(last.cursor) } : snapshot
            ? { recordId: String(last.recordId), revision: Number(last.revision) } : { id: String(last.id) } : null,
        coverage: 'bounded_original_storage_page' as const, businessHashes: 'preserved' as const,
        businessExecution: 'not_authorized' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    await input.check();
    return result;
  } catch (error) {
    if (completed && wrote) throw new AiBodyStorageUnknownError();
    if (error instanceof AiTaskRepositoryError) throw error;
    if (wrote) throw new AiBodyStorageUnknownError();
    throw unavailable();
  }
}

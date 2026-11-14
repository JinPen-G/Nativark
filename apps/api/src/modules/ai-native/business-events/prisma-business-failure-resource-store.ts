/** Scoped storage for the approved resource Outbox columns and original receipt.
 * Core owns current facts, row revisions, policy and authorization. This bridge
 * starts no transaction, worker, model or accounting operation; append uses the
 * original caller's transaction and never updates a previously captured event. */
import { Prisma, type AiBusinessFailureOutbox, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_EVENTS_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { BusinessFailureError, configurationFailureOriginSchema, type BusinessFailureResourcePorts,
  type FailureScope, type ResourceFailureReference } from './prisma-business-failure-outbox';

type QueryDb = Pick<PrismaClient, '$queryRaw'>;
type Storage = Pick<BusinessFailureResourcePorts, 'readBinding' | 'assertStorage' | 'append'>;
type Append = Parameters<Storage['append']>[1];
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const uint = z.number().int().min(0).max(4294967294), revision = uint.min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/u), instant = z.string().max(40).datetime({ offset: true });
const date = z.date().refine(value => Number.isFinite(value.getTime()));
const scope = z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict();
const section = z.enum(['workspace_profile', 'accounts_roles', 'fulfillment_network', 'business_rule', 'business_calendar',
  'item_groups', 'pricing_groups_rates', 'price_version', 'membership_base']);
const referenceSchema: z.ZodType<ResourceFailureReference> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('order_assignment'), id, rowRevision: revision, sourceHash: hash,
    dueAt: instant, locationId: id, policyId: id, policyRevision: revision }).strict(),
  configurationFailureOriginSchema.extend({ rowRevision: revision, sourceHash: hash, sectionCode: section })
]);
const base = { draftVersion: z.literal(AI_EVENTS_DRAFT_VERSION), eventId: z.string().uuid(), eventVersion: z.literal('1'),
  scope, occurredAt: instant, traceId: hash, causationId: hash, deduplicationKey: hash, causalDepth: z.literal(1) };
const appendSchema = z.object({ reference: referenceSchema, expiresAt: date,
  failureCode: z.enum(['resource_shortage', 'missing_configuration']), event: z.discriminatedUnion('type', [
    z.object({ ...base, type: z.literal('fulfillment.resource_shortage'), resource: z.object({ kind: z.literal('order'), id, version: revision }).strict(),
      payload: z.object({ dueAt: instant, locationId: id }).strict() }).strict(),
    z.object({ ...base, type: z.literal('opening.missing_configuration'), resource: z.object({ kind: z.literal('configuration'), id, version: revision }).strict(),
      payload: z.object({ sectionCode: section }).strict() }).strict()
  ]) }).strict();
const rowSchema = z.object({ id: z.string().uuid(), tenantId: id, workspaceId: id,
  eventType: z.enum(['fulfillment.resource_shortage', 'opening.missing_configuration']),
  notificationId: z.null(), refundId: z.null(), inspectionId: z.null(), exceptionId: z.null(),
  fulfillmentOrderId: id.nullable(), configurationKind: configurationFailureOriginSchema.shape.kind.nullable(), configurationId: id.nullable(),
  configurationProfileTenantId: id.nullable(), configurationSnapshotWorkspaceId: id.nullable(), configurationSettingsWorkspaceId: id.nullable(),
  sectionCode: section.nullable(), dueAt: date.nullable(), locationId: id.nullable(), sourceHash: hash,
  sourcePolicyId: id.nullable(), sourcePolicyRevision: revision.nullable(), resourceRevision: revision, orderId: id.nullable(),
  failureCode: z.enum(['resource_shortage', 'missing_configuration']), traceId: hash, causationId: hash, deduplicationKey: hash,
  occurredAt: date, expiresAt: date, status: z.enum(['pending', 'claimed', 'retry_scheduled', 'ready', 'expired', 'dead_letter', 'closed']),
  attempts: uint.max(3), fence: uint, leaseOwner: id.max(128).nullable(), leaseUntil: date.nullable(),
  nextAttemptAt: date, lastErrorCode: id.max(32).nullable(), createdAt: date, updatedAt: date }).strict();
type Row = z.infer<typeof rowSchema>;
const parse = <T>(schema: z.ZodType<T>, value: unknown, code: 'unavailable' | 'invalid_input' = 'unavailable'): T => {
  const result = schema.safeParse(structuredClone(value));
  if (!result.success) throw new BusinessFailureError(code);
  return result.data;
};
const unavailable = () => new BusinessFailureError('unavailable');

const columns = Prisma.sql`id, tenantId, workspaceId, eventType, notificationId, refundId, inspectionId, exceptionId,
  fulfillmentOrderId, configurationKind, configurationId, configurationProfileTenantId, configurationSnapshotWorkspaceId,
  configurationSettingsWorkspaceId, sectionCode, dueAt, locationId, sourceHash, sourcePolicyId, sourcePolicyRevision,
  resourceRevision, orderId, failureCode, traceId, causationId, deduplicationKey, occurredAt, expiresAt, status, attempts, fence,
  leaseOwner, leaseUntil, nextAttemptAt, lastErrorCode, createdAt, updatedAt`;
const foreignKeys: Record<string, { table: string; columns: Array<[string, string]> }> = {
  ai_failure_outbox_workspace_fk: { table: 'business_workspaces', columns: [['tenantId', 'tenantId'], ['workspaceId', 'id']] },
  ai_failure_outbox_fulfillment_fk: { table: 'rental_orders', columns: [['tenantId', 'tenantId'], ['workspaceId', 'workspaceId'], ['fulfillmentOrderId', 'id']] },
  ai_failure_outbox_location_fk: { table: 'rental_fulfillment_locations', columns: [['tenantId', 'tenantId'], ['workspaceId', 'workspaceId'], ['locationId', 'id']] },
  ai_failure_outbox_config_profile_fk: { table: 'tenant_rental_profiles', columns: [['configurationProfileTenantId', 'tenantId']] },
  ai_failure_outbox_config_snapshot_fk: { table: 'rental_core_state_snapshots', columns: [['tenantId', 'tenantId'], ['configurationSnapshotWorkspaceId', 'workspaceId']] },
  ai_failure_outbox_config_settings_fk: { table: 'rental_tenant_business_settings', columns: [['tenantId', 'tenantId'], ['configurationSettingsWorkspaceId', 'workspaceId']] }
};

// The original resource conditions, with an explicit boolean comparison for
// MySQL CHECK typing. The forward repair preserves FALSE for a NULL predicate;
// this schema witness is not a second resource rule or SQL to execute.
const approvedResourceCheck = `COALESCE((
  (
    fulfillmentOrderId IS NULL AND configurationKind IS NULL AND configurationId IS NULL
    AND configurationProfileTenantId IS NULL AND configurationSnapshotWorkspaceId IS NULL
    AND configurationSettingsWorkspaceId IS NULL AND sectionCode IS NULL
    AND dueAt IS NULL AND locationId IS NULL AND sourceHash IS NULL
    AND sourcePolicyId IS NULL AND sourcePolicyRevision IS NULL
    AND (
      (eventType = 'notification.failed' AND notificationId IS NOT NULL AND refundId IS NULL
        AND inspectionId IS NULL AND exceptionId IS NULL AND failureCode = 'delivery_failed')
      OR (eventType = 'refund.failed' AND refundId IS NOT NULL AND notificationId IS NULL
        AND inspectionId IS NULL AND exceptionId IS NULL AND orderId IS NOT NULL AND failureCode = 'provider_failed')
      OR (eventType = 'inspection.return_exception' AND inspectionId IS NOT NULL
        AND exceptionId IS NOT NULL AND CHAR_LENGTH(exceptionId) > 0
        AND notificationId IS NULL AND refundId IS NULL AND orderId IS NOT NULL AND failureCode = 'review_pending')
    )
  )
  OR (
    eventType = 'fulfillment.resource_shortage' AND failureCode = 'resource_shortage'
    AND notificationId IS NULL AND refundId IS NULL AND inspectionId IS NULL AND exceptionId IS NULL
    AND fulfillmentOrderId IS NOT NULL AND orderId IS NOT NULL AND orderId = fulfillmentOrderId
    AND dueAt IS NOT NULL AND dueAt > occurredAt AND locationId IS NOT NULL
    AND sourceHash IS NOT NULL AND REGEXP_LIKE(sourceHash, '^[a-f0-9]{64}$', 'c')
    AND sourcePolicyId IS NOT NULL AND CHAR_LENGTH(sourcePolicyId) > 0
    AND sourcePolicyRevision IS NOT NULL AND sourcePolicyRevision BETWEEN 1 AND 4294967294
    AND configurationKind IS NULL AND configurationId IS NULL AND configurationProfileTenantId IS NULL
    AND configurationSnapshotWorkspaceId IS NULL AND configurationSettingsWorkspaceId IS NULL AND sectionCode IS NULL
  )
  OR (
    eventType = 'opening.missing_configuration' AND failureCode = 'missing_configuration'
    AND notificationId IS NULL AND refundId IS NULL AND inspectionId IS NULL AND exceptionId IS NULL
    AND orderId IS NULL AND fulfillmentOrderId IS NULL AND dueAt IS NULL AND locationId IS NULL
    AND sourcePolicyId IS NULL AND sourcePolicyRevision IS NULL
    AND configurationKind IS NOT NULL AND configurationId IS NOT NULL AND CHAR_LENGTH(configurationId) > 0
    AND sourceHash IS NOT NULL AND REGEXP_LIKE(sourceHash, '^[a-f0-9]{64}$', 'c')
    AND sectionCode IS NOT NULL AND sectionCode IN (
      'workspace_profile', 'accounts_roles', 'fulfillment_network', 'business_rule', 'business_calendar',
      'item_groups', 'pricing_groups_rates', 'price_version', 'membership_base'
    )
    AND (
      (configurationKind = 'tenant_profile' AND configurationProfileTenantId IS NOT NULL
        AND configurationProfileTenantId = tenantId AND configurationId = configurationProfileTenantId
        AND configurationSnapshotWorkspaceId IS NULL AND configurationSettingsWorkspaceId IS NULL)
      OR (configurationKind = 'core_snapshot' AND configurationSnapshotWorkspaceId IS NOT NULL
        AND configurationSnapshotWorkspaceId = workspaceId AND configurationId = configurationSnapshotWorkspaceId
        AND configurationProfileTenantId IS NULL AND configurationSettingsWorkspaceId IS NULL)
      OR (configurationKind = 'business_settings' AND configurationSettingsWorkspaceId IS NOT NULL
        AND configurationSettingsWorkspaceId = workspaceId AND configurationId = configurationSettingsWorkspaceId
        AND configurationProfileTenantId IS NULL AND configurationSnapshotWorkspaceId IS NULL)
    )
  )
), FALSE) = TRUE`;

type CheckToken = { kind: 'word' | 'identifier' | 'string' | 'integer' | 'symbol'; value: string };
type CheckNode = string | readonly CheckNode[];

/** Parse only this CHECK's SQL expression grammar. MySQL's redundant brackets,
 * identifier quoting, Unicode string introducers and FALSE/0 may differ; AND/OR
 * precedence, null tests, operands and every literal must retain their meaning.
 * Only the information_schema read may contain MySQL's escaped quote wrapper
 * around an adjacent _utf8mb4 ASCII literal. It is not general SQL unescaping.
 * Unknown syntax, comments, collations and executable constructs fail closed. */
function resourceCheckStructure(clause: string, metadata = false): string {
  if (!clause || clause.length > 65536) throw unavailable();
  const tokens: CheckToken[] = [];
  let offset = 0;
  while (offset < clause.length) {
    const character = clause[offset];
    if (/\s/u.test(character)) { offset++; continue; }
    if (character === "'" || character === '`') {
      const quote = character;
      let value = '', closed = false;
      offset++;
      while (offset < clause.length) {
        const next = clause[offset++];
        if (next === '\\') throw unavailable();
        if (next !== quote) { value += next; continue; }
        if (clause[offset] === quote) { value += quote; offset++; continue; }
        closed = true; break;
      }
      if (!closed || quote === '`' && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) throw unavailable();
      tokens.push({ kind: quote === '`' ? 'identifier' : 'string', value: quote === '`' ? value.toLowerCase() : value });
    } else {
      const word = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(clause.slice(offset));
      const integer = /^[0-9]+/u.exec(clause.slice(offset));
      if (word) {
        const value = word[0].toLowerCase();
        tokens.push({ kind: 'word', value }); offset += word[0].length;
        if (metadata && value === '_utf8mb4' && clause.slice(offset, offset + 2) === "\\'") {
          // MySQL 8.4 CHECK_CLAUSE can wrap these literals with literal 5C27
          // bytes, regardless of sql_mode. Decode only the two delimiters;
          // an interior escape, quote or non-ASCII byte remains invalid.
          offset += 2;
          let literal = '', closed = false;
          while (offset < clause.length) {
            const next = clause[offset++];
            if (next === '\\') {
              if (clause[offset] !== "'") throw unavailable();
              offset++; closed = true; break;
            }
            if (next === "'" || next < ' ' || next > '~') throw unavailable();
            literal += next;
          }
          if (!closed) throw unavailable();
          tokens.push({ kind: 'string', value: literal });
        }
      }
      else if (integer) { tokens.push({ kind: 'integer', value: integer[0].replace(/^0+(?=[0-9])/u, '') }); offset += integer[0].length; }
      else if ('(),=>'.includes(character)) { tokens.push({ kind: 'symbol', value: character }); offset++; }
      else throw unavailable();
    }
    if (tokens.length > 4096) throw unavailable();
  }
  let cursor = 0, depth = 0;
  const take = (value: string) => {
    const token = tokens[cursor];
    if (token && (token.kind === 'word' || token.kind === 'symbol') && token.value === value) { cursor++; return true; }
    return false;
  };
  const expect = (value: string) => { if (!take(value)) throw unavailable(); };
  const primary = (): CheckNode => {
    if (++depth > 128) throw unavailable();
    try {
      if (take('(')) { const value = disjunction(); expect(')'); return value; }
      const token = tokens[cursor++];
      if (!token) throw unavailable();
      if (token.kind === 'string') return ['string', token.value];
      if (token.kind === 'integer') return ['integer', token.value];
      if (token.kind !== 'word' && token.kind !== 'identifier') throw unavailable();
      if (token.kind === 'word') {
        if (token.value === 'false' || token.value === 'true') return ['integer', token.value === 'false' ? '0' : '1'];
        if (['_utf8mb4', '_utf8mb3', '_utf8'].includes(token.value)) {
          const value = tokens[cursor++];
          if (value?.kind !== 'string' || !/^[\x20-\x7e]*$/u.test(value.value)) throw unavailable();
          return ['string', value.value];
        }
        if (take('(')) {
          if (!['coalesce', 'char_length', 'regexp_like'].includes(token.value)) throw unavailable();
          const args: CheckNode[] = [disjunction()];
          while (take(',')) args.push(disjunction());
          expect(')');
          if (args.length !== (token.value === 'char_length' ? 1 : token.value === 'coalesce' ? 2 : 3)) throw unavailable();
          return ['call', token.value, ...args];
        }
      }
      return ['identifier', token.value];
    } finally { depth--; }
  };
  const predicate = (): CheckNode => {
    const left = primary();
    if (take('is')) { const not = take('not'); expect('null'); return ['null', not ? 'not' : 'is', left]; }
    if (take('between')) { const lower = primary(); expect('and'); return ['between', left, lower, primary()]; }
    if (take('in')) {
      expect('('); const values: CheckNode[] = [primary()];
      while (take(',')) values.push(primary());
      expect(')'); return ['in', left, ...values];
    }
    if (take('=')) return ['=', left, primary()];
    if (take('>')) return ['>', left, primary()];
    return left;
  };
  const logical = (operator: 'and' | 'or', read: () => CheckNode): CheckNode => {
    const terms: CheckNode[] = [];
    const append = (value: CheckNode) => {
      if (Array.isArray(value) && value[0] === operator) terms.push(...value.slice(1));
      else terms.push(value);
    };
    append(read()); while (take(operator)) append(read());
    return terms.length === 1 ? terms[0] : [operator, ...terms];
  };
  const conjunction = (): CheckNode => logical('and', predicate);
  const disjunction = (): CheckNode => logical('or', conjunction);
  const result = disjunction();
  if (cursor !== tokens.length) throw unavailable();
  return JSON.stringify(result);
}
const approvedResourceCheckStructure = resourceCheckStructure(approvedResourceCheck);

function reference(row: Row): ResourceFailureReference {
  if (row.eventType === 'fulfillment.resource_shortage') {
    if (row.fulfillmentOrderId !== row.orderId || !row.orderId || row.configurationKind || row.configurationId
      || row.configurationProfileTenantId || row.configurationSnapshotWorkspaceId || row.configurationSettingsWorkspaceId
      || row.sectionCode || !row.dueAt || !row.locationId || !row.sourcePolicyId || !row.sourcePolicyRevision
      || row.failureCode !== 'resource_shortage') throw unavailable();
    return parse(referenceSchema, { kind: 'order_assignment', id: row.orderId, rowRevision: row.resourceRevision, sourceHash: row.sourceHash,
      dueAt: row.dueAt.toISOString(), locationId: row.locationId, policyId: row.sourcePolicyId, policyRevision: row.sourcePolicyRevision });
  }
  if (row.orderId || row.fulfillmentOrderId || row.dueAt || row.locationId || row.sourcePolicyId || row.sourcePolicyRevision
    || !row.configurationKind || !row.configurationId || !row.sectionCode || row.failureCode !== 'missing_configuration') throw unavailable();
  const profile = row.configurationKind === 'tenant_profile', snapshot = row.configurationKind === 'core_snapshot';
  if (row.configurationId !== (profile ? row.tenantId : row.workspaceId)
    || row.configurationProfileTenantId !== (profile ? row.tenantId : null)
    || row.configurationSnapshotWorkspaceId !== (snapshot ? row.workspaceId : null)
    || row.configurationSettingsWorkspaceId !== (!profile && !snapshot ? row.workspaceId : null)) throw unavailable();
  return parse(referenceSchema, { kind: row.configurationKind, id: row.configurationId, rowRevision: row.resourceRevision,
    sourceHash: row.sourceHash, sectionCode: row.sectionCode });
}
function causal(scope: FailureScope, ref: ResourceFailureReference) {
  const traceId = requestFingerprint({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, kind: ref.kind, id: ref.id,
    ...(ref.kind === 'order_assignment' ? {} : { sectionCode: ref.sectionCode }) });
  const causationId = requestFingerprint({ traceId, reference: ref });
  return { traceId, causationId, deduplicationKey: requestFingerprint({ eventType: ref.kind === 'order_assignment'
    ? 'fulfillment.resource_shortage' : 'opening.missing_configuration', causationId }) };
}
function immutable(row: AiBusinessFailureOutbox) {
  return { id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, eventType: row.eventType,
    notificationId: row.notificationId, refundId: row.refundId, inspectionId: row.inspectionId, exceptionId: row.exceptionId,
    orderId: row.orderId, resourceRevision: row.resourceRevision, failureCode: row.failureCode, traceId: row.traceId,
    causationId: row.causationId, deduplicationKey: row.deduplicationKey, occurredAt: row.occurredAt, expiresAt: row.expiresAt };
}

export function createPrismaBusinessFailureResourceStorage(db: QueryDb, clock: () => Date = () => new Date()): Storage {
  if (typeof db?.$queryRaw !== 'function' || typeof clock !== 'function') throw unavailable();
  const now = () => parse(date, clock());
  const assertShape = async (reader: QueryDb) => {
    try {
      // Parsing these explicit columns precedes every write. A missing forward
      // structure is not repaired, guessed or treated as a successful capture.
      await reader.$queryRaw(Prisma.sql`SELECT ${columns} FROM ai_business_failure_outbox WHERE 1 = 0`);
      const checks = await reader.$queryRaw<Array<{ name: string; enforced: string; clause: string }>>(Prisma.sql`
        SELECT t.CONSTRAINT_NAME AS name, t.ENFORCED AS enforced, c.CHECK_CLAUSE AS clause
        FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c
          ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME
        WHERE t.CONSTRAINT_SCHEMA = DATABASE() AND t.TABLE_NAME = 'ai_business_failure_outbox'
          AND t.CONSTRAINT_NAME = 'ai_failure_outbox_resource_check' AND t.CONSTRAINT_TYPE = 'CHECK'`);
      if (!Array.isArray(checks) || checks.length !== 1 || checks[0].enforced !== 'YES' || typeof checks[0].clause !== 'string') throw unavailable();
      if (resourceCheckStructure(checks[0].clause, true) !== approvedResourceCheckStructure) throw unavailable();
      const keys = await reader.$queryRaw<Array<{ name: string; position: number; columnName: string; targetTable: string; targetColumn: string }>>(Prisma.sql`
        SELECT CONSTRAINT_NAME AS name, ORDINAL_POSITION AS position, COLUMN_NAME AS columnName,
          REFERENCED_TABLE_NAME AS targetTable, REFERENCED_COLUMN_NAME AS targetColumn
        FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE()
          AND TABLE_NAME = 'ai_business_failure_outbox' AND REFERENCED_TABLE_NAME IS NOT NULL`);
      if (!Array.isArray(keys)) throw unavailable();
      for (const [name, expected] of Object.entries(foreignKeys)) {
        const parts = keys.filter(part => part.name === name).sort((a, b) => Number(a.position) - Number(b.position));
        if (parts.length !== expected.columns.length || parts.some((part, index) => Number(part.position) !== index + 1
          || part.columnName !== expected.columns[index][0] || part.targetColumn !== expected.columns[index][1]
          || part.targetTable !== expected.table)) throw unavailable();
      }
    } catch { throw new BusinessFailureError('not_ready'); }
  };
  const load = async (reader: QueryDb, key: FailureScope & ({ id: string } | { deduplicationKey: string })): Promise<Row | null> => {
    const rows = await reader.$queryRaw<unknown[]>(Prisma.sql`SELECT ${columns} FROM ai_business_failure_outbox
      WHERE tenantId = ${key.tenantId} AND workspaceId = ${key.workspaceId}
        AND ${'id' in key ? Prisma.sql`id = ${key.id}` : Prisma.sql`deduplicationKey = ${key.deduplicationKey}`} LIMIT 2`);
    if (!Array.isArray(rows) || rows.length > 1) throw unavailable();
    if (!rows.length) return null;
    const row = parse(rowSchema, rows[0]), ref = reference(row), expected = causal(row, ref), stamp = now();
    if (row.tenantId !== key.tenantId || row.workspaceId !== key.workspaceId
      || ('id' in key ? row.id !== key.id : row.deduplicationKey !== key.deduplicationKey)
      || row.expiresAt <= row.occurredAt || row.occurredAt > stamp || row.createdAt > stamp || row.updatedAt > stamp
      || Object.entries(expected).some(([name, value]) => row[name as keyof Row] !== value)) throw unavailable();
    return row;
  };
  const links = async (reader: QueryDb, binding: FailureScope, ref: ResourceFailureReference, currentRevision: boolean) => {
    let rows: Array<{ tenantId: string; workspaceId: string; id: string; rowRevision?: number }>;
    if (ref.kind === 'order_assignment') {
      rows = await reader.$queryRaw(Prisma.sql`SELECT o.tenantId, o.workspaceId, o.id FROM rental_orders o
        JOIN rental_fulfillment_locations l ON l.tenantId = o.tenantId AND l.workspaceId = o.workspaceId AND l.id = ${ref.locationId}
        WHERE o.tenantId = ${binding.tenantId} AND o.workspaceId = ${binding.workspaceId} AND o.id = ${ref.id} LIMIT 2
          ${currentRevision ? Prisma.sql`FOR SHARE` : Prisma.empty}`);
    } else if (ref.kind === 'tenant_profile') {
      rows = await reader.$queryRaw(Prisma.sql`SELECT p.tenantId, w.id AS workspaceId, p.tenantId AS id, p.configurationRevision AS rowRevision
        FROM tenant_rental_profiles p JOIN business_workspaces w ON w.tenantId = p.tenantId
        WHERE p.tenantId = ${binding.tenantId} AND p.tenantId = ${ref.id} AND w.id = ${binding.workspaceId}
          AND w.isDefault = TRUE AND w.defaultMarker = 'default' LIMIT 2 ${currentRevision ? Prisma.sql`FOR SHARE` : Prisma.empty}`);
    } else if (ref.kind === 'core_snapshot') {
      rows = await reader.$queryRaw(Prisma.sql`SELECT tenantId, workspaceId, workspaceId AS id, configurationRevision AS rowRevision
        FROM rental_core_state_snapshots WHERE tenantId = ${binding.tenantId} AND workspaceId = ${binding.workspaceId}
          AND workspaceId = ${ref.id} LIMIT 2 ${currentRevision ? Prisma.sql`FOR SHARE` : Prisma.empty}`);
    } else {
      rows = await reader.$queryRaw(Prisma.sql`SELECT tenantId, workspaceId, workspaceId AS id, settingsRevision AS rowRevision
        FROM rental_tenant_business_settings WHERE tenantId = ${binding.tenantId} AND workspaceId = ${binding.workspaceId}
          AND workspaceId = ${ref.id} LIMIT 2 ${currentRevision ? Prisma.sql`FOR SHARE` : Prisma.empty}`);
    }
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].tenantId !== binding.tenantId || rows[0].workspaceId !== binding.workspaceId
      || rows[0].id !== ref.id || currentRevision && ref.kind !== 'order_assignment' && rows[0].rowRevision !== ref.rowRevision) throw unavailable();
  };
  const match = (row: Row, input: z.infer<typeof appendSchema>) => {
    const ref = reference(row), event = input.event;
    if (row.eventType !== event.type || row.failureCode !== input.failureCode
      || requestFingerprint(ref) !== requestFingerprint(input.reference) || row.traceId !== event.traceId
      || row.causationId !== event.causationId || row.deduplicationKey !== event.deduplicationKey
      || row.occurredAt > new Date(event.occurredAt) || row.expiresAt > input.expiresAt) throw new BusinessFailureError('conflict');
  };
  return {
    async assertStorage(tx) { if (typeof tx?.$queryRaw !== 'function' || typeof tx.$executeRaw !== 'function') throw unavailable(); await assertShape(tx); },
    async readBinding(event, tx) {
      const reader = tx ?? db;
      await assertShape(reader);
      const key = { tenantId: parse(id, event.tenantId), workspaceId: parse(id, event.workspaceId), id: parse(z.string().uuid(), event.id) };
      const row = await load(reader, key);
      if (!row || requestFingerprint(immutable(row)) !== requestFingerprint(immutable(event))) throw unavailable();
      const ref = reference(row);
      // An original receipt remains readable after its resource revision moved.
      // Current failure/basis checks belong to the original Core reader above.
      await links(reader, key, ref, false);
      return { eventId: row.id, scope: { tenantId: row.tenantId, workspaceId: row.workspaceId }, reference: ref };
    },
    async append(tx, value: Append): Promise<AiBusinessFailureOutbox> {
      const input = parse(appendSchema, value, 'invalid_input'), event = input.event, ref = input.reference;
      const binding = { tenantId: event.scope.tenantId, workspaceId: event.scope.workspaceId }, expected = causal(binding, ref), stamp = now();
      const fulfillment = ref.kind === 'order_assignment';
      // DATETIME(3) preserves a UTC instant, not an arbitrary ISO spelling.
      // Original Core Date readers supply canonical UTC strings; reject an
      // unreconstructible reference before attempting storage or changing it.
      if (event.resource.id !== ref.id || event.resource.version !== ref.rowRevision
        || Object.entries(expected).some(([name, v]) => event[name as keyof typeof event] !== v)
        || new Date(event.occurredAt) > stamp || input.expiresAt <= new Date(event.occurredAt)
        || fulfillment && (event.type !== 'fulfillment.resource_shortage' || input.failureCode !== 'resource_shortage'
          || ref.dueAt !== new Date(ref.dueAt).toISOString() || event.payload.dueAt !== ref.dueAt
          || event.payload.locationId !== ref.locationId || input.expiresAt > new Date(ref.dueAt))
        || !fulfillment && (event.type !== 'opening.missing_configuration' || input.failureCode !== 'missing_configuration'
          || event.payload.sectionCode !== ref.sectionCode || ref.id !== (ref.kind === 'tenant_profile' ? binding.tenantId : binding.workspaceId)))
        throw new BusinessFailureError('invalid_input');
      if (typeof tx?.$queryRaw !== 'function' || typeof tx.$executeRaw !== 'function') throw unavailable();
      await assertShape(tx);
      const key = { ...binding, deduplicationKey: event.deduplicationKey }, existing = await load(tx, key);
      if (existing) { match(existing, input); await links(tx, binding, reference(existing), false); return existing; }
      if (input.expiresAt <= stamp) throw new BusinessFailureError('not_ready');
      await links(tx, binding, ref, true);
      try {
        await tx.$executeRaw(Prisma.sql`INSERT INTO ai_business_failure_outbox
          (id, tenantId, workspaceId, eventType, notificationId, refundId, inspectionId, exceptionId,
           fulfillmentOrderId, configurationKind, configurationId, configurationProfileTenantId, configurationSnapshotWorkspaceId,
           configurationSettingsWorkspaceId, sectionCode, dueAt, locationId, sourceHash, sourcePolicyId, sourcePolicyRevision,
           resourceRevision, orderId, failureCode, traceId, causationId, deduplicationKey, occurredAt, expiresAt,
           status, attempts, fence, leaseOwner, leaseUntil, nextAttemptAt, lastErrorCode, createdAt, updatedAt)
          VALUES (${event.eventId}, ${binding.tenantId}, ${binding.workspaceId}, ${event.type}, NULL, NULL, NULL, NULL,
            ${fulfillment ? ref.id : null}, ${fulfillment ? null : ref.kind}, ${fulfillment ? null : ref.id},
            ${ref.kind === 'tenant_profile' ? ref.id : null}, ${ref.kind === 'core_snapshot' ? ref.id : null},
            ${ref.kind === 'business_settings' ? ref.id : null}, ${fulfillment ? null : ref.sectionCode},
            ${fulfillment ? new Date(ref.dueAt) : null}, ${fulfillment ? ref.locationId : null}, ${ref.sourceHash},
            ${fulfillment ? ref.policyId : null}, ${fulfillment ? ref.policyRevision : null}, ${ref.rowRevision},
            ${fulfillment ? ref.id : null}, ${input.failureCode}, ${event.traceId}, ${event.causationId}, ${event.deduplicationKey},
            ${new Date(event.occurredAt)}, ${input.expiresAt}, 'pending', 0, 0, NULL, NULL, ${stamp}, NULL, ${stamp}, ${stamp})
          ON DUPLICATE KEY UPDATE id = id`);
        const captured = await load(tx, key);
        if (!captured) throw unavailable();
        match(captured, input);
        await links(tx, binding, reference(captured), false);
        return captured;
      } catch { throw new BusinessFailureError('result_unknown'); }
    }
  };
}

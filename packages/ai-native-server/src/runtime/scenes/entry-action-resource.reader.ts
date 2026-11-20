/** Reads fixed original navigation resources under their own current Guard/ALS.
 * Order sources never grant member/catalog/allocation access. This leaf neither
 * issues Actions nor writes Task/business records, scans stock or calls providers.
 * Closing reads detect observed changes; they do not promise an atomic snapshot. */
import { HttpException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, type SystemUserRow } from '@rental-os/shared';
import type { ApiAuthGuard } from '../rental-adapters/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '@rental-os/platform-server/request-identity';
import { isStaffBusinessRouteAllowed } from '../rental-adapters/staff-api-policy';
import type { RentalCoreService } from '../rental-adapters/rental-core.service';
import { requestRentalOrderVisibilityWhere } from '../rental-adapters/rental-core-fact.repository';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { entryActionResourceReadSchema, entryActionOrderTargetIdSchema, entryActionOrderFactsSchema,
  entryActionCustomerFactsSchema, entryActionOrderAssociationSchema, entryActionAssignmentRowSchema,
  entryActionProductAssociationSchema, type EntryActionResourceRead, type EntryActionResourceContext,
  type EntryActionResourceObservation, type EntryActionOrderTargets } from './entry-action-resource.contract';

export interface EntryActionResourceReaderDependencies {
  db: Pick<PrismaClient, 'customerProfile' | 'rentalOrder' | '$queryRaw'>;
  core: Pick<RentalCoreService, 'readOrderFacts'> & Partial<Pick<RentalCoreService, 'listItemGroupsPage'>>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  clock?: () => Date;
}
const credentialSchema = z.object({ authorization: z.string().max(8192).regex(/^Bearer \S+$/u),
  audience: z.enum(['operator', 'staff']), requestId: z.string().min(1).max(191) }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const changed = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const same = (a: unknown, b: unknown) => requestFingerprint(a) === requestFingerprint(b);
const credentialKey = ({ authorization, audience }: z.infer<typeof credentialSchema>) => ({ authorization, audience });
const normalizeFailure = (error: unknown) => {
  if (error instanceof AiTaskRepositoryError) return error;
  if (error instanceof HttpException && [401, 403].includes(error.getStatus())) return denied();
  if (error instanceof HttpException && error.getStatus() === 409) return changed();
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (['FORBIDDEN', 'AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED'].includes(String(code))) return denied();
  return unavailable();
};

export function createEntryActionResourceReader(dependencies: EntryActionResourceReaderDependencies) {
  const d = Object.freeze({ ...dependencies }), clock = d.clock ?? (() => new Date());
  if (typeof d.guard?.canActivate !== 'function' || typeof d.credentials?.current !== 'function'
    || typeof clock !== 'function') throw unavailable();
  const now = () => { const at = clock(); if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw unavailable(); return at.toISOString(); };
  const route = ({ actionCode, targetId }: EntryActionResourceRead) => actionCode === 'OPEN_CUSTOMER'
    ? `/platform/customers/${encodeURIComponent(targetId)}` : actionCode === 'OPEN_PRODUCT' ? '/rental/v1/item-groups'
      : `/rental/v1/orders/${encodeURIComponent(targetId)}${actionCode === 'OPEN_DISPATCH' ? '/allocation-candidates' : ''}`;

  async function observe<T>(command: EntryActionResourceRead, read: (context: EntryActionResourceContext,
    wait: <R>(work: () => Promise<R>) => Promise<R>) => Promise<T>, signal?: AbortSignal) {
    let credential: z.infer<typeof credentialSchema>;
    try { credential = credentialSchema.parse(structuredClone(await d.credentials.current())); } catch { throw denied(); }
    const live = async () => {
      if (signal?.aborted) throw denied();
      let current;
      try { current = credentialSchema.parse(structuredClone(await d.credentials.current())); } catch { throw denied(); }
      if (!same(credentialKey(credential), credentialKey(current)) || signal?.aborted) throw denied();
    };
    const path = route(command), staff = credential.audience === 'staff';
    if (staff && !isStaffBusinessRouteAllowed('GET', path.toLowerCase())) throw unavailable();
    const authorize = async <R>(work: (context: EntryActionResourceContext,
      wait: <V>(read: () => Promise<V>) => Promise<V>) => Promise<R>, expected?: string) => {
      await live();
      return runWithRequestIdentity({}, async () => {
        const request = { url: `/api${path}`, originalUrl: staff ? `/api/staff/v1${path}` : `/api${path}`, method: 'GET',
          headers: { authorization: credential.authorization }, query: command.actionCode === 'OPEN_PRODUCT'
            ? { limit: 1, itemGroupId: command.targetId } : {}, body: {}, staffApiRequest: staff, user: undefined as SystemUserRow | undefined };
        try { if (await d.guard.canActivate(new ExecutionContextHost([request])) !== true) throw denied(); }
        catch (error) { throw normalizeFailure(error); }
        await live();
        const user = request.user, identity = structuredClone(getRequestIdentity());
        if (!user?.isActive || user.isSaasAdmin || !identity || identity.isSaasAdmin || identity.userId !== user.id
          || identity.tenantId !== user.tenantId || identity.audience !== credential.audience || identity.staffApi !== staff
          || !Array.isArray(user.permissions) || !identity.dataScope || !identity.locationScope
          || !Array.isArray(identity.locationScope.locationIds)
          || identity.locationScope.mode === 'all' && identity.locationScope.locationIds.length !== 0) throw denied();
        if (command.actionCode !== 'OPEN_CUSTOMER' && !identity.workspaceId) throw denied();
        const scope: EntryActionResourceContext['scope'] = command.actionCode === 'OPEN_CUSTOMER'
          ? { kind: 'tenant', tenantId: user.tenantId }
          : { kind: 'workspace', tenantId: user.tenantId, workspaceId: identity.workspaceId! };
        const locationScope: EntryActionResourceContext['access']['locationScope'] = identity.locationScope.mode === 'all'
          ? { mode: 'all', locationIds: [] } : { mode: 'selected', locationIds: [...identity.locationScope.locationIds] };
        const context: EntryActionResourceContext = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: now(),
          audience: credential.audience, actor: { kind: 'user' as const, userId: user.id }, scope,
          access: { permissions: [...user.permissions], dataScope: identity.dataScope, locationScope,
            ...(identity.organizationId ? { organizationId: identity.organizationId } : {}) } };
        if (!isAiStepExecutionContext(context) || context.actor.kind !== 'user') throw denied();
        const { authorizedAt: _at, requestId: _request, ...principal } = context;
        // Tenant-member authority is independent of workspace membership. An
        // in-flight workspace switch still changes this original observation.
        const binding = requestFingerprint({ principal, identity });
        if (expected !== undefined && binding !== expected) throw denied();
        const ambient = requestFingerprint(identity);
        const wait = async <V>(read: () => Promise<V>) => {
          await live(); if (requestFingerprint(getRequestIdentity()) !== ambient) throw denied();
          const value = await read();
          await live(); if (requestFingerprint(getRequestIdentity()) !== ambient) throw denied();
          return value;
        };
        let value!: R, failure: unknown, failed = false;
        try { value = await work(context, wait); } catch (error) { failure = error; failed = true; }
        await live(); if (requestFingerprint(getRequestIdentity()) !== ambient) throw denied();
        return { context: structuredClone(context), binding, value, failure, failed };
      });
    };
    const first = await authorize(read);
    if (first.failed) { await authorize(async () => undefined, first.binding); throw normalizeFailure(first.failure); }
    const second = await authorize(read, first.binding);
    const closing = await authorize(async () => undefined, first.binding);
    if (second.failed) throw normalizeFailure(second.failure);
    if (!same(first.value, second.value)) throw changed();
    return { context: closing.context, value: second.value, observedAt: now() };
  }

  const orderFacts = async (context: EntryActionResourceContext, id: string, wait: <R>(read: () => Promise<R>) => Promise<R>) => {
    if (context.scope.kind !== 'workspace' || typeof d.core?.readOrderFacts !== 'function') throw unavailable();
    const row = entryActionOrderFactsSchema.parse(await wait(() => d.core.readOrderFacts(context.scope.tenantId, id)));
    if (row.id !== id || row.tenantId !== context.scope.tenantId || row.workspaceId !== context.scope.workspaceId) throw unavailable();
    return row;
  };
  const assignment = async (row: z.infer<typeof entryActionOrderFactsSchema>, wait: <R>(read: () => Promise<R>) => Promise<R>) => {
    if (typeof d.db?.$queryRaw !== 'function') throw unavailable();
    // Project the original revision only; operation-lock tokens/history never
    // enter this reader. Bind SQL to the already-visible original order version.
    const rows = await wait(() => d.db.$queryRaw<unknown[]>(prismaRuntime.sql`SELECT id, tenantId, workspaceId, updatedAt,
      JSON_TYPE(assignment) AS assignmentType, JSON_TYPE(JSON_EXTRACT(assignment, '$.revision')) AS revisionType,
      CASE WHEN JSON_TYPE(JSON_EXTRACT(assignment, '$.revision')) = 'INTEGER'
        THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(assignment, '$.revision')) AS UNSIGNED) ELSE NULL END AS assignmentRevision
      FROM rental_orders WHERE id = ${row.id} AND tenantId = ${row.tenantId} AND workspaceId = ${row.workspaceId}
        AND updatedAt = ${new Date(row.updatedAt)} LIMIT 1`));
    if (!Array.isArray(rows) || rows.length !== 1) throw changed();
    const found = entryActionAssignmentRowSchema.parse(rows[0]);
    if (found.id !== row.id || found.tenantId !== row.tenantId || found.workspaceId !== row.workspaceId
      || found.updatedAt.toISOString() !== row.updatedAt) throw changed();
    if (found.assignmentType === null || found.assignmentType === 'NULL') {
      if (found.revisionType !== null || found.assignmentRevision !== null) throw unavailable();
      return null; // Missing original assignment is not a fabricated revision.
    }
    const revision = found.assignmentRevision;
    if (found.assignmentType !== 'OBJECT' || found.revisionType !== 'INTEGER'
      || typeof revision !== 'number' && typeof revision !== 'bigint') throw unavailable();
    const result = Number(revision);
    if (!Number.isSafeInteger(result) || result < 0 || result > 4294967295) throw unavailable();
    return result;
  };

  return Object.freeze({
    async read(value: unknown, signal?: AbortSignal): Promise<EntryActionResourceObservation> {
      const parsed = entryActionResourceReadSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = parsed.data;
      const found = await observe(command, async (context, wait) => {
        if (command.actionCode === 'OPEN_CUSTOMER') {
          if (typeof d.db?.customerProfile?.findFirst !== 'function') throw unavailable();
          const customer = entryActionCustomerFactsSchema.parse(await wait(() => d.db.customerProfile.findFirst({
            where: { id: command.targetId, tenantId: context.scope.tenantId },
            select: { id: true, tenantId: true, name: true, customerType: true, ordinaryRevision: true } })));
          if (customer.id !== command.targetId || customer.tenantId !== context.scope.tenantId) throw unavailable();
          return { kind: 'customer' as const, id: customer.id, label: customer.name, customerType: customer.customerType, basis: customer };
        }
        if (command.actionCode === 'OPEN_PRODUCT') {
          if (context.scope.kind !== 'workspace' || typeof d.core?.listItemGroupsPage !== 'function') throw unavailable();
          const catalog = new AiCatalogReadFactsService({ listItemGroupsPage: d.core.listItemGroupsPage.bind(d.core) },
            new AiBusinessReadRouteAuthority(d.guard, d.credentials, clock), clock);
          const page = await wait(() => catalog.read({ limit: 1, itemGroupId: command.targetId }, context));
          const product = page.items[0];
          if (page.items.length !== 1 || product.id !== command.targetId || !same(page.scope, context.scope)) throw unavailable();
          return { kind: 'item_group' as const, id: product.id, label: product.name,
            basis: { product, configurationVersion: page.configurationVersion, scope: page.scope } };
        }
        const order = await orderFacts(context, command.targetId, wait);
        return command.actionCode === 'OPEN_DISPATCH'
          ? { kind: 'order_allocation' as const, id: order.id, label: order.orderNo, basis: { order, assignmentRevision: await assignment(order, wait) } }
          : { kind: 'order' as const, id: order.id, label: order.orderNo, basis: order };
      }, signal);
      const { kind, id, label, basis } = found.value;
      return { context: found.context, resource: { kind, id, resourceVersion: requestFingerprint({ kind, id, basis }),
        ...(found.value.kind === 'customer' ? { customerType: found.value.customerType } : {}) },
        label, observedAt: found.observedAt };
    },
    async targetsFromOrder(value: unknown, signal?: AbortSignal): Promise<EntryActionOrderTargets> {
      const parsed = entryActionOrderTargetIdSchema.safeParse(value);
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const found = await observe({ actionCode: 'OPEN_ORDER', targetId: parsed.data }, async (context, wait) => {
        const order = await orderFacts(context, parsed.data, wait);
        if (typeof d.db?.rentalOrder?.findFirst !== 'function' || typeof d.db.$queryRaw !== 'function') throw unavailable();
        const association = entryActionOrderAssociationSchema.parse(await wait(() => d.db.rentalOrder.findFirst({
          where: { id: order.id, tenantId: order.tenantId, workspaceId: order.workspaceId, ...requestRentalOrderVisibilityWhere() },
          select: { id: true, tenantId: true, workspaceId: true, customerId: true, customerType: true, updatedAt: true } })));
        if (association.id !== order.id || association.tenantId !== order.tenantId || association.workspaceId !== order.workspaceId
          || association.updatedAt.toISOString() !== order.updatedAt) throw changed();
        const assignmentRevision = await assignment(order, wait);
        const rows = await wait(() => d.db.$queryRaw<unknown[]>(prismaRuntime.sql`SELECT DISTINCT l.itemGroupId,
          g.tenantId AS itemTenantId, g.workspaceId AS itemWorkspaceId FROM rental_order_lines l
          JOIN rental_orders o ON o.id = l.orderId LEFT JOIN rental_item_groups g ON g.id = l.itemGroupId
          WHERE o.id = ${order.id} AND o.tenantId = ${order.tenantId} AND o.workspaceId = ${order.workspaceId}
            AND o.updatedAt = ${association.updatedAt} ORDER BY l.itemGroupId LIMIT 21`));
        if (!Array.isArray(rows) || rows.length > 20) throw unavailable();
        const products = rows.map(row => entryActionProductAssociationSchema.parse(row));
        if (products.some(row => row.itemTenantId !== order.tenantId || row.itemWorkspaceId !== order.workspaceId)
          || new Set(products.map(row => row.itemGroupId)).size !== products.length) throw unavailable();
        return { order, customer: association.customerId ? { id: association.customerId, type: association.customerType } : null,
          productIds: products.map(row => row.itemGroupId), assignmentRevision };
      }, signal);
      return { context: found.context, order: { id: found.value.order.id, version: found.value.order.updatedAt,
        resourceVersion: requestFingerprint(found.value), assignmentRevision: found.value.assignmentRevision },
      customer: found.value.customer, productIds: found.value.productIds, observedAt: found.observedAt };
    }
  });
}

/** Persist one short-lived transfer of an ORIGINAL Booking handoff. This leaf
 * locks the same Draft as the existing submission path and appends only scoped
 * metadata to OperationLog. It never copies/decrypts customer bodies, creates
 * Task/Draft/quote/order, changes the Booking state machine or grants execution.
 * The required Auth/Core ports and the source/target submission interlock must
 * be installed by the owning host; missing ports fail closed. */
import { randomUUID } from 'node:crypto';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_BOOKING_DRAFT_STATES } from '@rental-os/shared';
import { requestFingerprint as hash } from '../rental-adapters/rental-idempotency.repository';
import { AiClientEntryError, entryHash, entryId } from './client-entry-action';
import { clientSqlPolicyRevisionSchema } from './client-sql-revisions';
import {
  CLIENT_BOOKING_TRANSFER_LIFETIME_MS, clientBookingTransferBindingSchema, clientBookingTransferConsumeCommandSchema,
  clientBookingTransferConsumeReceiptSchema, clientBookingTransferCustomerHash, clientBookingTransferIndexSchema,
  clientBookingTransferIssueCommandSchema, clientBookingTransferIssueReceiptSchema, clientBookingTransferOriginalOperationKey,
  clientBookingTransferOriginalProofSchema, clientBookingTransferOriginalSchema, clientBookingTransferPrincipalHash,
  clientBookingTransferPrincipalSchema, clientBookingTransferReceiptSchema, clientBookingTransferScopeSchema, clientBookingTransferTargetLocatorSchema,
  clientBookingTransferTargetLookupSchema,
  type ClientBookingTransferAuthority, type ClientBookingTransferBinding, type ClientBookingTransferConsumeReceipt,
  type ClientBookingTransferDatabase, type ClientBookingTransferIndex, type ClientBookingTransferIssueReceipt,
  type ClientBookingTransferOriginal, type ClientBookingTransferPrincipal, type ClientBookingTransferReceipt,
  type ClientBookingTransferScope, type ClientBookingTransferSourceInterlock, type ClientBookingTransferTransaction,
  type ClientBookingTransferTargetLocator
} from './client-booking-transfer.contract';

const instant = z.date().refine(value => Number.isFinite(value.getTime()));
const selectionRevision = z.union([z.number().int().min(0).max(1), z.bigint().min(0n).max(1n)]).transform(Number);
// Only original lock/identity/version metadata is read. Body ciphertext remains
// under its original channel/principal binding in AiClientSceneMaterial.
const draftMetadata = z.object({ id: z.string().uuid(), ...clientBookingTransferScopeSchema.shape,
  materialRef: z.string().uuid(), inputHash: entryHash, bindingHash: entryHash, policyHash: entryHash,
  state: z.enum(AI_BOOKING_DRAFT_STATES), revision: clientSqlPolicyRevisionSchema,
  selectionRevision, selectedAt: instant.nullable(), createdAt: instant, expiresAt: instant });
const handoffMetadata = z.object({ id: z.string().uuid(), ...clientBookingTransferScopeSchema.shape,
  draftId: z.string().uuid(), inputHash: entryHash, selectionRevision,
  createdAt: instant, expiresAt: instant });
const materialMetadata = z.object({ id: z.string().uuid(), ...clientBookingTransferScopeSchema.shape,
  operationKey: entryId, inputHash: entryHash, materialHash: entryHash, bindingHash: entryHash, publicationHash: entryHash,
  createdAt: instant, expiresAt: instant, erasedAt: instant.nullable().optional() });
type Draft = z.infer<typeof draftMetadata>;
type Handoff = z.infer<typeof handoffMetadata>;
type Material = z.infer<typeof materialMetadata>;
type Reader = ClientBookingTransferTransaction;
const actions = { issue: 'ai_native_booking_transfer_issue', consume: 'ai_native_booking_transfer_consume',
  index: 'ai_native_booking_transfer_index' } as const;
const denied = () => new AiClientEntryError('AI_ACCESS_DENIED', 'booking_transfer_authority_changed');
const conflict = () => new AiClientEntryError('AI_REVISION_CONFLICT', 'booking_transfer_operation_conflict');
const unavailable = () => new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'booking_transfer_dependencies_unavailable');
const stale = () => new AiClientEntryError('AI_PROPOSAL_STALE', 'booking_transfer_original_stale', 'reprepare');
const unknown = () => new AiClientEntryError('AI_RESULT_UNKNOWN', 'booking_transfer_commit_unacknowledged', 'read_booking_operation');
const scoped = (value: Pick<ClientBookingTransferScope, 'tenantId' | 'workspaceId'>) =>
  ({ tenantId: value.tenantId, workspaceId: value.workspaceId });
const scopeOf = (value: Pick<ClientBookingTransferScope, 'tenantId' | 'workspaceId' | 'channel' | 'principalHash'>): ClientBookingTransferScope =>
  clientBookingTransferScopeSchema.parse({ ...scoped(value), channel: value.channel, principalKind: 'personal', principalHash: value.principalHash });
const key = (kind: string, value: unknown) => `booking-transfer:${kind}:${hash(value)}`;
const issueId = (scope: ClientBookingTransferScope, draftId: string) => key('original', { ...scoped(scope), draftId });
const consumeId = (scope: ClientBookingTransferScope, draftId: string) => key('consumed', { ...scoped(scope), draftId });
const referenceId = (scope: Pick<ClientBookingTransferScope, 'tenantId' | 'workspaceId'>, transferRef: string) =>
  key('reference', { ...scoped(scope), transferRef });
const operationId = (kind: 'issue' | 'consume', scope: ClientBookingTransferScope, operationKey: string) =>
  key(`${kind}-operation`, { scope, operationKey });
const targetLocatorId = (kind: ClientBookingTransferTargetLocator['kind'], scope: ClientBookingTransferScope, locatorRef: string) =>
  key(`target-${kind}`, { scope, locatorRef });
const principalIdentity = (value: ClientBookingTransferPrincipal) => ({ ...scopeOf(value), appId: value.appId,
  customerHash: clientBookingTransferCustomerHash(value) });
const bindingIdentity = (value: ClientBookingTransferBinding) => ({ ...scopeOf(value), appId: value.appId, customerHash: value.customerHash });
const liveBasis = (value: ClientBookingTransferPrincipal) => ({ ...principalIdentity(value), bindingHash: value.bindingHash,
  publicationHash: value.publicationHash, policyHash: value.policyHash });
const issueRequestHash = (source: ClientBookingTransferPrincipal, value: unknown) => hash({ source: principalIdentity(source), command: value });
const consumeRequestHash = (target: ClientBookingTransferPrincipal, value: unknown) => hash({ target: principalIdentity(target), command: value });
// Original requestFingerprint sorts JSON keys but does not serialize Date
// objects. Metadata comparisons must include their recorded ISO timestamps.
const equal = (left: unknown, right: unknown) =>
  hash(JSON.parse(JSON.stringify(left ?? null))) === hash(JSON.parse(JSON.stringify(right ?? null)));
const options = { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 };

export class ClientBookingTransferRepository {
  constructor(private readonly db: ClientBookingTransferDatabase, private readonly authority: ClientBookingTransferAuthority,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.$transaction !== 'function' || typeof db.$queryRaw !== 'function'
      || typeof db.operationLog?.findUnique !== 'function' || typeof db.operationLog.create !== 'function'
      || typeof authority?.source !== 'function' || typeof authority.target !== 'function' || typeof authority.original !== 'function'
      || typeof clock !== 'function') throw unavailable();
  }

  private now() {
    const value = this.clock();
    if (!instant.safeParse(value).success) throw unavailable();
    return value;
  }
  private principal(value: unknown, write = false) {
    const principal = clientBookingTransferPrincipalSchema.parse(structuredClone(value)), now = this.now().getTime();
    if (principal.principalHash !== clientBookingTransferPrincipalHash(principal)
      || Date.parse(principal.authorizedAt) > now || Date.parse(principal.expiresAt) <= now
      || Date.parse(principal.expiresAt) <= Date.parse(principal.authorizedAt)
      || write && (!principal.policyHash || now - Date.parse(principal.authorizedAt) > CLIENT_BOOKING_TRANSFER_LIFETIME_MS)) throw denied();
    return principal;
  }
  private binding(principal: ClientBookingTransferPrincipal) {
    if (!principal.policyHash) throw denied();
    return clientBookingTransferBindingSchema.parse({ ...scopeOf(principal), appId: principal.appId,
      customerHash: clientBookingTransferCustomerHash(principal), bindingHash: principal.bindingHash,
      publicationHash: principal.publicationHash, policyHash: principal.policyHash, authorizedUntil: principal.expiresAt });
  }
  private async log<T>(reader: Reader, id: string, scope: Pick<ClientBookingTransferScope, 'tenantId' | 'workspaceId'>,
    action: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T | null> {
    const row = await reader.operationLog.findUnique({ where: { id }, select: {
      id: true, tenantId: true, workspaceId: true, userId: true, rentalOrderId: true, action: true, detail: true, createdAt: true } });
    if (!row) return null;
    try {
      const detail = z.object({ payload: z.unknown(), payloadHash: entryHash }).strict().parse(structuredClone(row.detail));
      const payload = schema.parse(detail.payload);
      const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      if (row.id !== id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId || row.action !== action
        || row.userId !== null || row.rentalOrderId !== null || !instant.safeParse(row.createdAt).success
        || row.createdAt > this.now() || size > 8192 || hash(payload) !== detail.payloadHash) throw unavailable();
      if (action === actions.issue || action === actions.consume) {
        const timestamp = action === actions.issue
          ? z.object({ issuedAt: z.string() }).parse(payload).issuedAt
          : z.object({ consumedAt: z.string() }).parse(payload).consumedAt;
        if (row.createdAt.toISOString() !== timestamp) throw unavailable();
      }
      return payload;
    } catch { throw unavailable(); }
  }
  private async append(reader: Reader, id: string, scope: ClientBookingTransferScope, action: string, payload: unknown, at: Date) {
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 8192) throw unavailable();
    await reader.operationLog.create({ data: { id, ...scoped(scope), userId: null, rentalOrderId: null, action,
      detail: { payload: JSON.parse(JSON.stringify(payload)), payloadHash: hash(payload) }, createdAt: at } });
  }
  private async one<T extends ClientBookingTransferScope>(reader: Reader, query: Prisma.Sql,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>, scope: ClientBookingTransferScope) {
    const rows = await reader.$queryRaw<unknown[]>(query);
    if (!Array.isArray(rows) || rows.length > 1) throw unavailable();
    if (!rows.length) return null;
    const value = schema.parse(rows[0]);
    if (!equal(scopeOf(value), scope)) throw denied();
    return value;
  }
  private draft(reader: Reader, scope: ClientBookingTransferScope, draftId: string) {
    return this.one(reader, prismaRuntime.sql`SELECT id, tenantId, workspaceId, channel, principalKind, principalHash,
      materialRef, inputHash, bindingHash, policyHash, state, revision, selectionRevision, selectedAt, createdAt, expiresAt
      FROM ai_client_booking_drafts WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId}
      AND channel = ${scope.channel} AND principalHash = ${scope.principalHash} AND id = ${draftId} LIMIT 1 FOR UPDATE`, draftMetadata, scope);
  }
  private handoff(reader: Reader, scope: ClientBookingTransferScope, handoffRef: string) {
    return this.one(reader, prismaRuntime.sql`SELECT id, tenantId, workspaceId, channel, principalKind, principalHash,
      draftId, inputHash, selectionRevision, createdAt, expiresAt FROM ai_client_booking_handoffs
      WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND channel = ${scope.channel}
      AND principalHash = ${scope.principalHash} AND id = ${handoffRef} LIMIT 1`, handoffMetadata, scope);
  }
  private material(reader: Reader, scope: ClientBookingTransferScope, materialRef: string) {
    return this.one(reader, prismaRuntime.sql`SELECT id, tenantId, workspaceId, channel, principalKind, principalHash,
      operationKey, inputHash, materialHash, bindingHash, publicationHash, createdAt, expiresAt, erasedAt
      FROM ai_client_scene_materials WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId}
      AND channel = ${scope.channel} AND principalHash = ${scope.principalHash} AND id = ${materialRef} LIMIT 1`, materialMetadata, scope);
  }
  private acceptance(reader: Reader, scope: ClientBookingTransferScope, operationKey: string) {
    return this.one(reader, prismaRuntime.sql`SELECT id, tenantId, workspaceId, channel, principalKind, principalHash,
      operationKey, inputHash, materialHash, bindingHash, publicationHash, createdAt, expiresAt, erasedAt
      FROM ai_client_scene_materials WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId}
      AND channel = ${scope.channel} AND principalHash = ${scope.principalHash} AND operationKey = ${operationKey} LIMIT 1`, materialMetadata, scope);
  }
  private assertOriginal(draft: Draft, handoff: Handoff, source: ClientBookingTransferBinding, material: Material, live: boolean) {
    const now = this.now().getTime();
    if (material.erasedAt || handoff.draftId !== draft.id || handoff.inputHash !== draft.inputHash
      || material.id !== draft.materialRef || material.inputHash !== draft.inputHash || !draft.selectedAt
      || draft.bindingHash !== source.bindingHash || material.bindingHash !== source.bindingHash
      || material.publicationHash !== source.publicationHash || draft.policyHash !== source.policyHash
      || draft.selectionRevision !== 1 || handoff.selectionRevision !== 1
      || material.createdAt > draft.createdAt || material.expiresAt <= material.createdAt || draft.expiresAt <= draft.createdAt
      || draft.selectedAt < draft.createdAt || draft.selectedAt > handoff.createdAt || handoff.createdAt < draft.createdAt
      || handoff.expiresAt > draft.expiresAt
      || handoff.expiresAt <= handoff.createdAt || handoff.expiresAt.getTime() - handoff.createdAt.getTime() > CLIENT_BOOKING_TRANSFER_LIFETIME_MS
      || live && (draft.state !== 'handed_to_booking_page' || draft.expiresAt.getTime() <= now
        || material.expiresAt.getTime() <= now || handoff.expiresAt.getTime() <= now)) throw stale();
  }
  private original(draft: Draft, handoff: Handoff, source: ClientBookingTransferBinding, material: Material) {
    this.assertOriginal(draft, handoff, source, material, true);
    return clientBookingTransferOriginalSchema.parse({ draftId: draft.id, draftRevision: draft.revision,
      selectionRevision: 1, selectedAt: draft.selectedAt!.toISOString(), materialRef: material.id,
      materialOperationKey: material.operationKey, inputHash: material.inputHash, materialHash: material.materialHash,
      materialExpiresAt: material.expiresAt.toISOString(), draftExpiresAt: draft.expiresAt.toISOString(),
      handoffRef: handoff.id, handoffCreatedAt: handoff.createdAt.toISOString(), handoffExpiresAt: handoff.expiresAt.toISOString(),
      bookingOperationKey: clientBookingTransferOriginalOperationKey(scopeOf(source), handoff.id) });
  }
  private assertLockedReceipt(draft: Draft, issue: ClientBookingTransferIssueReceipt) {
    const original = issue.original;
    if (!equal(scopeOf(issue.source), scopeOf(draft)) || draft.id !== original.draftId
      || draft.materialRef !== original.materialRef || draft.inputHash !== original.inputHash || draft.bindingHash !== issue.source.bindingHash
      || draft.policyHash !== issue.source.policyHash || draft.selectionRevision !== original.selectionRevision
      || draft.selectedAt?.toISOString() !== original.selectedAt || draft.revision < original.draftRevision
      || original.bookingOperationKey !== clientBookingTransferOriginalOperationKey(scopeOf(issue.source), original.handoffRef)) throw unavailable();
  }
  private async prove(reader: Reader, source: ClientBookingTransferBinding, original: ClientBookingTransferOriginal,
    viewer: ClientBookingTransferPrincipal, purpose: 'issue' | 'consume', expectedTargetPolicyHash?: string) {
    const proof = clientBookingTransferOriginalProofSchema.parse(await this.authority.original(
      structuredClone(source), structuredClone(original), structuredClone(viewer), purpose, reader));
    if (proof.draftId !== original.draftId || proof.draftRevision !== original.draftRevision || proof.handoffRef !== original.handoffRef
      || proof.materialRef !== original.materialRef || proof.inputHash !== original.inputHash || proof.materialHash !== original.materialHash
      || proof.selectionRevision !== original.selectionRevision || proof.customerHash !== source.customerHash
      || proof.customerHash !== clientBookingTransferCustomerHash(viewer) || proof.sourceBindingHash !== source.bindingHash
      || proof.sourcePublicationHash !== source.publicationHash || proof.sourcePolicyHash !== source.policyHash
      || expectedTargetPolicyHash !== undefined && proof.targetPolicyHash !== expectedTargetPolicyHash
      || purpose === 'consume' && (expectedTargetPolicyHash === undefined || viewer.policyHash !== expectedTargetPolicyHash)
      || Date.parse(proof.authorizedUntil) <= this.now().getTime()) throw denied();
    return proof;
  }
  private async issued(reader: Reader, scope: ClientBookingTransferScope, draftId: string) {
    const issue = await this.log(reader, issueId(scope, draftId), scope, actions.issue, clientBookingTransferIssueReceiptSchema);
    if (issue && (issue.original.draftId !== draftId || !equal(scopeOf(issue.source), scope)
      || issue.requestHash !== hash({ source: bindingIdentity(issue.source), command: {
        handoffRef: issue.original.handoffRef, targetChannel: issue.targetChannel, operationKey: issue.operationKey } })
      || issue.original.bookingOperationKey !== clientBookingTransferOriginalOperationKey(scope, issue.original.handoffRef))) throw unavailable();
    return issue;
  }
  private async byReference(reader: Reader, principal: ClientBookingTransferPrincipal, transferRef: string) {
    const pointer = await this.log(reader, referenceId(principal, transferRef), principal, actions.index, clientBookingTransferIndexSchema);
    if (!pointer) return null;
    if (pointer.kind !== 'reference' || pointer.transferRef !== transferRef) throw unavailable();
    const issue = await this.log(reader, issueId(scopeOf(principal), pointer.draftId), principal, actions.issue, clientBookingTransferIssueReceiptSchema);
    if (!issue || issue.transferRef !== transferRef || issue.original.draftId !== pointer.draftId || hash(issue) !== pointer.receiptHash
      || issue.source.tenantId !== principal.tenantId || issue.source.workspaceId !== principal.workspaceId) throw unavailable();
    if (issue.targetChannel !== principal.channel || issue.source.customerHash !== clientBookingTransferCustomerHash(principal)) throw denied();
    if (!equal(await this.issued(reader, scopeOf(issue.source), pointer.draftId), issue)) throw unavailable();
    return issue;
  }
  private async consumption(reader: Reader, issue: ClientBookingTransferIssueReceipt) {
    const scope = scopeOf(issue.source), value = await this.log(reader, consumeId(scope, issue.original.draftId), scope,
      actions.consume, clientBookingTransferConsumeReceiptSchema);
    if (value && (value.transferRef !== issue.transferRef || value.issueHash !== hash(issue)
      || value.target.channel !== issue.targetChannel || value.target.policyHash !== issue.targetPolicyHash
      || value.target.tenantId !== issue.source.tenantId
      || value.target.workspaceId !== issue.source.workspaceId || value.target.customerHash !== issue.source.customerHash
      || value.requestHash !== hash({ target: bindingIdentity(value.target), command: {
        transferRef: issue.transferRef, operationKey: value.operationKey } })
      || Date.parse(value.consumedAt) < Date.parse(issue.issuedAt) || Date.parse(value.expiresAt) > Date.parse(issue.expiresAt))) throw unavailable();
    return value;
  }
  private async verifyPointer(reader: Reader, kind: 'issue' | 'consume', scope: ClientBookingTransferScope,
    operationKey: string, issue: ClientBookingTransferIssueReceipt, receipt: ClientBookingTransferIssueReceipt | ClientBookingTransferConsumeReceipt) {
    const pointer = await this.log(reader, operationId(kind, scope, operationKey), scope, actions.index, clientBookingTransferIndexSchema);
    if (!pointer || pointer.kind !== `${kind}_operation` || pointer.transferRef !== issue.transferRef
      || pointer.draftId !== issue.original.draftId || pointer.receiptHash !== hash(receipt)) throw unavailable();
  }
  private assertTarget(viewer: ClientBookingTransferPrincipal, consumption: ClientBookingTransferConsumeReceipt) {
    if (!equal(principalIdentity(viewer), bindingIdentity(consumption.target))
      || viewer.bindingHash !== consumption.target.bindingHash) throw denied();
  }
  private locator(kind: ClientBookingTransferTargetLocator['kind'], locatorRef: string,
    issue: ClientBookingTransferIssueReceipt, consumption: ClientBookingTransferConsumeReceipt): ClientBookingTransferTargetLocator {
    return { version: 'client-booking-transfer-target-locator-1', kind, locatorRef,
      transferRef: issue.transferRef, draftId: issue.original.draftId, receiptHash: hash(consumption),
      targetPrincipalHash: consumption.target.principalHash, targetBindingHash: consumption.target.bindingHash };
  }
  private async bindLocator(reader: Reader, kind: ClientBookingTransferTargetLocator['kind'], locatorRef: string,
    issue: ClientBookingTransferIssueReceipt, consumption: ClientBookingTransferConsumeReceipt, at: Date) {
    const target = scopeOf(consumption.target), id = targetLocatorId(kind, target, locatorRef),
      payload = this.locator(kind, locatorRef, issue, consumption);
    const prior = await this.log(reader, id, target, actions.index, clientBookingTransferTargetLocatorSchema);
    if (prior) {
      if (!equal(prior, payload)) throw conflict();
      return;
    }
    await this.append(reader, id, target, actions.index, payload, at);
  }
  private assertAcceptance(material: Material, issue: ClientBookingTransferIssueReceipt) {
    if (material.erasedAt || !equal(scopeOf(material), scopeOf(issue.source))
      || material.operationKey !== issue.original.bookingOperationKey || material.bindingHash !== issue.source.bindingHash
      || material.publicationHash !== issue.source.publicationHash || material.createdAt > this.now()
      || material.createdAt.getTime() < Date.parse(issue.original.handoffCreatedAt)
      || material.expiresAt.toISOString() !== issue.original.handoffExpiresAt) throw unavailable();
  }
  private error(error: unknown, attempted: boolean): never {
    if (attempted) throw unknown();
    if (error instanceof AiClientEntryError) throw error;
    throw unavailable();
  }

  /** Original source operation observation, including issue COMMIT ACK loss.
   * Current read Auth is required; old policy/transfer TTL cannot grant use. */
  async readSourceReceipt(value: unknown): Promise<ClientBookingTransferReceipt | null> {
    const command = clientBookingTransferIssueCommandSchema.parse(structuredClone(value));
    try {
      return await this.db.$transaction(async tx => {
        const viewer = this.principal(await this.authority.source(command.handoffRef, 'read', tx)), scope = scopeOf(viewer);
        const pointer = await this.log(tx, operationId('issue', scope, command.operationKey), scope, actions.index, clientBookingTransferIndexSchema);
        if (!pointer) {
          const after = this.principal(await this.authority.source(command.handoffRef, 'read', tx));
          if (!equal(liveBasis(viewer), liveBasis(after))) throw denied();
          return null;
        }
        const issue = await this.issued(tx, scope, pointer.draftId);
        if (!issue || issue.original.handoffRef !== command.handoffRef || issue.operationKey !== command.operationKey
          || issue.targetChannel !== command.targetChannel || issue.requestHash !== issueRequestHash(viewer, command)
          || !equal(principalIdentity(viewer), bindingIdentity(issue.source))) throw conflict();
        await this.verifyPointer(tx, 'issue', scope, command.operationKey, issue, issue);
        const draft = await this.draft(tx, scope, issue.original.draftId);
        if (!draft) throw unavailable();
        this.assertLockedReceipt(draft, issue);
        const consumption = await this.consumption(tx, issue);
        const after = this.principal(await this.authority.source(command.handoffRef, 'read', tx));
        if (!equal(liveBasis(viewer), liveBasis(after)) || !equal(await this.issued(tx, scope, draft.id), issue)
          || !equal(await this.consumption(tx, issue), consumption)) throw denied();
        return { issue, consumption, currentUse: 'not_authorized_by_receipt' as const };
      }, options);
    } catch (error) { this.error(error, false); }
  }

  async issue(value: unknown): Promise<ClientBookingTransferReceipt & { replayed: boolean }> {
    const command = clientBookingTransferIssueCommandSchema.parse(structuredClone(value));
    // Same-key receipt first: no source TTL renewal, reference minting or new
    // publication/execute requirement may replace a committed original issue.
    const previous = await this.readSourceReceipt(command);
    if (previous) return { ...previous, replayed: true };
    let attempted = false;
    try {
      await this.db.$transaction(async tx => {
        const principal = this.principal(await this.authority.source(command.handoffRef, 'issue', tx), true), source = this.binding(principal);
        if (source.channel === command.targetChannel) throw denied();
        const scope = scopeOf(source), handoff = await this.handoff(tx, scope, command.handoffRef);
        if (!handoff) throw denied();
        const draft = await this.draft(tx, scope, handoff.draftId);
        if (!draft) throw denied();
        const prior = await this.issued(tx, scope, draft.id);
        if (prior) {
          if (prior.requestHash !== issueRequestHash(principal, command) || prior.operationKey !== command.operationKey) throw conflict();
          await this.verifyPointer(tx, 'issue', scope, command.operationKey, prior, prior); return;
        }
        if (await this.log(tx, operationId('issue', scope, command.operationKey), scope, actions.index,
          clientBookingTransferIndexSchema)) throw conflict();
        const material = await this.material(tx, scope, draft.materialRef);
        if (!material) throw unavailable();
        const original = this.original(draft, handoff, source, material), proof = await this.prove(tx, source, original, principal, 'issue');
        const after = this.principal(await this.authority.source(command.handoffRef, 'issue', tx), true);
        if (!equal(liveBasis(after), liveBasis(principal))) throw denied();
        const now = this.now(), expiresAt = new Date(Math.min(now.getTime() + CLIENT_BOOKING_TRANSFER_LIFETIME_MS,
          Date.parse(principal.expiresAt), Date.parse(after.expiresAt), Date.parse(proof.authorizedUntil),
          material.expiresAt.getTime(), draft.expiresAt.getTime(), handoff.expiresAt.getTime()));
        const issue = clientBookingTransferIssueReceiptSchema.parse({ version: 'client-booking-transfer-issued-1', transferRef: randomUUID(),
          operationKey: command.operationKey, requestHash: issueRequestHash(principal, command), source, original,
          targetChannel: command.targetChannel, targetPolicyHash: proof.targetPolicyHash,
          issuedAt: now.toISOString(), expiresAt: expiresAt.toISOString() });
        const latestDraft = await this.draft(tx, scope, draft.id), latestHandoff = await this.handoff(tx, scope, handoff.id), latestMaterial = await this.material(tx, scope, material.id);
        if (!latestDraft || !latestHandoff || !latestMaterial || !equal(latestDraft, draft) || !equal(latestHandoff, handoff)
          || !equal(latestMaterial, material)) throw stale();
        this.assertOriginal(latestDraft, latestHandoff, source, latestMaterial, true);
        attempted = true;
        await this.append(tx, issueId(scope, draft.id), scope, actions.issue, issue, now);
        const pointer: ClientBookingTransferIndex = { version: 'client-booking-transfer-index-1', kind: 'reference',
          transferRef: issue.transferRef, draftId: draft.id, receiptHash: hash(issue) };
        await this.append(tx, referenceId(scope, issue.transferRef), scope, actions.index, pointer, now);
        await this.append(tx, operationId('issue', scope, command.operationKey), scope, actions.index,
          { ...pointer, kind: 'issue_operation' }, now);
        const closing = this.principal(await this.authority.source(command.handoffRef, 'issue', tx), true);
        if (!equal(liveBasis(closing), liveBasis(principal))) throw denied();
        const closingProof = await this.prove(tx, source, original, closing, 'issue', issue.targetPolicyHash);
        const closingDraft = await this.draft(tx, scope, draft.id), closingHandoff = await this.handoff(tx, scope, handoff.id),
          closingMaterial = await this.material(tx, scope, material.id);
        const finalPrincipal = this.principal(await this.authority.source(command.handoffRef, 'issue', tx), true);
        if (!equal(liveBasis(finalPrincipal), liveBasis(principal)) || !equal(closingDraft, draft)
          || !equal(closingHandoff, handoff) || !equal(closingMaterial, material)) throw denied();
        if (Date.parse(issue.expiresAt) <= this.now().getTime() || Date.parse(issue.expiresAt) > Math.min(
          Date.parse(closing.expiresAt), Date.parse(finalPrincipal.expiresAt), Date.parse(closingProof.authorizedUntil))) throw stale();
      }, options);
      const receipt = await this.readSourceReceipt(command);
      if (!receipt) throw unavailable();
      return { ...receipt, replayed: !attempted };
    } catch (error) { this.error(error, attempted); }
  }

  /** Target receipt read is independently authenticated. Receipt delivery does
   * not unlock a live source bridge or another consume, even after expiry. */
  async readReceipt(value: unknown): Promise<ClientBookingTransferReceipt | null> {
    const command = clientBookingTransferConsumeCommandSchema.parse(structuredClone(value));
    try {
      return await this.db.$transaction(async tx => {
        const viewer = this.principal(await this.authority.target(command.transferRef, 'read', tx)), issue = await this.byReference(tx, viewer, command.transferRef);
        if (!issue) {
          const after = this.principal(await this.authority.target(command.transferRef, 'read', tx));
          if (!equal(liveBasis(viewer), liveBasis(after))) throw denied();
          return null;
        }
        const draft = await this.draft(tx, scopeOf(issue.source), issue.original.draftId);
        if (!draft) throw unavailable();
        this.assertLockedReceipt(draft, issue);
        const consumption = await this.consumption(tx, issue);
        if (consumption) {
          if (consumption.operationKey !== command.operationKey || consumption.requestHash !== consumeRequestHash(viewer, command)
            || !equal(bindingIdentity(consumption.target), principalIdentity(viewer))) throw conflict();
          await this.verifyPointer(tx, 'consume', scopeOf(viewer), command.operationKey, issue, consumption);
        }
        const after = this.principal(await this.authority.target(command.transferRef, 'read', tx));
        if (!equal(liveBasis(viewer), liveBasis(after)) || !equal(await this.byReference(tx, after, command.transferRef), issue)
          || !equal(await this.consumption(tx, issue), consumption)) throw denied();
        return { issue, consumption, currentUse: 'not_authorized_by_receipt' as const };
      }, options);
    } catch (error) { this.error(error, false); }
  }

  async consume(value: unknown): Promise<ClientBookingTransferReceipt & { replayed: boolean }> {
    const command = clientBookingTransferConsumeCommandSchema.parse(structuredClone(value));
    const previous = await this.readReceipt(command);
    if (previous?.consumption) return { ...previous, replayed: true };
    let attempted = false;
    try {
      await this.db.$transaction(async tx => {
        const principal = this.principal(await this.authority.target(command.transferRef, 'consume', tx), true), issue = await this.byReference(tx, principal, command.transferRef);
        if (!issue) throw denied();
        const scope = scopeOf(issue.source), draft = await this.draft(tx, scope, issue.original.draftId);
        if (!draft) throw unavailable();
        this.assertLockedReceipt(draft, issue);
        const prior = await this.consumption(tx, issue);
        if (prior) {
          if (prior.operationKey !== command.operationKey || prior.requestHash !== consumeRequestHash(principal, command)
            || !equal(bindingIdentity(prior.target), principalIdentity(principal))) throw conflict();
          await this.verifyPointer(tx, 'consume', scopeOf(principal), command.operationKey, issue, prior); return;
        }
        // The target publication/policy observed when issuing is part of this
        // original reference. Reconfiguration cannot turn it into new consent.
        if (principal.policyHash !== issue.targetPolicyHash) throw denied();
        if (await this.log(tx, operationId('consume', scopeOf(principal), command.operationKey), principal, actions.index,
          clientBookingTransferIndexSchema)) throw conflict();
        const handoff = await this.handoff(tx, scope, issue.original.handoffRef), material = await this.material(tx, scope, issue.original.materialRef);
        if (!handoff || !material || draft.revision !== issue.original.draftRevision
          || !equal(this.original(draft, handoff, issue.source, material), issue.original)) throw stale();
        const proof = await this.prove(tx, issue.source, issue.original, principal, 'consume', issue.targetPolicyHash), target = this.binding(principal);
        const after = this.principal(await this.authority.target(command.transferRef, 'consume', tx), true);
        if (!equal(liveBasis(principal), liveBasis(after))) throw denied();
        const now = this.now(), expiresAt = new Date(Math.min(Date.parse(issue.expiresAt), Date.parse(target.authorizedUntil),
          Date.parse(after.expiresAt), Date.parse(proof.authorizedUntil)));
        const consumption = clientBookingTransferConsumeReceiptSchema.parse({ version: 'client-booking-transfer-consumed-1',
          transferRef: issue.transferRef, operationKey: command.operationKey, issueHash: hash(issue),
          requestHash: consumeRequestHash(principal, command), target, consumedAt: now.toISOString(), expiresAt: expiresAt.toISOString() });
        const latestDraft = await this.draft(tx, scope, draft.id), latestHandoff = await this.handoff(tx, scope, handoff.id), latestMaterial = await this.material(tx, scope, material.id);
        if (!latestDraft || !latestHandoff || !latestMaterial || !equal(draft, latestDraft)
          || !equal(handoff, latestHandoff) || !equal(material, latestMaterial)) throw stale();
        this.assertOriginal(latestDraft, latestHandoff, issue.source, latestMaterial, true);
        attempted = true;
        await this.append(tx, consumeId(scope, draft.id), scope, actions.consume, consumption, now);
        await this.append(tx, operationId('consume', scopeOf(target), command.operationKey), scopeOf(target), actions.index,
          { version: 'client-booking-transfer-index-1', kind: 'consume_operation', transferRef: issue.transferRef,
            draftId: draft.id, receiptHash: hash(consumption) }, now);
        await this.bindLocator(tx, 'handoff', handoff.id, issue, consumption, now);
        await this.bindLocator(tx, 'draft', draft.id, issue, consumption, now);
        const accepted = await this.acceptance(tx, scope, issue.original.bookingOperationKey);
        if (accepted) {
          this.assertAcceptance(accepted, issue);
          await this.bindLocator(tx, 'acceptance', accepted.id, issue, consumption, now);
        }
        const closing = this.principal(await this.authority.target(command.transferRef, 'consume', tx), true);
        if (!equal(liveBasis(principal), liveBasis(closing))) throw denied();
        const closingProof = await this.prove(tx, issue.source, issue.original, closing, 'consume', issue.targetPolicyHash);
        const closingDraft = await this.draft(tx, scope, draft.id), closingHandoff = await this.handoff(tx, scope, handoff.id),
          closingMaterial = await this.material(tx, scope, material.id);
        const finalPrincipal = this.principal(await this.authority.target(command.transferRef, 'consume', tx), true);
        if (!equal(liveBasis(principal), liveBasis(finalPrincipal)) || !equal(closingDraft, draft)
          || !equal(closingHandoff, handoff) || !equal(closingMaterial, material)) throw denied();
        if (Date.parse(consumption.expiresAt) <= this.now().getTime() || Date.parse(consumption.expiresAt) > Math.min(
          Date.parse(closing.expiresAt), Date.parse(finalPrincipal.expiresAt), Date.parse(closingProof.authorizedUntil))) throw stale();
      }, options);
      const receipt = await this.readReceipt(command);
      if (!receipt?.consumption) throw unavailable();
      return { ...receipt, replayed: !attempted };
    } catch (error) { this.error(error, attempted); }
  }

  /** Called only with a current target principal resolved by the owning Auth
   * host. Its exact target index points to an already committed consumption;
   * an absent/expired receipt cannot be minted or made executable here. */
  async resolveTarget(viewerValue: ClientBookingTransferPrincipal, value: unknown,
    transaction?: ClientBookingTransferTransaction): Promise<ClientBookingTransferReceipt | null> {
    const viewer = this.principal(viewerValue), lookup = clientBookingTransferTargetLookupSchema.parse(structuredClone(value));
    const [kind, locatorRef] = 'handoffRef' in lookup ? ['handoff' as const, lookup.handoffRef]
      : 'draftId' in lookup ? ['draft' as const, lookup.draftId] : ['acceptance' as const, lookup.acceptanceRef];
    const read = async (reader: Reader): Promise<ClientBookingTransferReceipt | null> => {
      const scope = scopeOf(viewer), locator = await this.log(reader, targetLocatorId(kind, scope, locatorRef), scope,
        actions.index, clientBookingTransferTargetLocatorSchema);
      if (!locator) return null;
      if (locator.kind !== kind || locator.locatorRef !== locatorRef || locator.targetPrincipalHash !== viewer.principalHash
        || locator.targetBindingHash !== viewer.bindingHash) throw denied();
      const current = this.principal(await this.authority.target(locator.transferRef, 'read', reader));
      if (!equal(liveBasis(current), liveBasis(viewer))) throw denied();
      const issue = await this.byReference(reader, current, locator.transferRef);
      if (!issue || issue.original.draftId !== locator.draftId) throw unavailable();
      const draft = await this.draft(reader, scopeOf(issue.source), locator.draftId);
      if (!draft) throw unavailable();
      this.assertLockedReceipt(draft, issue);
      const consumption = await this.consumption(reader, issue);
      if (!consumption || hash(consumption) !== locator.receiptHash) throw unavailable();
      this.assertTarget(current, consumption);
      await this.verifyPointer(reader, 'consume', scope, consumption.operationKey, issue, consumption);
      if (kind === 'handoff' && issue.original.handoffRef !== locatorRef || kind === 'draft' && issue.original.draftId !== locatorRef) throw unavailable();
      if (kind === 'acceptance') {
        const material = await this.material(reader, scopeOf(issue.source), locatorRef);
        if (!material) throw unavailable();
        this.assertAcceptance(material, issue);
      }
      const after = this.principal(await this.authority.target(locator.transferRef, 'read', reader));
      this.assertTarget(after, consumption);
      if (!equal(liveBasis(viewer), liveBasis(after)) || !equal(await this.consumption(reader, issue), consumption)
        || !equal(await this.issued(reader, scopeOf(issue.source), locator.draftId), issue)
        || !equal(await this.log(reader, targetLocatorId(kind, scope, locatorRef), scope,
          actions.index, clientBookingTransferTargetLocatorSchema), locator)) throw denied();
      return { issue, consumption, currentUse: 'not_authorized_by_receipt' };
    };
    try { return transaction ? await read(transaction) : await this.db.$transaction(read, options); }
    catch (error) { this.error(error, false); }
  }

  /** Couple this metadata index to the original acceptance save in its existing
   * transaction. No customer body is read, no acceptance is created, and no
   * expired transfer is renewed. Reads still reauthorize the consuming target. */
  async bindAcceptance(value: ClientBookingTransferReceipt, acceptanceRefValue: string,
    transaction: ClientBookingTransferTransaction): Promise<void> {
    const receipt = clientBookingTransferReceiptSchema.parse(structuredClone(value)), acceptanceRef = z.string().uuid().parse(acceptanceRefValue);
    if (!receipt.consumption || typeof transaction?.$queryRaw !== 'function' || typeof transaction.operationLog?.findUnique !== 'function'
      || typeof transaction.operationLog.create !== 'function') throw unavailable();
    let attempted = false;
    try {
      const { issue, consumption } = receipt, source = scopeOf(issue.source);
      const current = this.principal(await this.authority.target(issue.transferRef, 'read', transaction));
      this.assertTarget(current, consumption);
      const draft = await this.draft(transaction, source, issue.original.draftId);
      if (!draft) throw unavailable();
      this.assertLockedReceipt(draft, issue);
      if (!equal(await this.issued(transaction, source, draft.id), issue)
        || !equal(await this.consumption(transaction, issue), consumption)) throw denied();
      await this.verifyPointer(transaction, 'consume', scopeOf(current), consumption.operationKey, issue, consumption);
      const material = await this.material(transaction, source, acceptanceRef);
      if (!material) throw unavailable();
      this.assertAcceptance(material, issue);
      const locatorId = targetLocatorId('acceptance', scopeOf(current), acceptanceRef),
        existing = await this.log(transaction, locatorId, current, actions.index, clientBookingTransferTargetLocatorSchema);
      if (existing && !equal(existing, this.locator('acceptance', acceptanceRef, issue, consumption))) throw conflict();
      const after = this.principal(await this.authority.target(issue.transferRef, 'read', transaction));
      if (!equal(liveBasis(current), liveBasis(after))) throw denied();
      this.assertTarget(after, consumption);
      attempted = !existing;
      await this.bindLocator(transaction, 'acceptance', acceptanceRef, issue, consumption, this.now());
      const closing = this.principal(await this.authority.target(issue.transferRef, 'read', transaction));
      this.assertTarget(closing, consumption);
      if (!equal(liveBasis(current), liveBasis(closing)) || !equal(await this.material(transaction, source, acceptanceRef), material)
        || !equal(await this.consumption(transaction, issue), consumption)) throw denied();
    } catch (error) { this.error(error, attempted); }
  }

  /** Mandatory PRIVATE interlock for the owning original submission path. With
   * tx supplied this takes/reuses its SAME Draft lock. The source caller still
   * needs original Auth/Guard; not_issued itself grants no read/write authority.
   * Pending/consumed remain blocking after TTL and never infer non-execution. */
  async currentForDraft(sourceValue: ClientBookingTransferScope, draftIdValue: string,
    transaction?: ClientBookingTransferTransaction): Promise<ClientBookingTransferSourceInterlock> {
    const source = clientBookingTransferScopeSchema.parse({ tenantId: sourceValue.tenantId, workspaceId: sourceValue.workspaceId,
      channel: sourceValue.channel, principalKind: sourceValue.principalKind, principalHash: sourceValue.principalHash }),
      draftId = z.string().uuid().parse(draftIdValue);
    const read = async (reader: Reader): Promise<ClientBookingTransferSourceInterlock> => {
      const draft = await this.draft(reader, source, draftId);
      if (!draft) throw denied();
      const issue = await this.issued(reader, source, draftId);
      if (!issue) return { state: 'not_issued', currentUse: 'not_authorized_by_receipt' };
      this.assertLockedReceipt(draft, issue);
      const consumption = await this.consumption(reader, issue);
      return consumption ? { state: 'consumed', issue, consumption, currentUse: 'not_authorized_by_receipt' }
        : { state: 'pending', issue, currentUse: 'not_authorized_by_receipt' };
    };
    try { return transaction ? await read(transaction) : await this.db.$transaction(read, options); }
    catch (error) { this.error(error, false); }
  }
}

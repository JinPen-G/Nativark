/** Authenticated bridge to one consumed original Booking reference. The source
 * material stays under its original channel/principal; only a persisted target
 * binding may select that source. New use rechecks both publications, policies
 * and original Core facts. Historical receipts do not restore continuation. */
import type { PrismaClient } from '@prisma/client';
import { aiBookingMaterialSchema, type AiBookingMaterial } from '@rental-os/shared';
import type { ClientRequestContext } from '../../client/client-auth.service';
import type { composeAiClientScenes } from '../client-scene.composition';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { AiClientPolicyAuthority, type AiClientTaskDependencies } from './client-task.authority';
import { AiClientEntryError } from './client-entry-action';
import { PrismaClientSceneMaterialRepository, type AiClientMaterialDb, type AiClientMaterialScope } from './prisma-client-scene-material.repository';
import { readClientBookingMaterial, bookingSelectionSchema } from './client-booking-material';
import { ClientBookingTransferRepository } from './client-booking-transfer.repository';
import { CLIENT_BOOKING_TRANSFER_LIFETIME_MS, clientBookingTransferCustomerHash, clientBookingTransferPrincipalHash,
  clientBookingTransferScopeSchema, type ClientBookingTransferPrincipal, type ClientBookingTransferBinding,
  type ClientBookingTransferOriginal, type ClientBookingTransferReceipt, type ClientBookingTransferTransaction } from './client-booking-transfer.contract';
import type { ClientBookingRow } from './prisma-client-booking.repository';

type Channel = 'web' | 'wechat_miniprogram';
type Bound = { identity: ClientRequestContext; bindingHash: string;
  published: { scope: { tenantId: string; workspaceId: string }; value: unknown };
  scenes: ReturnType<typeof composeAiClientScenes>; assertCurrent(): Promise<void> };
export type ClientBookingTransferPublication = { releaseRevision: string; policy: { expiresAt: Date } };
export type ClientBookingOriginalBinding = { receipt: ClientBookingTransferReceipt; scope: AiClientMaterialScope;
  bindingHash: string; publicationHash: string; policyHash: string };
const canonicalHash = (value: unknown) => hash(JSON.parse(JSON.stringify(value)));
const originalScope = (source: ClientBookingTransferBinding) => clientBookingTransferScopeSchema.parse({
  tenantId: source.tenantId, workspaceId: source.workspaceId, channel: source.channel,
  principalKind: source.principalKind, principalHash: source.principalHash });
const denied = () => new AiClientEntryError('AI_ACCESS_DENIED', 'booking_transfer_current_binding_changed');
const stale = () => new AiClientEntryError('AI_PROPOSAL_STALE', 'booking_transfer_original_changed', 'reprepare');
const unavailable = () => new AiClientEntryError('AI_RESOURCE_UNAVAILABLE', 'booking_transfer_host_unavailable');

export function composeClientBookingTransferHost(d: {
  db: AiClientMaterialDb & PrismaClient; bound: Bound; channel: Channel; appId: string | null;
  tasks: AiClientTaskDependencies; releaseRevision: string; clock(): Date;
  publication(identity: ClientRequestContext, channel: Channel, create: boolean): Promise<ClientBookingTransferPublication>;
}) {
  const originalMaterials = new PrismaClientSceneMaterialRepository(d.db), bound = d.bound;
  if (!bound.identity || bound.identity.customerType !== 'personal' || d.tasks.db !== d.db
    || typeof d.publication !== 'function') throw unavailable();
  const identity = structuredClone(bound.identity);
  const now = () => { const value = d.clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; };
  const subject = (channel: Channel) => ({ tenantId: identity.tenantId, workspaceId: identity.workspaceId,
    channel, principalKind: 'personal' as const, identity: structuredClone(identity) });
  const policy = async (channel: Channel, create: boolean) => {
    await bound.assertCurrent();
    const authority = new AiClientPolicyAuthority(d.tasks, d.tasks, 'booking-transfer-current', d.clock);
    const grant = await authority.authorize(subject(channel), create ? 'create' : 'read');
    const publication = await d.publication(structuredClone(identity), channel, create);
    await bound.assertCurrent();
    const expiresAt = new Date(Math.min(grant.policy.expiresAt.getTime(), publication.policy.expiresAt.getTime()));
    if (expiresAt <= now()) throw denied();
    return { expiresAt,
      policyHash: create ? canonicalHash({ policyHash: grant.policyHash ?? canonicalHash(grant.policy),
        release: { enabled: true, releaseRevision: publication.releaseRevision } }) : null,
      releaseRevision: publication.releaseRevision };
  };
  const principal = async (create: boolean): Promise<ClientBookingTransferPrincipal> => {
    const grant = await policy(d.channel, create), at = now();
    const value = { tenantId: identity.tenantId, workspaceId: identity.workspaceId, customerId: identity.customerId,
      customerType: 'personal' as const, channel: d.channel, appId: d.appId, sessionId: identity.sessionId,
      bindingHash: bound.bindingHash, publicationHash: canonicalHash(bound.published.value), policyHash: grant.policyHash,
      authorizedAt: at.toISOString(), expiresAt: new Date(Math.min(at.getTime() + CLIENT_BOOKING_TRANSFER_LIFETIME_MS,
        grant.expiresAt.getTime())).toISOString() };
    if (grant.releaseRevision !== d.releaseRevision) throw denied();
    return { ...value, principalHash: clientBookingTransferPrincipalHash(value) };
  };
  const sourcePublication = async (source: ClientBookingTransferBinding, create: boolean) => {
    if (source.tenantId !== identity.tenantId || source.workspaceId !== identity.workspaceId
      || source.customerHash !== clientBookingTransferCustomerHash({ ...identity, customerType: 'personal' })) throw denied();
    const bootstrap = await bound.scenes.guest.bootstrap(identity.tenantCode, source.channel, source.appId ?? undefined);
    const services = bootstrap.services.filter(service => service.code === identity.workspaceCode && service.status === 'open');
    if (bootstrap.tenantCode !== identity.tenantCode || bootstrap.client !== source.channel || bootstrap.source !== 'channel'
      || !bootstrap.capabilities.publicCatalog || services.length !== 1) throw denied();
    const service = services[0], scope = await originalMaterials.resolveScope(identity.tenantCode, identity.workspaceCode);
    const publication = { tenantCode: bootstrap.tenantCode, channel: bootstrap.client,
      service: { code: service.code, name: service.name, categoryCode: service.categoryCode, status: service.status } };
    if (scope.tenantId !== identity.tenantId || scope.workspaceId !== identity.workspaceId
      || service.categoryCode !== identity.categoryCode || canonicalHash(publication) !== source.publicationHash) throw denied();
    const grant = await policy(source.channel, create);
    if (create && grant.policyHash !== source.policyHash) throw denied();
    return grant;
  };
  const material = async (source: ClientBookingTransferBinding, original: ClientBookingTransferOriginal,
    historical: boolean, transaction?: ClientBookingTransferTransaction) => {
    const scope = originalScope(source);
    const row = await originalMaterials.findSource(scope, original.materialRef, transaction);
    if (!row || row.id !== original.materialRef || row.operationKey !== original.materialOperationKey
      || row.bindingHash !== source.bindingHash || row.publicationHash !== source.publicationHash
      || row.publicationHash !== canonicalHash(row.publication) || row.inputHash !== original.inputHash
      || row.materialHash !== original.materialHash || row.inputHash !== canonicalHash(row.command)
      || row.materialHash !== canonicalHash(row.material) || row.expiresAt.toISOString() !== original.materialExpiresAt) throw denied();
    const command = row.command as { kind?: unknown; selection?: unknown };
    if (command?.kind !== 'booking_quote') throw denied();
    const selection = bookingSelectionSchema.parse(command.selection), value = aiBookingMaterialSchema.parse(row.material);
    // Historical normalization may fill return/service fields. It remains
    // bound by the original command and full material digest, never target input.
    if (selection.quoteId !== value.selection.quoteId) throw denied();
    if (!historical) {
      if (row.expiresAt <= now()) throw stale();
      let current = await readClientBookingMaterial(bound.scenes, identity, selection, d.clock);
      if (!('lines' in value.quote) && 'lines' in current.quote) {
        const { lines: _additiveUnits, ...quote } = current.quote; current = { ...current, quote };
      }
      if (canonicalHash(current) !== row.materialHash) throw stale();
    }
    const after = await originalMaterials.findSource(scope, row.id, transaction);
    if (!after || canonicalHash(after) !== canonicalHash(row)) throw stale();
    await bound.assertCurrent(); return { row, material: value as AiBookingMaterial };
  };
  const prove = async (source: ClientBookingTransferBinding, original: ClientBookingTransferOriginal,
    viewer: ClientBookingTransferPrincipal, purpose: 'issue' | 'consume', transaction: ClientBookingTransferTransaction) => {
    if (clientBookingTransferCustomerHash(viewer) !== source.customerHash
      || viewer.tenantId !== source.tenantId || viewer.workspaceId !== source.workspaceId) throw denied();
    const first = await sourcePublication(source, true), originalMaterial = await material(source, original, false, transaction);
    const after = await sourcePublication(source, true), target = await principal(true);
    const targetChannel = source.channel === 'web' ? 'wechat_miniprogram' : 'web';
    const targetFirst = await policy(targetChannel, true), targetAfter = await policy(targetChannel, true);
    if (first.policyHash !== after.policyHash || target.principalHash !== viewer.principalHash
      || target.bindingHash !== viewer.bindingHash || target.policyHash !== viewer.policyHash
      || !targetFirst.policyHash || targetFirst.policyHash !== targetAfter.policyHash
      || purpose === 'consume' && target.policyHash !== targetAfter.policyHash) throw denied();
    if (purpose === 'issue' && viewer.channel !== source.channel || purpose === 'consume' && viewer.channel === source.channel) throw denied();
    return { draftId: original.draftId, draftRevision: original.draftRevision, handoffRef: original.handoffRef,
      materialRef: originalMaterial.row.id, inputHash: originalMaterial.row.inputHash, materialHash: originalMaterial.row.materialHash,
      selectionRevision: original.selectionRevision, customerHash: source.customerHash, sourceBindingHash: source.bindingHash,
      sourcePublicationHash: source.publicationHash, sourcePolicyHash: source.policyHash, targetPolicyHash: targetAfter.policyHash,
      authorizedUntil: new Date(Math.min(first.expiresAt.getTime(), after.expiresAt.getTime(),
        targetFirst.expiresAt.getTime(), targetAfter.expiresAt.getTime(),
        Date.parse(target.expiresAt), Date.parse(original.handoffExpiresAt))).toISOString() };
  };
  const repository = new ClientBookingTransferRepository(d.db, {
    source: (_ref, purpose) => principal(purpose === 'issue'), target: (_ref, purpose) => principal(purpose === 'consume'), original: prove
  }, d.clock);
  const binding = async (locator: { handoffRef?: string; draftId?: string; acceptanceRef?: string }, historical: boolean) => {
    const viewer = await principal(false), receipt = await repository.resolveTarget(viewer, locator);
    if (!receipt?.consumption) return null;
    const { source } = receipt.issue, target = receipt.consumption.target;
    if (target.principalHash !== viewer.principalHash || target.bindingHash !== bound.bindingHash
      || target.publicationHash !== canonicalHash(bound.published.value)) throw denied();
    await sourcePublication(source, !historical);
    if (!historical) {
      const current = await principal(true);
      if (current.policyHash !== target.policyHash || Date.parse(receipt.consumption.expiresAt) <= now().getTime()
        || Date.parse(receipt.issue.expiresAt) <= now().getTime()) throw stale();
    }
    return { receipt, scope: originalScope(source), bindingHash: source.bindingHash,
      publicationHash: source.publicationHash, policyHash: source.policyHash } satisfies ClientBookingOriginalBinding;
  };
  const validate = async (original: ClientBookingOriginalBinding, historical: boolean,
    transaction?: ClientBookingTransferTransaction) => {
    const viewer = await principal(false), receipt = await repository.resolveTarget(viewer,
      { handoffRef: original.receipt.issue.original.handoffRef }, transaction);
    if (!receipt?.consumption || canonicalHash(receipt) !== canonicalHash(original.receipt)) throw denied();
    const sourceGrant = await sourcePublication(receipt.issue.source, !historical);
    let targetExpiresAt: Date | undefined;
    if (!historical) {
      const current = await principal(true);
      targetExpiresAt = new Date(current.expiresAt);
      if (current.policyHash !== receipt.consumption.target.policyHash
        || Date.parse(receipt.consumption.expiresAt) <= now().getTime()) throw stale();
    }
    await bound.assertCurrent();
    if (!historical && (sourceGrant.expiresAt <= now() || targetExpiresAt! <= now()
      || Date.parse(receipt.consumption.expiresAt) <= now().getTime())) throw stale();
  };
  return Object.freeze({ repository, principal, binding, validate,
    async loadMaterial(original: ClientBookingOriginalBinding, historical: boolean, transaction?: ClientBookingTransferTransaction) {
      await validate(original, historical, transaction);
      const first = await material(original.receipt.issue.source, original.receipt.issue.original, historical, transaction);
      await validate(original, historical, transaction);
      return { ...first, policyFingerprint: original.policyHash,
        policyExpiresAt: new Date(original.receipt.consumption!.expiresAt) };
    },
    async assertSourceUse(scope: AiClientMaterialScope, row: ClientBookingRow, transaction?: ClientBookingTransferTransaction) {
      const current = await repository.currentForDraft(clientBookingTransferScopeSchema.parse(scope), row.id, transaction);
      if (current.state !== 'not_issued') throw denied();
      await bound.assertCurrent();
    }
  });
}

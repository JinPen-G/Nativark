/** Original public catalog/help material and its one-time client continuation.
 * The existing material table holds content; OperationLog holds only binding
 * hashes and locators. This leaf issues no identity, Task, Action or business
 * command. The caller must supply current server-authorized bindings. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { aiClientPublicCommandSchema, aiClientPublicContinuationReadRequestSchema } from '@rental-os/shared';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { clientSqlInitialRevisionSchema } from './client-sql-revisions';
import { PrismaClientSceneMaterialRepository, type AiClientSceneMaterial } from './prisma-client-scene-material.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const instant = z.date().refine(value => Number.isFinite(value.getTime()));
const iso = z.string().datetime({ offset: true });
export const clientPublicCommandSchema = aiClientPublicCommandSchema;
export type ClientPublicCommand = z.infer<typeof clientPublicCommandSchema>;
const scopeSchema = z.object({ tenantId: id, workspaceId: id, channel: z.enum(['web', 'wechat_miniprogram']),
  appId: id.nullable() }).strict();
export type ClientPublicContinuityScope = z.infer<typeof scopeSchema>;
const ownerSchema = scopeSchema.extend({ principalHash: digest, ownerHash: digest }).strict();
export type ClientPublicContinuityOwner = z.infer<typeof ownerSchema>;
const clientSchema = scopeSchema.extend({ principalHash: digest, principalKind: z.enum(['personal', 'corporate']) }).strict();
export type ClientPublicContinuityClient = z.infer<typeof clientSchema>;
const targetSchema = clientSchema.extend({ bindingHash: digest }).strict();
export type ClientPublicContinuityTarget = z.infer<typeof targetSchema>;
export const clientPublicContinuationReadSchema = aiClientPublicContinuationReadRequestSchema.omit({ tenantCode: true, serviceCode: true });
type ContinuationCommand = z.infer<typeof clientPublicContinuationReadSchema>;
const publicRowSchema = z.object({ id: z.string().uuid(), tenantId: id, workspaceId: id,
  channel: z.enum(['web', 'wechat_miniprogram']), principalKind: z.literal('anonymous'), principalHash: digest,
  bindingHash: digest, publicationHash: digest, operationKey: id, inputHash: digest, materialHash: digest,
  command: clientPublicCommandSchema, material: z.unknown(), publication: z.unknown(),
  revision: clientSqlInitialRevisionSchema, createdAt: instant, expiresAt: instant }).strict();
export type ClientPublicOriginalMaterial = z.infer<typeof publicRowSchema>;
const originSchema = z.object({ version: z.literal('client-public-origin-1'), owner: ownerSchema,
  publicRef: z.string().uuid(), operationKey: id, inputHash: digest, materialHash: digest, publicationHash: digest,
  bindingHash: digest, createdAt: iso, expiresAt: iso, ownerIssuedAt: iso, ownerExpiresAt: iso }).strict();
type Origin = z.infer<typeof originSchema>;
const continuationSchema = z.object({ version: z.literal('client-public-continuation-1'), owner: ownerSchema,
  publicRef: z.string().uuid(), operationKey: id, requestHash: digest, originalMaterialHash: digest,
  target: targetSchema, materialRef: z.string().uuid(), materialOperationKey: id, materialInputHash: digest,
  materialHash: digest, publicationHash: digest, createdAt: iso, expiresAt: iso }).strict();
export type ClientPublicContinuation = z.infer<typeof continuationSchema>;
type Reader = Pick<Prisma.TransactionClient, '$queryRaw' | 'operationLog'>;
export type ClientPublicContinuityDb = Pick<PrismaClient, '$transaction' | '$queryRaw' | '$executeRaw' |
  'operationLog' | 'tenant' | 'businessWorkspace'>;
const originAction = 'ai_native_client_public_origin';
const continuationAction = 'ai_native_client_public_continuation';
const unavailable = () => new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const key = (kind: string, value: unknown) => `client-public:${kind}:${hash(value)}`;
export const clientPublicMaterialId = (value: unknown) => {
  const valueHash = hash(value);
  return `${valueHash.slice(0, 8)}-${valueHash.slice(8, 12)}-4${valueHash.slice(13, 16)}-8${valueHash.slice(17, 20)}-${valueHash.slice(20, 32)}`;
};
const originKey = (owner: ClientPublicContinuityOwner, operationKey: string) => key('origin', { owner, operationKey });
const continuationKey = (scope: ClientPublicContinuityScope, publicRef: string) => key('continued', { scope, publicRef });
const scopeOf = ({ tenantId, workspaceId, channel, appId }: ClientPublicContinuityScope) => ({ tenantId, workspaceId, channel, appId });
const clientOf = ({ principalHash, principalKind, ...scope }: ClientPublicContinuityClient) =>
  ({ ...scopeOf(scope), principalHash, principalKind });
const continuationRequestHash = (target: ClientPublicContinuityClient, command: ContinuationCommand) =>
  hash({ version: 'client-public-continuation-1', target: clientOf(target), ...command });
const boundedHash = (value: unknown, maximum: number) => {
  const serialized = JSON.stringify(value);
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > maximum) throw unavailable();
  return hash(JSON.parse(serialized));
};

export class ClientPublicContinuityRepository {
  private readonly materials: PrismaClientSceneMaterialRepository;
  constructor(private readonly db: ClientPublicContinuityDb) {
    if (typeof db?.operationLog?.findUnique !== 'function' || typeof db.operationLog.create !== 'function') throw unavailable();
    this.materials = new PrismaClientSceneMaterialRepository(db);
  }

  private async audit<T>(reader: Reader, auditId: string, scope: ClientPublicContinuityScope, action: string, schema: z.ZodType<T>) {
    const row = await reader.operationLog.findUnique({ where: { id: auditId }, select: {
      id: true, tenantId: true, workspaceId: true, userId: true, rentalOrderId: true, action: true, detail: true, createdAt: true } });
    if (!row) return null;
    try {
      const detail = z.object({ payload: schema, payloadHash: digest }).strict().parse(structuredClone(row.detail));
      if (row.id !== auditId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || row.userId !== null || row.rentalOrderId !== null || row.action !== action || !instant.safeParse(row.createdAt).success
        || boundedHash(detail.payload, 8192) !== detail.payloadHash) throw unavailable();
      return detail.payload;
    } catch { throw unavailable(); }
  }

  private async publicRow(reader: Reader, owner: ClientPublicContinuityOwner, publicRef: string, locked = false) {
    const rows = await reader.$queryRaw<unknown[]>(Prisma.sql`SELECT * FROM ai_client_scene_materials
      WHERE tenantId = ${owner.tenantId} AND workspaceId = ${owner.workspaceId} AND channel = ${owner.channel}
      AND principalHash = ${owner.principalHash} AND id = ${publicRef} LIMIT 1 ${locked ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
    if (!Array.isArray(rows) || rows.length > 1) throw unavailable();
    if (!rows.length) return null;
    try {
      const { erasedAt, ...value } = z.object({ erasedAt: instant.nullable().optional() }).passthrough().parse(rows[0]);
      if (erasedAt) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const row = publicRowSchema.parse(value);
      if (row.id !== publicRef || row.tenantId !== owner.tenantId || row.workspaceId !== owner.workspaceId
        || row.channel !== owner.channel || row.principalHash !== owner.principalHash || row.expiresAt <= row.createdAt
        || row.inputHash !== hash(row.command) || row.materialHash !== boundedHash(row.material, 65536)
        || row.publicationHash !== boundedHash(row.publication, 8192)) throw unavailable();
      return row;
    } catch (error) { if (error instanceof AiTaskRepositoryError) throw error; throw unavailable(); }
  }

  private assertOrigin(owner: ClientPublicContinuityOwner, origin: Origin, row: ClientPublicOriginalMaterial) {
    if (hash(origin.owner) !== hash(owner) || origin.publicRef !== row.id || origin.operationKey !== row.operationKey
      || row.id !== clientPublicMaterialId({ owner, operationKey: row.operationKey })
      || row.bindingHash !== hash({ publication: { scope: { tenantId: row.tenantId, workspaceId: row.workspaceId }, value: row.publication }, owner })
      || origin.inputHash !== row.inputHash || origin.materialHash !== row.materialHash || origin.publicationHash !== row.publicationHash
      || origin.bindingHash !== row.bindingHash || origin.createdAt !== row.createdAt.toISOString()
      || origin.expiresAt !== row.expiresAt.toISOString() || Date.parse(origin.ownerExpiresAt) < row.expiresAt.getTime()
      || row.expiresAt <= row.createdAt
      || Date.parse(origin.ownerIssuedAt) > row.createdAt.getTime()
      || Date.parse(origin.ownerExpiresAt) <= Date.parse(origin.ownerIssuedAt)
      || Date.parse(origin.ownerExpiresAt) - Date.parse(origin.ownerIssuedAt) > 300000) throw unavailable();
  }

  async readOriginalReference(ownerValue: ClientPublicContinuityOwner, publicRef: string) {
    const owner = ownerSchema.parse(structuredClone(ownerValue));
    z.string().uuid().parse(publicRef);
    try {
      const row = await this.publicRow(this.db, owner, publicRef);
      if (!row) return null;
      const origin = await this.audit(this.db, originKey(owner, row.operationKey), owner, originAction, originSchema);
      if (!origin) throw unavailable();
      this.assertOrigin(owner, origin, row);
      return { origin, row };
    } catch (error) { if (error instanceof AiTaskRepositoryError) throw error; throw unavailable(); }
  }

  async readOriginal(ownerValue: ClientPublicContinuityOwner, operationKey: string) {
    const owner = ownerSchema.parse(structuredClone(ownerValue));
    id.parse(operationKey);
    try {
      const origin = await this.audit(this.db, originKey(owner, operationKey), owner, originAction, originSchema);
      if (!origin) return null;
      const row = await this.publicRow(this.db, owner, origin.publicRef);
      if (!row) throw unavailable();
      this.assertOrigin(owner, origin, row);
      return { origin, row };
    } catch (error) { if (error instanceof AiTaskRepositoryError) throw error; throw unavailable(); }
  }

  async record(ownerValue: ClientPublicContinuityOwner, rowValue: ClientPublicOriginalMaterial,
    proof: { issuedAt: Date; expiresAt: Date },
    check: () => Promise<void>) {
    const owner = ownerSchema.parse(structuredClone(ownerValue)), row = publicRowSchema.parse(structuredClone(rowValue));
    const origin = originSchema.parse({ version: 'client-public-origin-1', owner, publicRef: row.id, operationKey: row.operationKey,
      inputHash: row.inputHash, materialHash: row.materialHash, publicationHash: row.publicationHash, bindingHash: row.bindingHash,
      createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      ownerIssuedAt: instant.parse(proof.issuedAt).toISOString(), ownerExpiresAt: instant.parse(proof.expiresAt).toISOString() });
    this.assertOrigin(owner, origin, row);
    if (row.id !== clientPublicMaterialId({ owner, operationKey: row.operationKey }) || row.inputHash !== hash(row.command)
      || row.materialHash !== boundedHash(row.material, 65536) || row.publicationHash !== boundedHash(row.publication, 8192)) throw unavailable();
    let attempted = false;
    try {
      return await this.db.$transaction(async tx => {
        const existing = await this.publicRow(tx, owner, row.id, true);
        const receipt = await this.audit(tx, originKey(owner, row.operationKey), owner, originAction, originSchema);
        if (existing || receipt) {
          if (!existing || !receipt) throw unavailable();
          this.assertOrigin(owner, receipt, existing);
          if (existing.inputHash !== row.inputHash) throw conflict();
          return { row: existing, replayed: true };
        }
        await check(); attempted = true;
        // The original table's binding/operation unique keys remain the only
        // persistence boundary. A failed INSERT/COMMIT is never retried here.
        await tx.$executeRaw(Prisma.sql`INSERT INTO ai_client_scene_materials
          (id, tenantId, workspaceId, channel, principalKind, principalHash, bindingHash, publicationHash, operationKey,
           inputHash, materialHash, command, material, publication, revision, createdAt, expiresAt)
          VALUES (${row.id}, ${row.tenantId}, ${row.workspaceId}, ${row.channel}, ${row.principalKind}, ${row.principalHash},
            ${row.bindingHash}, ${row.publicationHash}, ${row.operationKey}, ${row.inputHash}, ${row.materialHash},
            ${JSON.stringify(row.command)}, ${JSON.stringify(row.material)}, ${JSON.stringify(row.publication)},
            ${row.revision}, ${row.createdAt}, ${row.expiresAt})`);
        await tx.operationLog.create({ data: { id: originKey(owner, row.operationKey), tenantId: owner.tenantId,
          workspaceId: owner.workspaceId, userId: null, rentalOrderId: null, action: originAction,
          detail: { payload: origin, payloadHash: hash(origin) } } });
        await check(); return { row, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (attempted) throw new ClientPublicContinuityUnknownError();
      if (error instanceof AiTaskRepositoryError) throw error;
      throw unavailable();
    }
  }

  private async continuation(reader: Reader, scope: ClientPublicContinuityScope, publicRef: string) {
    return this.audit(reader, continuationKey(scopeOf(scope), publicRef), scope, continuationAction, continuationSchema);
  }

  private async continuationMaterial(receipt: ClientPublicContinuation, current: ClientPublicContinuityClient) {
    if (hash(clientOf(receipt.target)) !== hash(clientOf(current)) || hash(scopeOf(receipt.owner)) !== hash(scopeOf(current))) throw denied();
    const target = receipt.target;
    const scope = { tenantId: target.tenantId, workspaceId: target.workspaceId, channel: target.channel,
      principalKind: target.principalKind, principalHash: target.principalHash };
    const row = await this.materials.findSource(scope, receipt.materialRef);
    if (!row || row.operationKey !== receipt.materialOperationKey || row.inputHash !== receipt.materialInputHash
      || row.materialHash !== receipt.materialHash || row.publicationHash !== receipt.publicationHash || row.bindingHash !== target.bindingHash
      || row.createdAt.toISOString() !== receipt.createdAt || row.expiresAt.toISOString() !== receipt.expiresAt
      || row.inputHash !== hash(clientPublicCommandSchema.parse(row.command))
      || row.materialHash !== boundedHash(row.material, 65536) || row.publicationHash !== boundedHash(row.publication, 8192)) throw unavailable();
    return row;
  }

  async readContinuation(clientValue: ClientPublicContinuityClient, commandValue: ContinuationCommand) {
    const current = clientSchema.parse(structuredClone(clientValue)), command = clientPublicContinuationReadSchema.parse(structuredClone(commandValue));
    try {
      const receipt = await this.continuation(this.db, current, command.publicRef);
      if (!receipt) return null;
      if (receipt.publicRef !== command.publicRef || receipt.operationKey !== command.operationKey
        || receipt.originalMaterialHash !== command.expectedMaterialHash || receipt.requestHash !== continuationRequestHash(current, command)
        || receipt.materialRef !== clientPublicMaterialId({ version: 'client-public-continuation-1', target: receipt.target, command })
        || receipt.materialOperationKey !== `public-continuation:${hash({ publicRef: command.publicRef, operationKey: command.operationKey, target: receipt.target })}`) throw denied();
      const row = await this.continuationMaterial(receipt, current);
      const original = await this.readOriginalReference(receipt.owner, receipt.publicRef);
      if (!original || original.row.id !== receipt.publicRef || original.row.materialHash !== receipt.originalMaterialHash
        || row.inputHash !== original.row.inputHash || hash(row.command) !== hash(original.row.command)
        || row.createdAt < original.row.createdAt || row.expiresAt <= row.createdAt || row.expiresAt > original.row.expiresAt
        || row.expiresAt.getTime() - row.createdAt.getTime() > 300000) throw unavailable();
      return { receipt, row };
    } catch (error) { if (error instanceof AiTaskRepositoryError) throw error; throw unavailable(); }
  }

  async continueOriginal(owner: ClientPublicContinuityOwner, targetValue: ClientPublicContinuityTarget,
    commandValue: ContinuationCommand, rowValue: AiClientSceneMaterial,
    check: () => Promise<void>) {
    owner = ownerSchema.parse(structuredClone(owner));
    const target = targetSchema.parse(structuredClone(targetValue)), row = structuredClone(rowValue);
    const command = clientPublicContinuationReadSchema.parse(structuredClone(commandValue));
    if (hash(scopeOf(owner)) !== hash(scopeOf(target))) throw denied();
    let attempted = false;
    try {
      return await this.db.$transaction(async tx => {
        const original = await this.publicRow(tx, owner, command.publicRef, true);
        if (!original) throw denied();
        const origin = await this.audit(tx, originKey(owner, original.operationKey), owner, originAction, originSchema);
        if (!origin) throw unavailable();
        this.assertOrigin(owner, origin, original);
        const prior = await this.continuation(tx, owner, command.publicRef);
        if (prior) {
          if (prior.operationKey !== command.operationKey || prior.requestHash !== continuationRequestHash(target, command)
            || hash(clientOf(prior.target)) !== hash(clientOf(target))) throw conflict();
          return { receipt: prior, replayed: true };
        }
        if (original.materialHash !== command.expectedMaterialHash || row.inputHash !== original.inputHash
          || hash(row.command) !== hash(original.command) || boundedHash(row.material, 65536) !== row.materialHash
          || boundedHash(row.publication, 8192) !== row.publicationHash
          || row.tenantId !== target.tenantId || row.workspaceId !== target.workspaceId || row.channel !== target.channel
          || row.principalHash !== target.principalHash || row.principalKind !== target.principalKind
          || row.bindingHash !== target.bindingHash || row.createdAt < original.createdAt || row.expiresAt <= row.createdAt
          || row.expiresAt > original.expiresAt || row.expiresAt.getTime() - row.createdAt.getTime() > 300000) throw conflict();
        await check(); attempted = true;
        const saved = await this.materials.save(row, tx);
        if (saved.replayed) throw conflict();
        const receipt = continuationSchema.parse({ version: 'client-public-continuation-1', owner, publicRef: command.publicRef,
          operationKey: command.operationKey, requestHash: continuationRequestHash(target, command), originalMaterialHash: original.materialHash,
          target, materialRef: row.id, materialOperationKey: row.operationKey, materialInputHash: row.inputHash,
          materialHash: row.materialHash, publicationHash: row.publicationHash,
          createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() });
        // The log key belongs to the ORIGINAL public reference, not a client
        // or new operation key. A second customer/key cannot consume it again.
        await tx.operationLog.create({ data: { id: continuationKey(scopeOf(owner), command.publicRef), tenantId: owner.tenantId,
          workspaceId: owner.workspaceId, userId: null, rentalOrderId: null, action: continuationAction,
          detail: { payload: receipt, payloadHash: hash(receipt) } } });
        await check(); return { receipt, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (attempted) throw new ClientPublicContinuityUnknownError('read_original_public_continuation');
      if (error instanceof AiTaskRepositoryError) throw error;
      throw unavailable();
    }
  }
}

export class ClientPublicContinuityUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  constructor(readonly nextAction: 'read_original_public_operation' | 'read_original_public_continuation'
    = 'read_original_public_operation') { super('AI_RESULT_UNKNOWN'); }
}

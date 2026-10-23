/** Durable, scope-bound local-business policies and original save receipts. No seeding, model billing or Core writes. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { parseRentalDesktopBusinessPolicy, type RentalDesktopBusinessBinding, type RentalDesktopBusinessPolicy,
  type RentalDesktopBusinessPolicyRead } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { DesktopBusinessError } from './desktop-business.error';

type Scope = Pick<RentalDesktopBusinessBinding, 'tenantId' | 'workspaceId'>;
type PolicyRow = { revision: number; policyJson: unknown };
type OperationRow = { actorId: string; payloadHash: string; resultJson: unknown };
function json(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value; }
function policy(row: PolicyRow): RentalDesktopBusinessPolicyRead & { state: 'configured' } {
  if (!Number.isInteger(row.revision) || row.revision < 1 || row.revision > 2147483647) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return { state: 'configured', revision: row.revision, policy: parseRentalDesktopBusinessPolicy(json(row.policyJson)) };
}
function receipt(value: unknown): RentalDesktopBusinessPolicyRead & { state: 'configured' } {
  const row = json(value);
  if (!row || typeof row !== 'object' || Array.isArray(row) || !('state' in row) || row.state !== 'configured'
    || !('revision' in row) || !('policy' in row) || Object.keys(row).some(key => !['state', 'revision', 'policy'].includes(key)))
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  if (typeof row.revision !== 'number') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return policy({ revision: row.revision, policyJson: row.policy });
}

/** Uses parameterized Prisma SQL so this opt-in adapter works before shared generated-client replacement. */
export class PrismaDesktopBusinessPolicyRepository {
  constructor(private readonly db: Pick<PrismaClient, '$transaction'>) {}
  async read(value: Scope): Promise<RentalDesktopBusinessPolicyRead> {
    const scope = structuredClone(value);
    const rows = await this.db.$transaction(tx => tx.$queryRaw<PolicyRow[]>`
      SELECT revision, policyJson FROM ai_desktop_business_policies
      WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} LIMIT 1`);
    return rows[0] ? policy(rows[0]) : { state: 'not_configured' };
  }
  async operation(value: RentalDesktopBusinessBinding, operationKey: string) {
    const scope = structuredClone(value);
    const rows = await this.db.$transaction(tx => tx.$queryRaw<OperationRow[]>`
      SELECT actorId, payloadHash, resultJson FROM ai_desktop_business_policy_operations
      WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND operationKey = ${operationKey} LIMIT 1`);
    if (!rows[0]) return { state: 'not_observed' as const };
    if (rows[0].actorId !== scope.actorId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return { state: 'observed' as const, operationKey, result: receipt(rows[0].resultJson) };
  }
  async save(binding: RentalDesktopBusinessBinding, value: { operationKey: string; expectedRevision: number; policy: RentalDesktopBusinessPolicy }, revalidate: () => Promise<void>) {
    const scope = structuredClone(binding);
    const command = structuredClone(value), payloadHash = requestFingerprint(command);
    if ([scope.actorId, scope.tenantId, scope.workspaceId].some(value => typeof value !== 'string' || value.length < 1 || value.length > 36)
      || typeof command.operationKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(command.operationKey)
      || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 0 || command.expectedRevision >= 2147483647)
      throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    try {
      return await this.db.$transaction(async tx => {
        const rows = await tx.$queryRaw<PolicyRow[]>`SELECT revision, policyJson FROM ai_desktop_business_policies
          WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} FOR UPDATE`;
        const operations = await tx.$queryRaw<OperationRow[]>`SELECT actorId, payloadHash, resultJson FROM ai_desktop_business_policy_operations
          WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND operationKey = ${command.operationKey} LIMIT 1`;
        if (operations[0]) {
          if (operations[0].actorId !== scope.actorId || operations[0].payloadHash !== payloadHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          await revalidate();
          return { state: 'saved' as const, operationKey: command.operationKey, result: receipt(operations[0].resultJson) };
        }
        const previous = rows[0] ? policy(rows[0]) : undefined;
        if ((previous?.revision ?? 0) !== command.expectedRevision || command.expectedRevision >= 2147483647)
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        await revalidate();
        const revision = command.expectedRevision + 1, data = JSON.stringify(parseRentalDesktopBusinessPolicy(command.policy));
        if (!previous) await tx.$executeRaw`INSERT INTO ai_desktop_business_policies
          (tenantId, workspaceId, revision, policyJson, updatedBy, createdAt, updatedAt)
          VALUES (${scope.tenantId}, ${scope.workspaceId}, ${revision}, ${data}, ${scope.actorId}, NOW(3), NOW(3))`;
        else {
          const changed = await tx.$executeRaw`UPDATE ai_desktop_business_policies SET revision = ${revision}, policyJson = ${data},
            updatedBy = ${scope.actorId}, updatedAt = NOW(3)
            WHERE tenantId = ${scope.tenantId} AND workspaceId = ${scope.workspaceId} AND revision = ${command.expectedRevision}`;
          if (changed !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        }
        const result = { state: 'configured' as const, revision, policy: structuredClone(command.policy) };
        await tx.$executeRaw`INSERT INTO ai_desktop_business_policy_operations
          (tenantId, workspaceId, operationKey, actorId, payloadHash, resultJson, createdAt)
          VALUES (${scope.tenantId}, ${scope.workspaceId}, ${command.operationKey}, ${scope.actorId}, ${payloadHash}, ${JSON.stringify(result)}, NOW(3))`;
        await revalidate();
        return { state: 'saved' as const, operationKey: command.operationKey, result };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError || error instanceof DesktopBusinessError) throw error;
      // A failed response may follow commit. Only the same operation receipt resolves this outcome.
      throw new DesktopBusinessError('AI_RESULT_UNKNOWN');
    }
  }
}

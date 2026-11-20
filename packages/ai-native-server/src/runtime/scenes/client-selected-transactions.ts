/** 客户原资料与任务创建的同事务参加者。原 ClientAuth/Tenant/Core 先于本人
 * Order、渠道发布、资料和 Task；不创建事务、不提供营运权限、不重发 unknown。 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import type { ClientAuthService } from '@rental-os/rental-core/mysql-client-auth';
import type { ClientRequestContext } from '@rental-os/rental-core/client-context';
import type { RentalCoreFactRepository } from '@rental-os/rental-core/mysql-core-facts';
import { clientOwnsRentalOrder } from '@rental-os/rental-core/client-order-ownership';
import { assertRentalBusinessTenantAccessAfterLock, hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { withAiTaskTransactionAuthority } from '../task-transaction-authority';
import { requestFingerprint } from '../rental-adapters/rental-idempotency.repository';
import { AiClientPolicyAuthority, type AiClientTaskDependencies } from './client-task.authority';
import { originalClientMaterialScope, PrismaClientSceneMaterialRepository, type AiClientMaterialDb,
  type AiClientMaterialScope, type AiClientSceneMaterial } from './prisma-client-scene-material.repository';
import { PrismaClientTaskInputRepository, type AiClientTaskInput } from './prisma-client-task-input.repository';

export interface ClientSelectedTransactionDependencies {
  clientAuth: Pick<ClientAuthService, 'lockCurrentSession'>;
  orders: Pick<RentalCoreFactRepository<Prisma.TransactionClient>, 'lockOrder' | 'findOrder'>;
}
interface ClientSelectedBinding {
  db: AiClientMaterialDb;
  transactions?: ClientSelectedTransactionDependencies;
  tasks?: AiClientTaskDependencies;
  identity: ClientRequestContext;
  channel: AiClientMaterialScope['channel'];
  appId?: string;
  bindingHash: string;
  publicationHash: string;
  assertCurrent(): Promise<void>;
  /** The standard host compares the exact original publication using this tx. */
  revalidatePublication?(tx: Prisma.TransactionClient): Promise<void>;
  clock(): Date;
}
type Scope = { active: boolean; input: ClientSelectedBinding; identity: NonNullable<ReturnType<typeof getRequestIdentity>>;
  identityHash: string; clientHash: string; materialScope: AiClientMaterialScope };
const scopes = new AsyncLocalStorage<Scope>();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
const sameScope = (actual: AiClientMaterialScope, expected: AiClientMaterialScope) =>
  (['tenantId', 'workspaceId', 'channel', 'principalKind', 'principalHash'] as const).every(key => actual[key] === expected[key]);

function current(scope: Scope) {
  const { identity, input } = scope;
  if (!scope.active || scopes.getStore() !== scope || getRequestIdentity() !== identity
    || hash(identity) !== scope.identityHash || hash(input.identity) !== scope.clientHash
    || identity.audience !== 'client' || identity.tenantId !== input.identity.tenantId
    || identity.workspaceId !== input.identity.workspaceId || identity.userId !== input.identity.customerId
    || identity.isSaasAdmin !== false || identity.staffApi || identity.isPlatformAdmin || identity.accessSession
    || identity.permissions !== undefined || identity.dataScope !== undefined || identity.locationScope !== undefined
    || input.identity.membershipStatus !== 'active') throw denied();
}

export async function withClientSelectedTransactions<T>(input: ClientSelectedBinding, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const identity = getRequestIdentity();
  if (!identity) throw denied();
  const parent = scopes.getStore();
  if (parent) {
    current(parent);
    if (parent.input.db !== input.db || parent.input.identity !== input.identity
      || parent.input.bindingHash !== input.bindingHash) throw denied();
    return consume();
  }
  const scope: Scope = { active: true, input, identity, identityHash: hash(identity), clientHash: hash(input.identity),
    materialScope: originalClientMaterialScope(input.identity, input.channel, input.appId) };
  return scopes.run(scope, async () => {
    try { current(scope); return await consume(); }
    finally { scope.active = false; }
  });
}

function selected(db: AiClientMaterialDb) {
  const scope = scopes.getStore();
  if (!scope || scope.input.db !== db) throw denied();
  current(scope);
  return scope;
}

async function begin(scope: Scope, tx: Prisma.TransactionClient, material: AiClientSceneMaterial, stored: boolean) {
  const { input, materialScope } = scope, ports = input.transactions;
  current(scope);
  if ('$transaction' in tx || typeof ports?.clientAuth?.lockCurrentSession !== 'function'
    || typeof ports.orders?.lockOrder !== 'function' || typeof ports.orders.findOrder !== 'function'
    || typeof input.revalidatePublication !== 'function') throw unavailable();
  if (!sameScope(material, materialScope) || material.bindingHash !== input.bindingHash
    || material.publicationHash !== input.publicationHash) throw denied();
  // This first slice is the original own-order material. Other material kinds
  // need their own original resource participant before a selected host mounts them.
  const command = material.command;
  if (!command || typeof command !== 'object' || !('kind' in command) || command.kind !== 'order'
    || !('orderId' in command) || typeof command.orderId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(command.orderId)) throw unavailable();
  const orderId = command.orderId;
  // No AI/current-data read precedes this original session's Tenant X lock.
  // Serializable reads are locking current reads, never a prior RR snapshot.
  const lease = await ports.clientAuth.lockCurrentSession(tx, input.identity);
  const principal = async () => {
    current(scope);
    if (hash(await lease.revalidate()) !== scope.clientHash) throw denied();
    await assertRentalBusinessTenantAccessAfterLock(tx, material.tenantId);
    current(scope);
  };
  await principal();
  await ports.orders.lockOrder(material.tenantId, orderId, tx);
  const resource = async () => {
    const order = await ports.orders.findOrder(material.tenantId, orderId, tx);
    // The original repository resolves the current workspace from this same
    // Guard store; its public Order does not expose a second workspace field.
    if (!order || order.id !== orderId || !clientOwnsRentalOrder(input.identity, order)) throw denied();
    await input.revalidatePublication!(tx);
    current(scope);
  };
  await resource();
  const materialKey = hash(material), repository = new PrismaClientSceneMaterialRepository(input.db);
  const verifyMaterial = async () => {
    if (!stored) return;
    const latest = await repository.findOperation(materialScope, material.operationKey, tx, true);
    if (!latest || hash(latest) !== materialKey) throw denied();
  };
  await verifyMaterial();
  return { revalidate: async () => { await principal(); await resource(); await verifyMaterial(); } };
}

/** First line of the ORIGINAL material-save callback. External transactions
 * are not admitted here after another caller may already hold business locks. */
export async function withClientSelectedMaterialTransaction<T>(db: AiClientMaterialDb, tx: Prisma.TransactionClient,
  material: AiClientSceneMaterial, consume: () => Promise<T>, external = false): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  if (external) throw unavailable();
  const scope = selected(db), lease = await begin(scope, tx, material, false);
  const result = await consume();
  await lease.revalidate();
  return result;
}

async function beginInput(scope: Scope, tx: Prisma.TransactionClient, row: AiClientTaskInput) {
  const { input } = scope, tasks = input.tasks;
  if (!tasks || tasks.db !== input.db || !sameScope(row, scope.materialScope)
    || row.sceneCode !== tasks.sceneCode || row.sceneVersion !== tasks.sceneVersion) throw denied();
  // Resolve the immutable locator outside Serializable; re-read under the
  // original row lock only after current Auth/Core and the owned Order.
  const material = await new PrismaClientSceneMaterialRepository(input.db).findSource(scope.materialScope, row.materialRef);
  if (!material) throw denied();
  const lease = await begin(scope, tx, material, true);
  const policy = new AiClientPolicyAuthority(tasks, tasks, 'client-selected-transaction', input.clock);
  const verify = async () => {
    current(scope);
    const grant = await policy.policy({ ...scope.materialScope, identity: input.identity }, 'create', tx, true);
    if (row.materialInputHash !== material.inputHash || row.materialHash !== material.materialHash
      || row.materialRevision !== material.revision || row.bindingHash !== material.bindingHash
      || row.policyId !== grant.id || row.policyRevision !== grant.revision
      || row.expiresAt <= input.clock() || material.expiresAt <= input.clock()) throw denied();
  };
  await verify();
  return { revalidate: async () => { await lease.revalidate(); await verify(); } };
}

/** First line of the original client-input claim, before its unique-key lock. */
export async function withClientSelectedInputTransaction<T>(db: AiClientMaterialDb, tx: Prisma.TransactionClient,
  row: AiClientTaskInput, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const scope = selected(db), lease = await beginInput(scope, tx, row);
  const result = await consume();
  await lease.revalidate();
  return result;
}

/** Only this original client creation command can enter AiTaskCreationRepository.
 * No task-center/operator authority or arbitrary Task/step/invocation is accepted. */
export async function withClientSelectedTaskCreation<T>(db: AiClientMaterialDb,
  command: { creationKey: string; materialRef: string }, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const scope = selected(db), tasks = scope.input.tasks;
  if (!tasks) throw unavailable();
  const inputs = new PrismaClientTaskInputRepository(tasks.db);
  return withAiTaskTransactionAuthority({ binding: hash({ scope: scope.materialScope, command }), begin: async (tx, reference) => {
    current(scope);
    if (reference.kind !== 'creation' || reference.sceneCode !== tasks.sceneCode) throw denied();
    const row = await inputs.findCreation(scope.materialScope, command.creationKey);
    if (!row || row.id !== reference.inputRef || row.materialRef !== command.materialRef) throw denied();
    const key = hash(row), lease = await beginInput(scope, tx, row);
    const verifyReference = async (value: typeof reference) => {
      if (value.kind !== 'creation' || value.inputRef !== row.id || value.sceneCode !== row.sceneCode) throw denied();
      const latest = await inputs.findCreation(scope.materialScope, command.creationKey, tx, true);
      if (!latest || hash(latest) !== key) throw denied();
    };
    await verifyReference(reference);
    return { verifyReference, revalidate: async () => { await lease.revalidate(); await verifyReference(reference); } };
  } }, consume);
}

/** Public persistence of the original Task/Run and result facts. The host must
 * supply current action/source authorities and a strict transaction participant. */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { isStrictAiTaskTransactionBoundary, type AiTaskTransactionAuthority, type AiTaskTransactionBoundary } from './task-transactions';
import { TaskPersistenceRepository } from './runtime/task-persistence.repository';
import { TaskCreationPersistenceRepository, type AiTaskCreationAuthority,
  type AiTaskCreationReceiptAuthority } from './runtime/task-creation-persistence.repository';
import { AiTaskResultRepository, type AiTaskResultProjection } from './runtime/runner/ai-task-result.repository';
import { AiTaskRepositoryError } from './task-errors';

export type { AiTaskRepositoryAuthority, AiTaskRepositoryOperation } from './runtime/task-persistence.repository';
export type { AiTaskCreationAuthority, AiTaskCreationReceiptAuthority, AiTaskResultProjection };
type Database = ConstructorParameters<typeof TaskPersistenceRepository>[0] & ConstructorParameters<typeof TaskCreationPersistenceRepository>[0]
  & ConstructorParameters<typeof AiTaskResultRepository>[0];
type Authority = AiTaskTransactionAuthority<Prisma.TransactionClient>;

/** The application binds its real request or worker authority per operation.
 * Creation/source checks must use the same transaction or already held authority;
 * callers must not put a second writer or a model call behind those ports. */
export function createPublicAiTaskPersistence(input: {
  db: Database;
  actions: ConstructorParameters<typeof TaskPersistenceRepository>[1];
  creation: AiTaskCreationAuthority;
  creationReceipt: AiTaskCreationReceiptAuthority;
  transactions: AiTaskTransactionBoundary<Prisma.TransactionClient>;
  clock?: () => Date;
  newId?: () => string;
}) {
  if (typeof input?.db?.$transaction !== 'function' || typeof input.creation?.resolve !== 'function'
    || typeof input.creationReceipt?.resolve !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const { db, actions, creation, creationReceipt } = input, clock = input.clock ?? (() => new Date());
  const boundary = input.transactions;
  if (!isStrictAiTaskTransactionBoundary(boundary))
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const tasks = new TaskPersistenceRepository(db, actions, clock, boundary);
  const create = new TaskCreationPersistenceRepository(db, creation, clock, input.newId ?? randomUUID, boundary, undefined, true);
  const receipts = TaskCreationPersistenceRepository.originalReceiptReader(db, creationReceipt, boundary, clock);
  const results = new AiTaskResultRepository(db, tasks, clock);
  const once = <T>(authority: Authority, work: () => Promise<T>) => boundary.withAiTaskTransactionAuthority(authority, work);
  return Object.freeze({
    create: (authority: Authority, command: unknown) => once(authority, () => create.create(command)),
    readCreation: receipts.readCreation,
    readMetadata: (taskId: string) => tasks.readMetadata(taskId),
    claimRun: (authority: Authority, command: unknown) => once(authority, () => tasks.claimRun(command)),
    claimRecoveryRun: (authority: Authority, command: unknown) => once(authority, () => tasks.claimRecoveryRun(command)),
    assertRecoveryRun: (lease: unknown) => tasks.assertRecoveryRun(lease),
    releaseRun: (authority: Authority, command: unknown) => once(authority, () => tasks.releaseRun(command)),
    readResult: (command: unknown) => results.read(command),
    readRunResults: (command: unknown) => results.readRunResults(command)
  });
}

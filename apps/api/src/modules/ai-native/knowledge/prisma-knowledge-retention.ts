/** Binds original knowledge CAS to one Prisma transaction and scope lock.
 * Nested repository callbacks reuse this transaction; no new store, policy,
 * execution permission or background deletion is introduced. */
import { Prisma } from '@prisma/client';
import type { KnowledgeDocumentRetention } from './knowledge-document.service';
import { PrismaKnowledgeRepository, type KnowledgePrismaClient } from './prisma-knowledge.repository';
import { unavailable } from './knowledge-errors';

export function createPrismaKnowledgeRetention(db: KnowledgePrismaClient,
  clock: () => Date): KnowledgeDocumentRetention {
  return {
    withTransaction: work => db.$transaction(async tx => {
      const bound = new Proxy(db, { get(_target, key) {
        if (key === '$transaction') return (callback: unknown) => {
          if (typeof callback !== 'function') return unavailable();
          return callback(tx);
        };
        const value = Reflect.get(tx, key);
        return typeof value === 'function' ? value.bind(tx) : value;
      } });
      return work(tx, new PrismaKnowledgeRepository(bound, clock));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 }),
  };
}

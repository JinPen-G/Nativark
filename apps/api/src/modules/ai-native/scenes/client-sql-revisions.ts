import { z } from 'zod';

// Prisma raw MySQL reads return unsigned INT columns as bigint. These schemas
// normalize only the existing persisted ranges; public DTOs and original hashes
// remain number-based. Never coerce strings, truncate or advance a revision.
export const clientSqlInitialRevisionSchema = z.union([z.literal(1), z.literal(1n)])
  .transform(() => 1 as const);
export const clientSqlPolicyRevisionSchema = z.union([
  z.number().int().min(1).max(4294967294),
  z.bigint().min(1n).max(4294967294n),
]).transform(value => Number(value));

import { z } from 'zod';
import { HumanKnowledgeContextService, knowledgeContextInputSchema } from './human-knowledge-context.service';
import type { HumanKnowledgeDependencies } from './human-knowledge.service';
import { KnowledgeCurrentSession } from './knowledge-current-session';
import { PersistentMemoryConsentService } from './persistent-memory-consent.service';
import type { MemoryAuthorizationPort } from './knowledge.ports';
import type { MemoryPrismaClient } from './prisma-memory.repository';
import { KnowledgeError, unavailable } from './knowledge-errors';
import { fingerprint, id, parse, preferenceSchema } from './knowledge-validation';

const preferenceSection = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not_requested') }).strict(),
  z.object({ status: z.literal('ready'), items: z.array(z.object({ memoryId: id,
    revision: z.number().int().min(1).max(4294967294), aclRevision: z.number().int().min(1).max(4294967294),
    expiresAt: z.string().datetime({ offset: true }), preference: preferenceSchema, confirmationRecordId: id }).strict()).max(10),
  truncated: z.boolean(), coverage: z.literal('bounded_window'), pagination: z.literal('unavailable'),
  semantics: z.literal('preference_not_authority') }).strict(),
]);

export type HumanKnowledgeInputDependencies = HumanKnowledgeDependencies & {
  /** Explicit formal policy and memory repository. Omission never grants access. */
  memory?: { db: MemoryPrismaClient; authorization: MemoryAuthorizationPort };
};

/** Preparation only. Preferences cannot alter system rules, Core facts, budget,
 * approval or dispatch. This service never calls a model or freezes a step.
 */
export class HumanKnowledgeInputService {
  private readonly session: KnowledgeCurrentSession;
  private readonly memory?: PersistentMemoryConsentService;
  constructor(private readonly context: HumanKnowledgeContextService, ports: HumanKnowledgeInputDependencies) {
    this.session = new KnowledgeCurrentSession(ports.auth, ports.credentials, ports.clock);
    if (ports.memory !== undefined) this.memory = new PersistentMemoryConsentService({ ...ports,
      db: ports.memory.db, authorization: ports.memory.authorization });
  }

  collect(value: unknown, options: unknown = { includePreferences: false }) {
    const input = parse(knowledgeContextInputSchema, value);
    const settings = parse(z.object({ includePreferences: z.boolean(),
      maxPreferences: z.number().int().min(1).max(10).optional() }).strict(), options);
    if (settings.includePreferences && !this.memory) return unavailable();
    return this.session.run(async () => {
      const knowledge = await this.context.collect(input);
      const preferences = settings.includePreferences
        ? await this.memory!.confirmedPreferences({ limit: settings.maxPreferences ?? 10 }) : undefined;
      // Check both sources again after all collection waits. This is not a
      // cross-resource transaction and must be repeated at actual consumption.
      if (knowledge.status === 'ready' || knowledge.status === 'partial') await this.context.revalidate(knowledge);
      if (preferences) {
        for (const item of preferences.items) {
          const fresh = await this.memory!.read(item.memoryId);
          if (fresh.status !== 'confirmed' || fresh.revision !== item.revision || fresh.aclRevision !== item.aclRevision
            || fresh.confirmationRecordId !== item.confirmationRecordId || fresh.expiresAt !== item.expiresAt
            || fingerprint(fresh.preference) !== fingerprint(item.preference)) return unavailable();
        }
      }
      // Preserve the existing knowledge package; an optional, separate section
      // carries only the existing bounded confirmed-preference projection.
      const result = { ...knowledge, preferences: preferences ? { status: 'ready' as const, ...preferences }
        : { status: 'not_requested' as const } };
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > input.maxTotalBytes) throw new KnowledgeError('limit_exceeded');
      return result;
    });
  }

  /** Revalidate the SAME prepared format before the host freezes its input.
   * Only ready/partial source packages are accepted. Status and query hashes
   * remain untrusted metadata, not proof of exhaustive or successful search.
   */
  revalidate(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KnowledgeError('invalid_input');
    const { preferences: raw, ...knowledge } = value as Record<string, unknown>;
    const preferences = parse(preferenceSection, raw);
    if (preferences.status === 'ready' && !this.memory) return unavailable();
    return this.session.run(async () => {
      const verified = await this.context.revalidate(knowledge);
      if (Buffer.byteLength(JSON.stringify({ ...verified, preferences }), 'utf8') > 65536) throw new KnowledgeError('limit_exceeded');
      if (preferences.status === 'ready') {
        const seen = new Set<string>();
        for (const item of preferences.items) {
          if (seen.has(item.memoryId)) return unavailable();
          seen.add(item.memoryId);
          const fresh = await this.memory!.read(item.memoryId);
          if (fresh.status !== 'confirmed' || fresh.revision !== item.revision || fresh.aclRevision !== item.aclRevision
            || fresh.confirmationRecordId !== item.confirmationRecordId || fresh.expiresAt !== item.expiresAt
            || fingerprint(fresh.preference) !== fingerprint(item.preference)) return unavailable();
        }
      }
      return { ...verified, preferences };
    });
  }
}

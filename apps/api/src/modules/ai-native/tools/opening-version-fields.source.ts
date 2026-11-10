/** Bounded original version-row field projection for AI-only proposals.
 * Uses the real rule/calendar detail Guard and ALS, not cached business state,
 * defaults, calendar generation or status/price algorithms. No write methods,
 * audit/body/URL publication or active-version attestation are exposed. */
import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { getRequestIdentity } from '../../../common/request-identity';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import { assertAiReadContextBinding } from './read-context-binding';
import { ModelGatewayError } from '../model-gateway.ports';

export const OPENING_RULE_BOOLEAN_FIELDS = ['fulfillment.pickupInspectionRequired', 'fulfillment.returnInspectionRequired',
  'fulfillment.evidenceRequired', 'fulfillment.allowDifferentReturnLocation', 'damage.manualReviewRequired', 'cancellation.weatherExceptionEnabled'] as const;
export type OpeningVersionFieldDb = Pick<PrismaClient, 'rentalRuleVersion' | 'rentalBusinessCalendar'>;
const unavailable = () => new ModelGatewayError('PROVIDER_UNAVAILABLE');
const changed = () => new ModelGatewayError('CONFIG_INVALID');
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export class AiOpeningVersionFieldSource {
  constructor(private readonly db: OpeningVersionFieldDb, private readonly routes: AiBusinessReadAuthority) {}
  async read(input: { key: 'business_rule' | 'business_calendar'; targetId: string; expectedVersion: string;
    date?: string; expectedRevision?: number }, expected: AiExecutionContext) {
    const body = input.key === 'business_rule' ? { version: input.expectedVersion }
      : { version: input.expectedVersion, year: Number(input.date?.slice(0, 4)) };
    return this.routes.withRead(input.key === 'business_rule' ? 'rule_version' : 'calendar_version', body, async context => {
      assertAiReadContextBinding(context, expected);
      const identity = getRequestIdentity();
      if (context.audience !== 'operator' || context.scope.kind !== 'workspace' || !identity
        || identity.tenantId !== context.scope.tenantId || identity.workspaceId !== context.scope.workspaceId) throw new ModelGatewayError('FORBIDDEN');
      const where = { id: input.targetId, tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId, version: input.expectedVersion };
      if (input.key === 'business_rule') {
        if (typeof this.db?.rentalRuleVersion?.findFirst !== 'function') throw unavailable();
        const row = await this.db.rentalRuleVersion.findFirst({ where, select: { id: true, tenantId: true, workspaceId: true,
          version: true, categoryCode: true, status: true, config: true, createdAt: true, effectiveFrom: true, publishedAt: true } });
        if (!row || Object.entries(where).some(([key, value]) => row[key as keyof typeof row] !== value)
          || !['draft', 'pending', 'published', 'superseded', 'void'].includes(row.status) || !plain(row.config)
          || Buffer.byteLength(JSON.stringify(row.config), 'utf8') > 131072) throw unavailable();
        const fields: Record<string, unknown> = {};
        for (const field of OPENING_RULE_BOOLEAN_FIELDS) {
          const [group, property] = field.split('.'), block = row.config[group];
          if (plain(block) && Object.prototype.hasOwnProperty.call(block, property)) fields[field] = block[property];
        }
        return { version: row.version, target: row.id, fields, categoryCode: row.categoryCode.toLowerCase(),
          fieldRevision: 'rule_version_and_checked_source_fingerprint_not_object_cas' as const,
          basis: { ...where, categoryCode: row.categoryCode, storedStatus: row.status, fields,
            createdAt: row.createdAt.toISOString(), effectiveFrom: row.effectiveFrom?.toISOString() ?? null, publishedAt: row.publishedAt?.toISOString() ?? null } };
      }
      if (typeof this.db?.rentalBusinessCalendar?.findFirst !== 'function') throw unavailable();
      const year = Number(input.date?.slice(0, 4));
      const row = await this.db.rentalBusinessCalendar.findFirst({ where: { ...where, year }, select: { id: true, tenantId: true,
        workspaceId: true, year: true, version: true, status: true, revision: true, days: true } });
      if (!row || Object.entries(where).some(([key, value]) => row[key as keyof typeof row] !== value) || row.year !== year
        || !['draft', 'published', 'superseded', 'void'].includes(row.status) || !Number.isInteger(row.revision) || row.revision < 0
        || !Array.isArray(row.days) || row.days.length > 366 || Buffer.byteLength(JSON.stringify(row.days), 'utf8') > 131072) throw unavailable();
      if (row.revision !== input.expectedRevision) throw changed();
      const days = row.days.filter(day => plain(day) && day.date === input.date);
      if (days.length !== 1 || !plain(days[0]) || typeof days[0].name !== 'string') throw unavailable();
      const fields: Record<string, unknown> = { name: days[0].name };
      for (const field of ['businessStatus', 'closed'] as const) {
        if (Object.prototype.hasOwnProperty.call(days[0], field)) fields[field] = days[0][field];
      }
      return { version: row.version, target: row.id, fields, baseRevision: row.revision, date: input.date!,
        fieldRevision: 'calendar_original_revision' as const,
        basis: { ...where, year, storedStatus: row.status, revision: row.revision, date: input.date, fields } };
    });
  }
}

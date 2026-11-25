/** Calendar-only original requests reuse the original repository, publication,
 * entitlement and identity checks. Creation requires calendar-edit; historical
 * receipts use the version-read Guard and cannot authorize creation. No general
 * opening/price authority or caller-controlled mode is accepted. */
import { AiCurrentOriginalRequestAuthority, type AiOriginalRequestAuthority } from './task-request/original-request.authority';
import { PrismaOriginalRequestRepository } from './task-request/prisma-original-request.repository';
import { AiBusinessReadRouteAuthority, type AiCalendarSourceReadTarget } from './business-read-route.authority';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import type { AiSceneRequestBody } from '@rental-os/shared';

function calendarRequests(input: AiOriginalSceneDependencies, target: AiCalendarSourceReadTarget, expiresAt?: string, readVersion?: string) {
  const clock = input.clock ?? (() => new Date());
  const routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, clock);
  const includesCalendar = (body: AiSceneRequestBody) => body.sceneCode === 'opening_diagnosis'
    && body.input.sections.includes('business_calendar');
  const rules = input.creationRules.filter(rule => rule.sceneCode === 'opening_diagnosis')
    .map(rule => ({ ...rule, requiredPermissions: ['rental-os:calendar:edit'], maxInputAgeMs: Math.min(rule.maxInputAgeMs, 120000) }));
  if (rules.length !== 1) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const original = new AiCurrentOriginalRequestAuthority(input.db, { ...input, creationRules: rules,
    authorizeResources: async body => {
      if (!includesCalendar(body)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      if (expiresAt !== undefined && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= clock().getTime()))
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return readVersion === undefined ? routes.withCalendarSourceRead(target, async context => context)
        : routes.withRead('calendar_version', { year: target.year, version: readVersion }, async context => context);
    }
  }, clock);
  const authority: AiOriginalRequestAuthority = {
    current: () => original.current(),
    read: (body, version) => {
      if (!includesCalendar(body)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return original.read(body, version);
    },
    create: body => {
      if (readVersion !== undefined || body.sceneCode !== 'opening_diagnosis' || body.input.sections.length !== 1
        || body.input.sections[0] !== 'business_calendar') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return original.create(body);
    },
    observeTask: taskId => original.observeTask(taskId)
  };
  return new PrismaOriginalRequestRepository(input.db, authority, clock);
}
export function createCalendarOriginalRequests(input: AiOriginalSceneDependencies, target: AiCalendarSourceReadTarget, expiresAt?: string) {
  return calendarRequests(input, target, expiresAt);
}
/** Historical proposal reads use the original calendar-version read Guard.
 * This repository cannot authorize creation, policy issuance or another R1. */
export function createCalendarOriginalReadRequests(input: AiOriginalSceneDependencies, target: AiCalendarSourceReadTarget & { version: string }) {
  return calendarRequests(input, target, undefined, target.version);
}

/** Rule-only original requests keep the original identity, publication,
 * entitlement and creation receipts. Current rule-edit authorizes preparation;
 * historical version reads cannot authorize another request or execution. */
import { AiCurrentOriginalRequestAuthority, type AiOriginalRequestAuthority } from './task-request/original-request.authority';
import { PrismaOriginalRequestRepository } from './task-request/prisma-original-request.repository';
import { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { AiOriginalSceneDependencies } from './scenes/original-scenes.composition';
import type { AiSceneRequestBody } from '@rental-os/shared';

function ruleRequests(input: AiOriginalSceneDependencies, target: { id: string; version: string }, readOnly: boolean) {
  const clock = input.clock ?? (() => new Date()), routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, clock);
  const includesRule = (body: AiSceneRequestBody) => body.sceneCode === 'opening_diagnosis' && body.input.sections.includes('business_rule');
  const rules = input.creationRules.filter(rule => rule.sceneCode === 'opening_diagnosis')
    .map(rule => ({ ...rule, requiredPermissions: ['rental-os:rules:manage'], maxInputAgeMs: Math.min(rule.maxInputAgeMs, 300000) }));
  if (rules.length !== 1) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const original = new AiCurrentOriginalRequestAuthority(input.db, { ...input, creationRules: rules,
    authorizeResources: async body => {
      if (!includesRule(body)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return readOnly ? routes.withRead('rule_version', { version: target.version }, async context => context)
        : routes.withRuleDraftPreview(target.id, async context => context);
    }
  }, clock);
  const authority: AiOriginalRequestAuthority = {
    current: () => original.current(),
    read: (body, version) => { if (!includesRule(body)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); return original.read(body, version); },
    create: body => {
      if (readOnly || body.sceneCode !== 'opening_diagnosis' || body.input.sections.length !== 1 || body.input.sections[0] !== 'business_rule')
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return original.create(body);
    },
    observeTask: taskId => original.observeTask(taskId)
  };
  return new PrismaOriginalRequestRepository(input.db, authority, clock);
}
export function createRuleOriginalRequests(input: AiOriginalSceneDependencies, target: { id: string; version: string }) {
  return ruleRequests(input, target, false);
}
export function createRuleOriginalReadRequests(input: AiOriginalSceneDependencies, target: { id: string; version: string }) {
  return ruleRequests(input, target, true);
}

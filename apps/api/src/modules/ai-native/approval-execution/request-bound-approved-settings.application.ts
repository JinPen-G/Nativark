import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composeApprovedSettingsApplication } from './approved-settings-application.composition';
import type { ApprovedSettingsApplicationDependencies } from './approved-settings-task.authority';
import { settingsApplicationError, settingsContract } from './approved-settings-contracts';
import type { AiApprovedSettingsErrorDraft } from '../../../../../../packages/shared/src/ai-approved-settings-draft';

type Request = { headers: { authorization?: unknown } };
type Result<T> = { ok: true; value: T } | { ok: false; error: AiApprovedSettingsErrorDraft };
const optionsSchema = z.object({ enabled: z.literal(true), audience: z.enum(['operator', 'staff']) }).strict();
const bearer = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);

export function composeRequestBoundApprovedSettingsApplication(dependencies: Omit<ApprovedSettingsApplicationDependencies, 'credentials'>,
  options: { enabled: boolean; audience: 'operator' | 'staff' }) {
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success || 'credentials' in dependencies || 'participant' in dependencies) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const call = async <T>(request: Request, consume: (app: ReturnType<typeof composeApprovedSettingsApplication>) => Promise<T>): Promise<Result<T>> => {
    let active = true;
    try {
      const header = bearer.safeParse(request?.headers?.authorization);
      if (!header.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const credential = Object.freeze({ authorization: header.data, audience: parsed.data.audience, requestId: randomUUID() });
      const app = composeApprovedSettingsApplication({ ...dependencies, credentials: { current: async () => {
        if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return { ...credential };
      } } });
      return { ok: true, value: await consume(app) };
    } catch (error) {
      return { ok: false, error: settingsContract('AiApprovedSettingsErrorDraft', settingsApplicationError(error), true) };
    } finally { active = false; }
  };
  return Object.freeze({
    prepare: (request: Request, value: unknown) => call(request, app => app.prepare(value)),
    readPreparationReceipt: (request: Request, value: unknown) => call(request, app => app.readPreparationReceipt(value)),
    readProposal: (request: Request, value: unknown) => call(request, app => app.readProposal(value)),
    decide: (request: Request, value: unknown) => call(request, app => app.decide(value)),
    readDecisionReceipt: (request: Request, value: unknown) => call(request, app => app.readDecisionReceipt(value)),
    commitApprovedChange: (request: Request, value: unknown) => call(request, app => app.commitApprovedChange(value)),
    readOperation: (request: Request, value: unknown) => call(request, app => app.readOperation(value))
  });
}

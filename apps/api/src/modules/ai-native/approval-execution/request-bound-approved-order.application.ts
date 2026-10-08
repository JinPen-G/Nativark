import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AiApprovalApplicationErrorDraft } from '../../../../../../packages/shared/src/ai-approval-application-draft';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { approvalApplicationContract, approvalApplicationError } from './approval-application-contracts';
import { composeControlledApprovedOrder, type ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';

type Request = { headers: { authorization?: unknown } };
type Dependencies = Omit<ControlledApprovedOrderDependencies, 'credentials'>;
type Application = ReturnType<typeof composeControlledApprovedOrder>['application'];
type Result<T> = { ok: true; value: T } | { ok: false; error: AiApprovalApplicationErrorDraft };
const optionsSchema = z.object({ enabled: z.literal(true), audience: z.enum(['operator', 'staff']) }).strict();
const authorizationSchema = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);

export function composeRequestBoundApprovedOrderApplication(dependencies: Dependencies, options: { enabled: boolean; audience: 'operator' | 'staff' }) {
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success || 'credentials' in dependencies) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const { audience } = parsed.data;
  const call = async <T>(request: Request, action: (app: Application) => Promise<T>): Promise<Result<T>> => {
    let active = true;
    try {
      const header = authorizationSchema.safeParse(request?.headers?.authorization);
      if (!header.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const credential = Object.freeze({ authorization: header.data, audience, requestId: randomUUID() });
      const app = composeControlledApprovedOrder({ ...dependencies, credentials: {
        current: async () => {
          if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          return { ...credential };
        }
      } }).application;
      return { ok: true, value: await action(app) };
    } catch (error) {
      return { ok: false, error: approvalApplicationContract('AiApprovalApplicationErrorDraft', approvalApplicationError(error), true) };
    } finally { active = false; }
  };
  return Object.freeze({
    readProposal: (request: Request, taskId: string, value: unknown) => call(request, app => app.readProposal(taskId, value)),
    decide: (request: Request, taskId: string, value: unknown) => call(request, app => app.decide(taskId, value)),
    readReceipt: (request: Request, taskId: string, value: unknown) => call(request, app => app.readReceipt(taskId, value)),
    readReprepareEligibility: (request: Request, taskId: string, value: unknown) => call(request, app => app.readReprepareEligibility(taskId, value)),
    reprepare: (request: Request, taskId: string, value: unknown) => call(request, app => app.reprepare(taskId, value)),
    readReprepareReceipt: (request: Request, taskId: string, value: unknown) => call(request, app => app.readReprepareReceipt(taskId, value))
  });
}

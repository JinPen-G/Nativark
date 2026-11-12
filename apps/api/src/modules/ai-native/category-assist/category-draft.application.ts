import { Module, Body, Controller, Header, HttpCode, HttpException, Inject, Param, Post, Req, type DynamicModule } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { z } from 'zod';
import { RENTAL_CATEGORY_DEFINITIONS, type SystemUserRow } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { CategoryGovernanceController } from '../../rental-core/category-governance.controller';
import { CategoryGovernancePreviewGuard } from '../../rental-core/category-governance-preview.guard';
import { CreateCategoryDraftDto, PatchCategoryDraftDto } from '../../rental-core/category-governance-request.dto';
import { withRequestAbort } from '../scenes/request-abort';
import type { IncomingMessage } from 'node:http';
import { categoryDraftRequest, categoryDraftResponse } from './category-draft-http.contract';

export class CategoryAssistError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'ACCESS_DENIED' | 'UNAVAILABLE', readonly writeMayHaveCommitted = false) { super(code); }
}

const code = z.string().min(1).max(128).refine(value => RENTAL_CATEGORY_DEFINITIONS.some(definition => definition.code === value));
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const versionRequest = z.object({ code, versionId: id }).strict();
type Dependencies = {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  controller: Pick<CategoryGovernanceController, 'detail' | 'create' | 'patch' | 'validate' | 'preview'>;
};

/** Current human draft preparation only, never a model tool. Original platform
 * Guard, preview gate, DTOs, CAS and audits are executed, not copied. Publication
 * and adoption remain at the original high-risk approval/application boundary. */
export class CategoryDraftApplication {
  private readonly previewGate = new CategoryGovernancePreviewGuard();
  constructor(private readonly dependencies: Dependencies) {
    if (!dependencies?.guard?.canActivate || !dependencies.credentials?.current
      || !dependencies.controller?.detail || !dependencies.controller.create
      || !dependencies.controller.patch || !dependencies.controller.validate || !dependencies.controller.preview) {
      throw new CategoryAssistError('UNAVAILABLE');
    }
  }

  async detail(value: unknown) {
    const input = this.parse(z.object({ code }).strict(), value);
    return this.current('GET', input.code, async user => this.dependencies.controller.detail(input.code, { user }));
  }

  async create(value: unknown) {
    const input = this.parse(z.object({ code, body: z.unknown() }).strict(), value);
    const body = await this.dto(CreateCategoryDraftDto, input.body);
    return this.current('POST', `${input.code}/drafts`, (user, authorization) =>
      this.dependencies.controller.create(input.code, body, { user, headers: { authorization } }), true);
  }

  async patch(value: unknown) {
    const input = this.parse(versionRequest.extend({ section: z.enum(['basic', 'attributes', 'inventory', 'pricing', 'inspection', 'capabilities']), body: z.unknown() }).strict(), value);
    const body = await this.dto(PatchCategoryDraftDto, input.body);
    return this.current('PATCH', `${input.code}/versions/${input.versionId}/sections/${input.section}`,
      (user, authorization) => this.dependencies.controller.patch(input.code, input.versionId, input.section,
        body, { user, headers: { authorization } }), true);
  }

  async review(value: unknown) {
    const input = this.parse(versionRequest, value);
    return this.current('GET', `${input.code}/versions/${input.versionId}/preview`, async user => {
      const result = await this.dependencies.controller.preview(input.code, input.versionId, { user });
      return { review: result, publication: 'unavailable' as const, adoption: 'unavailable' as const,
        semantics: 'draft_review_not_approval_publication_or_adoption' as const };
    });
  }

  async validate(value: unknown) {
    const input = this.parse(versionRequest, value);
    return this.current('POST', `${input.code}/versions/${input.versionId}/validate`,
      user => this.dependencies.controller.validate(input.code, input.versionId, { user }));
  }

  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new CategoryAssistError('INVALID_INPUT');
    return result.data;
  }

  private async dto<T extends object>(type: new () => T, value: unknown): Promise<T> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CategoryAssistError('INVALID_INPUT');
    // Snapshot before class-validator awaits; original service enforces section
    // ownership/depth/size. The whole request is bounded before that call.
    let snapshot: object;
    try {
      if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 256 * 1024) throw Error();
      snapshot = structuredClone(value);
    } catch { throw new CategoryAssistError('INVALID_INPUT'); }
    const result = plainToInstance(type, snapshot);
    if ((await validate(result, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true })).length) {
      throw new CategoryAssistError('INVALID_INPUT');
    }
    return result;
  }

  private async current<T>(method: string, suffix: string,
    execute: (user: SystemUserRow, authorization: string) => Promise<T>, mutating = false): Promise<T> {
    const credential = structuredClone(await this.dependencies.credentials.current());
    if (credential.audience !== 'operator' || typeof credential.authorization !== 'string'
      || credential.authorization.length < 1 || credential.authorization.length > 8192) throw new CategoryAssistError('ACCESS_DENIED');
    const path = `/api/platform/rental-categories/${suffix}`;
    const resolve = () => runWithRequestIdentity({}, async () => {
      const request = { method, url: path, originalUrl: path, headers: { authorization: credential.authorization }, query: {}, user: undefined as SystemUserRow | undefined };
      if (await this.dependencies.guard.canActivate(new ExecutionContextHost([request])) !== true) throw new CategoryAssistError('ACCESS_DENIED');
      this.previewGate.canActivate();
      const identity = getRequestIdentity();
      if (!request.user?.isActive || !request.user.isSaasAdmin || !identity?.isSaasAdmin
        || identity.staffApi || identity.userId !== request.user.id) throw new CategoryAssistError('ACCESS_DENIED');
      return { user: structuredClone(request.user), identity: structuredClone(identity) };
    });
    let before: Awaited<ReturnType<typeof resolve>>;
    try { before = await resolve(); } catch { throw new CategoryAssistError('ACCESS_DENIED'); }
    // Execute inside independent ALS; do not borrow an active tenant context.
    return runWithRequestIdentity(before.identity, async () => {
      // Core revalidates the same signed credential that passed this Guard.
      const result = await execute(before.user, credential.authorization);
      let after: Awaited<ReturnType<typeof resolve>>;
      try { after = await resolve(); } catch { throw new CategoryAssistError('ACCESS_DENIED', mutating); }
      if (JSON.stringify(after) !== JSON.stringify(before)) throw new CategoryAssistError('ACCESS_DENIED', mutating);
      return result;
    });
  }
}

/** No HTTP/AppModule registration or production enabling. */
@Module({})
export class CategoryAssistModule {
  static register(dependencies: Dependencies): DynamicModule {
    return { module: CategoryAssistModule, providers: [{ provide: CategoryDraftApplication, useValue: new CategoryDraftApplication(dependencies) }], exports: [CategoryDraftApplication] };
  }
}

export const AI_CATEGORY_DRAFT_REQUESTS = Symbol('AI_CATEGORY_DRAFT_REQUESTS');
const categoryOperations = ['detail', 'create', 'patch', 'validate', 'review'] as const;
type CategoryOperation = typeof categoryOperations[number];
type CategoryRequest = { headers: { authorization?: unknown } } & Partial<Pick<IncomingMessage, 'aborted' | 'once' | 'removeListener'>>;

/** Human transport over the original CAT-GOV services; not an agent tool,
 * proposal store or a second governance state machine. No publish/adopt API.
 * The original preview gate and platform permissions are never bypassed. */
export function composeCategoryDraftRequests(dependencies: Omit<Dependencies, 'credentials'>, options: { enabled: boolean }) {
  const enabled = z.object({ enabled: z.boolean() }).strict().parse(structuredClone(options)).enabled;
  return Object.freeze({
    async consume(request: CategoryRequest, operation: string, value: unknown, signal?: AbortSignal) {
      if (!(categoryOperations as readonly string[]).includes(operation)) throw new HttpException({ code: 'AI_INVALID_INPUT', retryable: false }, 400);
      const action = operation as CategoryOperation;
      const write = action === 'create' || action === 'patch';
      if (!enabled && (write || action === 'validate')) throw new HttpException({ code: 'AI_RESOURCE_UNAVAILABLE', retryable: false }, 503);
      let command: ReturnType<typeof categoryDraftRequest>;
      try {
        command = categoryDraftRequest(action, value);
      } catch { throw new HttpException({ code: 'AI_INVALID_INPUT', retryable: false }, 400); }
      let authorization = request?.headers?.authorization;
      if (typeof authorization !== 'string' || !authorization || authorization.length > 8192) {
        throw new HttpException({ code: 'AI_ACCESS_DENIED', retryable: false }, 403);
      }
      const requestId = randomUUID();
      const credentials = { current: async () => {
        if (typeof authorization !== 'string') throw new CategoryAssistError('ACCESS_DENIED');
        return { authorization, audience: 'operator' as const, requestId };
      } };
      const close = () => { authorization = undefined; };
      const interrupted = () => new HttpException({ code: write ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE', retryable: false,
        ...(write ? { nextAction: 'manual_review_original_draft_no_automatic_retry' } : {}) }, write ? 409 : 503);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      try {
        if (signal?.aborted) throw interrupted();
        const stopped = new Promise<never>((_, reject) => {
          abort = () => { close(); reject(interrupted()); };
          signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(abort, 5000);
        });
        const app = new CategoryDraftApplication({ ...dependencies, credentials });
        const result = await Promise.race([Promise.resolve().then<unknown>(() => app[action](structuredClone(command))), stopped]);
        return categoryDraftResponse(action, result, command);
      } catch (error) {
        const response = error instanceof HttpException ? error.getResponse() : undefined;
        if (response && typeof response === 'object' && 'code' in response) throw error;
        if (error instanceof CategoryAssistError && !error.writeMayHaveCommitted) {
          const status = error.code === 'INVALID_INPUT' ? 400 : error.code === 'ACCESS_DENIED' ? 403 : 503;
          throw new HttpException({ code: status === 400 ? 'AI_INVALID_INPUT' : status === 403 ? 'AI_ACCESS_DENIED' : 'AI_RESOURCE_UNAVAILABLE', retryable: false }, status);
        }
        // No operation receipt exists for legacy draft writes. Transport loss
        // cannot safely become a retry, or a fabricated successful creation.
        if (write) throw interrupted();
        throw new HttpException({ code: 'AI_RESOURCE_UNAVAILABLE', retryable: false }, 503);
      } finally {
        close();
        if (timer) clearTimeout(timer);
        if (abort) signal?.removeEventListener('abort', abort);
      }
    }
  });
}

@Controller('ai-native/category-drafts')
export class AiCategoryDraftController {
  constructor(@Inject(AI_CATEGORY_DRAFT_REQUESTS) private readonly requests: ReturnType<typeof composeCategoryDraftRequests>) {}
  @Post(':operation') @HttpCode(200) @Header('Cache-Control', 'no-store')
  consume(@Req() request: CategoryRequest, @Param('operation') operation: string, @Body() value: unknown) {
    return withRequestAbort(request, signal => this.requests.consume(request, operation, value, signal));
  }
}

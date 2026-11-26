/** Opt-in platform AI budget, rate review and credit administration.
 * All routes use the original Guard/session and selected Client. They never
 * reserve a call, start a Task or authorize a business operation. */
import { Body, Controller, Header, HttpCode, HttpException, Inject, Module, Post, Req,
  type DynamicModule, type FactoryProvider, type ModuleMetadata } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import type { SystemUserRow } from '@rental-os/platform-contracts';
import { AI_PLATFORM_FINANCE_ROUTES as routes, type AiPlatformFinanceAction } from '@rental-os/platform-contracts/ai-finance';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { PlatformAuthService, PlatformAuthenticationRepository, PlatformPrincipalAuthority, PLATFORM_AUTH_DATA_STORE }
  from '@rental-os/platform-server';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from '@rental-os/platform-server/ai-runtime';
import { AiScopeRepository } from './runtime/ai-scope.repository';
import { beginPlatformAiManagementTransaction, createPlatformAiManagementTransactions } from './platform-transactions';
import { BudgetError } from './runtime/budget/budget.ports';
import { presentPlatformBudgetSettings } from './runtime/budget/budget-settings';
import { createPublicPlatformBudgetSettings } from './runtime/budget/public-platform-budget-settings';
import { PlatformReviewedGatewayPriceService } from './runtime/budget/platform-price-review';
import { createPublicPlatformCredit } from './runtime/budget/public-platform-credit';
import { AiRequestWaitError, withRequestAbort, type AiRequestAbortSource } from './runtime/scenes/request-abort';
import { bindPlatformAiRequest } from './configuration/platform-ai-request';
import { platformModelProfileId } from './configuration/platform-model-settings-transport';
import { PLATFORM_AI_MODEL_MANAGE } from './configuration/platform-model-settings-policy';
import { platformFinanceHttpSchemas, platformFinancePermission } from './configuration/platform-finance-http-policy';
import { assertPlatformFinanceScope } from './configuration/platform-finance-scope';

export { createPlatformFinanceOpenApi, withPublicPlatformFinanceHttpAccess } from './configuration/platform-finance-http-policy';

type Database = Parameters<typeof createPublicPlatformBudgetSettings>[0]['db'] & ConstructorParameters<typeof PlatformReviewedGatewayPriceService>[0]
  & Parameters<typeof createPublicPlatformCredit>[0]['db'];
export interface PublicPlatformFinanceHost {
  db: Database;
  /** Fixed server selection. Request bodies cannot choose a pricing owner. */
  profileId: string;
  assertDataAvailable(db: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<void>;
}
type Dependencies = PublicPlatformFinanceHost & { auth: Pick<PlatformAuthService, 'resolveAccessContext'>;
  principals: Pick<PlatformPrincipalAuthority<Prisma.TransactionClient>, 'lock'> };
type Request = AiRequestAbortSource & { headers: { authorization?: unknown } };

const ajv = new Ajv({ strict: true, coerceTypes: false, removeAdditional: false, useDefaults: false });
addFormats(ajv);
const space = 'urn:zelo:platform-finance:';
const schemas = JSON.parse(JSON.stringify(platformFinanceHttpSchemas).replaceAll('#/components/schemas/', space));
for (const [name, schema] of Object.entries(schemas)) ajv.addSchema(schema as object, `${space}${name}`);
const validators = (name: string, value: unknown) => ajv.getSchema(`${space}${name}`)?.(value) === true;

const faultCodes: Record<string, [string, number]> = {
  INVALID: ['AI_INVALID_INPUT', 400], AI_INVALID_INPUT: ['AI_INVALID_INPUT', 400],
  FORBIDDEN: ['AI_ACCESS_DENIED', 403], AI_ACCESS_DENIED: ['AI_ACCESS_DENIED', 403], AI_SCOPE_CHANGED: ['AI_ACCESS_DENIED', 403],
  REVISION_CONFLICT: ['AI_REVISION_CONFLICT', 409], IDEMPOTENCY_CONFLICT: ['AI_REVISION_CONFLICT', 409],
  AI_REVISION_CONFLICT: ['AI_REVISION_CONFLICT', 409], AI_CREDIT_ALLOCATION_EXCEEDED: ['AI_CREDIT_ALLOCATION_EXCEEDED', 409],
  AI_PLATFORM_PRICING_NOT_CONFIGURED: ['AI_PLATFORM_PRICING_NOT_CONFIGURED', 503],
  PENDING_RECONCILIATION: ['AI_RESULT_UNKNOWN', 409], AI_RESULT_UNKNOWN: ['AI_RESULT_UNKNOWN', 409]
};
function fault(error: unknown, write: boolean): HttpException {
  const http = error instanceof HttpException ? error : undefined;
  const body = http?.getResponse();
  const raw = body && typeof body === 'object' && 'code' in body ? String(body.code)
    : error instanceof Error && 'code' in error ? String(error.code) : '';
  const [code, status] = error instanceof z.ZodError ? faultCodes.INVALID
    : error instanceof AiRequestWaitError || error instanceof AiTaskRunnerError
      ? write ? faultCodes.AI_RESULT_UNKNOWN : ['AI_RESOURCE_UNAVAILABLE', 503]
      : Object.hasOwn(faultCodes, raw) ? faultCodes[raw]
      : http?.getStatus() === 401 || http?.getStatus() === 403 ? faultCodes.FORBIDDEN
      : ['AI_RESOURCE_UNAVAILABLE', http?.getStatus() === 404 ? 404 : 503];
  return new HttpException({ code, retryable: false,
    ...(write && code === 'AI_RESULT_UNKNOWN' ? { nextAction: 'read_original_operation' } : {}) }, status);
}

export function createPublicPlatformFinanceRequests(dependencies: Dependencies) {
  if (!dependencies?.db || typeof dependencies.auth?.resolveAccessContext !== 'function'
    || typeof dependencies.principals?.lock !== 'function' || typeof dependencies.assertDataAvailable !== 'function'
    || !platformModelProfileId.safeParse(dependencies.profileId).success) throw new BudgetError('UNAVAILABLE');
  const { db, profileId, auth, principals } = dependencies;
  const available = dependencies.assertDataAvailable.bind(dependencies);
  return Object.freeze({ async consume(request: Request, action: AiPlatformFinanceAction, value: unknown) {
    const [, , write, input, output] = routes[action];
    try {
      let command: unknown;
      try {
        command = structuredClone(value);
        if (Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 65536 || !validators(input, command)) throw new BudgetError('INVALID');
      } catch { throw new BudgetError('INVALID'); }
      return await withRequestAbort(request, async signal => {
        const authority = bindPlatformAiRequest(auth, request, platformFinancePermission(action), signal);
        const assertDataAvailable: PublicPlatformFinanceHost['assertDataAvailable'] = async storage => {
          authority.assertActive(); await available(storage); authority.assertActive();
        };
        try {
          return await callAiTaskRunnerDependency(async () => {
            const initial = await authority.resolve();
            if (initial.actor.kind !== 'saas_admin' || !('permissions' in initial)) throw new BudgetError('FORBIDDEN');
            const identity = ({ requestId: _request, authorizedAt: _time, ...rest }: AiExecutionContext) => requestFingerprint(rest);
            const fingerprint = identity(initial);
            const actorId = initial.actor.userId;
            const permissions = requestFingerprint(initial.permissions);
            const assertCurrentUser = (user: SystemUserRow) => {
              authority.assertActive();
              if (user.id !== actorId || requestFingerprint(user.permissions) !== permissions)
                throw new BudgetError('FORBIDDEN');
            };
            const resolve = async () => {
              const current = await authority.resolve();
              if (identity(current) !== fingerprint) throw new BudgetError('FORBIDDEN');
              return current;
            };
            const recheck = async () => { await resolve(); };
            // Data availability is independent of identity resolution. Report
            // an unready selection before a scope repository rechecks authority.
            await assertDataAvailable(db);
            let result: unknown;
            if (action === 'budgetRead' || action === 'budgetSave' || action === 'budgetReceipt') {
              const budget = createPublicPlatformBudgetSettings({ db, profileId, authority: { resolve, resolveRead: resolve },
                principalAuthority: principals, assertDataAvailable, assertCurrentUser });
              if (action === 'budgetReceipt') result = await budget.readOperation(command);
              else {
                const policy = await (action === 'budgetRead' ? budget.read(command) : budget.save(command));
                // The closed request schema above owns this scene selector.
                result = presentPlatformBudgetSettings((command as { sceneCode: string }).sceneCode, policy);
              }
            } else {
              if (action === 'priceReview' || action === 'priceReceipt') {
                const scopes = new AiScopeRepository(db, { resolve });
                const participant = createPlatformAiManagementTransactions<Prisma.TransactionClient>({
                  principalAuthority: principals, requiredPermission: PLATFORM_AI_MODEL_MANAGE, assertDataAvailable, assertCurrentUser });
                const prices = new PlatformReviewedGatewayPriceService(db, { read: scopes, write: scopes }, profileId, recheck,
                  async (tx, actorId, scopeId) => {
                    const lease = await beginPlatformAiManagementTransaction(tx, actorId, participant);
                    return { close: lease.close, revalidatesReviewInTransaction: true,
                      async revalidate() { await assertPlatformFinanceScope(tx, scopeId); await lease.revalidate(); } };
                  });
                result = await (action === 'priceReview' ? prices.review(command) : prices.receipt(command));
              } else {
                const credit = createPublicPlatformCredit({ db, actorId, recheck, principals, assertDataAvailable, assertCurrentUser });
                result = await (action === 'creditRead' ? credit.read(command)
                  : action === 'creditReceipt' ? credit.receipt(command) : credit.decide(command));
              }
            }
            try {
              const snapshot = structuredClone(result);
              if (!validators(output, snapshot) || Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 65536) throw new BudgetError('UNAVAILABLE');
              // After the last storage await, deny late data or preserve the
              // keyed write's uncertainty if persistence may have completed.
              await recheck();
              return snapshot;
            } catch (error) {
              if (write) throw new BudgetError('PENDING_RECONCILIATION');
              throw error;
            }
          }, 5000, 'platform_finance', signal);
        } finally { authority.close(); }
      }, { maxWaitMs: 15000 });
    } catch (error) { throw fault(error, write); }
  } });
}

const HOST = Symbol('public.platform-ai-finance.host');
const REQUESTS = Symbol('public.platform-ai-finance.requests');
type Requests = ReturnType<typeof createPublicPlatformFinanceRequests>;

@Controller(routes.budgetRead[0])
export class PublicPlatformBudgetController {
  constructor(@Inject(REQUESTS) private readonly requests: Requests) {}
  @Post(routes.budgetRead[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: Request, @Body() value: unknown) { return this.requests.consume(request, 'budgetRead', value); }
  @Post(routes.budgetSave[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  save(@Req() request: Request, @Body() value: unknown) { return this.requests.consume(request, 'budgetSave', value); }
  @Post(routes.budgetReceipt[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  receipt(@Req() request: Request, @Body() value: unknown) { return this.requests.consume(request, 'budgetReceipt', value); }
  @Post(routes.priceReview[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reviewPrice(@Req() request: Request, @Body() value: unknown) { return this.requests.consume(request, 'priceReview', value); }
  @Post(routes.priceReceipt[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  priceReceipt(@Req() request: Request, @Body() value: unknown) { return this.requests.consume(request, 'priceReceipt', value); }
}

@Controller(routes.creditRead[0])
export class PublicPlatformCreditController {
  constructor(@Inject(REQUESTS) private readonly requests: Requests) {}
  @Post(routes.creditRead[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: Request, @Body() value: unknown) { return this.requests.consume(request, 'creditRead', value); }
  @Post(routes.creditDecide[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  decide(@Req() request: Request, @Body() value: unknown) { return this.requests.consume(request, 'creditDecide', value); }
  @Post(routes.creditReceipt[1]) @HttpCode(200) @Header('Cache-Control', 'no-store')
  receipt(@Req() request: Request, @Body() value: unknown) { return this.requests.consume(request, 'creditReceipt', value); }
}

@Module({})
export class PublicPlatformFinanceModule {
  static register<Args extends unknown[]>(host: { imports: NonNullable<ModuleMetadata['imports']>; inject?: FactoryProvider['inject'];
    useFactory(...args: Args): PublicPlatformFinanceHost | Promise<PublicPlatformFinanceHost> }): DynamicModule {
    return { module: PublicPlatformFinanceModule, imports: host.imports, controllers: [PublicPlatformBudgetController, PublicPlatformCreditController],
      providers: [{ provide: HOST, inject: host.inject ?? [], useFactory: host.useFactory }, {
        provide: REQUESTS, inject: [HOST, PLATFORM_AUTH_DATA_STORE, PlatformAuthService, PlatformAuthenticationRepository],
        useFactory: (selected: PublicPlatformFinanceHost, authDb: object, auth: PlatformAuthService, users: PlatformAuthenticationRepository) => {
          if (!Object.is(selected.db, authDb)) throw new BudgetError('UNAVAILABLE');
          return createPublicPlatformFinanceRequests({ ...selected, auth, principals: new PlatformPrincipalAuthority<Prisma.TransactionClient>(users) });
        }
      }] };
  }
}

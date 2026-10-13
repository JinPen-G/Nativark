import { Body, Controller, Header, HttpCode, HttpException, Inject, Module, Post, Req, type DynamicModule } from '@nestjs/common';
import { AI_BUDGET_MANAGEMENT_HTTP_DRAFT, AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS, AI_USAGE_DRAFT_SCHEMAS,
  type AiBudgetSettingsHttpFailureDraft } from '@rental-os/shared';
import Ajv from 'ajv';
import { BudgetError } from './budget.ports';
import { composeRequestBoundBudgetManagement, type BudgetManagementDependencies, type BudgetManagementRequest } from './budget-management.application';

export const AI_BUDGET_MANAGEMENT = Symbol('AI_BUDGET_MANAGEMENT');
type Application = ReturnType<typeof composeRequestBoundBudgetManagement>;
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
const refs = (value: unknown): unknown => Array.isArray(value) ? value.map(refs) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === '$ref' && typeof child === 'string'
    ? child.replace(/^#\/components\/schemas\//u, 'urn:rental:budget-management:') : refs(child)])) : value;
for (const [name, schema] of Object.entries({ ...AI_USAGE_DRAFT_SCHEMAS, ...AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS })) {
  ajv.addSchema(refs(schema) as object, `urn:rental:budget-management:${name}`);
}
const tenantSummary = ajv.getSchema('urn:rental:budget-management:AiBudgetSettingsSummaryDraft')!;
const platformSummary = ajv.getSchema('urn:rental:budget-management:AiPlatformBudgetSettingsSummaryDraft')!;
const tenantChange = ajv.getSchema('urn:rental:budget-management:AiBudgetSettingsChangeResponseDraft')!;
@Controller(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.basePath)
export class AiBudgetManagementController {
  constructor(@Inject(AI_BUDGET_MANAGEMENT) private readonly application: Application) {}
  private checked<T>(value: T, platform: boolean, afterSave = false): T {
    const validate = platform ? platformSummary : afterSave ? tenantChange : tenantSummary;
    if (!validate(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > 65536) {
      throw new BudgetError(afterSave ? 'PENDING_RECONCILIATION' : 'UNAVAILABLE');
    }
    return structuredClone(value);
  }
  private async respond<T>(work: () => Promise<T>) {
    try { return await work(); }
    catch (error) {
      const codes: Record<string, [AiBudgetSettingsHttpFailureDraft['code'], number]> = {
        INVALID: ['AI_INVALID_INPUT', 400], FORBIDDEN: ['AI_ACCESS_DENIED', 403],
        REVISION_CONFLICT: ['AI_REVISION_CONFLICT', 409], IDEMPOTENCY_CONFLICT: ['AI_REVISION_CONFLICT', 409],
        PENDING_RECONCILIATION: ['AI_RESULT_UNKNOWN', 409], AI_ACCESS_DENIED: ['AI_ACCESS_DENIED', 403],
        AI_SCOPE_CHANGED: ['AI_ACCESS_DENIED', 403], AI_INVALID_INPUT: ['AI_INVALID_INPUT', 400]
      };
      const raw = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
      const [code, status] = Object.prototype.hasOwnProperty.call(codes, raw)
        ? codes[raw] : ['AI_RESOURCE_UNAVAILABLE', 503] as const;
      const body: AiBudgetSettingsHttpFailureDraft = { code, retryable: false,
        ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: 'read_same_policy' as const } : {}) };
      throw new HttpException(body, status);
    }
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: BudgetManagementRequest, @Body() body: unknown) {
    return this.respond(async () => this.checked(await this.application.read(request, body), false));
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.change) @HttpCode(200) @Header('Cache-Control', 'no-store')
  change(@Req() request: BudgetManagementRequest, @Body() body: unknown) {
    return this.respond(async () => this.checked(await this.application.change(request, body), false, true));
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.initialize) @HttpCode(200) @Header('Cache-Control', 'no-store')
  initialize(@Req() request: BudgetManagementRequest, @Body() body: unknown) {
    return this.respond(async () => this.checked(await this.application.initialize(request, body), false, true));
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformRead) @HttpCode(200) @Header('Cache-Control', 'no-store')
  platformRead(@Req() request: BudgetManagementRequest, @Body() body: unknown) {
    return this.respond(async () => this.checked(await this.application.platformRead(request, body), true));
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformSave) @HttpCode(200) @Header('Cache-Control', 'no-store')
  platformSave(@Req() request: BudgetManagementRequest, @Body() body: unknown) {
    return this.respond(async () => this.checked(await this.application.platformSave(request, body), true, true));
  }
}

/** No AppModule registration. Disabled registration contributes no routes,
 * providers, identity reads, timers or financial calls. */
@Module({})
export class AiBudgetManagementModule {
  static registerHttp(dependencies: BudgetManagementDependencies, options: { enabled: boolean } = { enabled: false }): DynamicModule {
    if (options.enabled !== true) return { module: AiBudgetManagementModule };
    const application = composeRequestBoundBudgetManagement(dependencies, { enabled: true });
    return { module: AiBudgetManagementModule, controllers: [AiBudgetManagementController],
      providers: [{ provide: AI_BUDGET_MANAGEMENT, useValue: application }], exports: [AI_BUDGET_MANAGEMENT] };
  }
}

import { Body, Controller, Header, HttpCode, HttpException, Inject, Module, Post, Req, type DynamicModule } from '@nestjs/common';
import { AI_BUDGET_MANAGEMENT_HTTP_DRAFT, AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS, AI_USAGE_DRAFT_SCHEMAS,
  type AiBudgetSettingsHttpFailureDraft, type AiGatewayPriceSummaryDraft, type AiGatewayInputBoundSummaryDraft,
  type AiGatewayPriceReviewResponseDraft } from '@rental-os/shared';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { BudgetError } from './budget.ports';
import { composeRequestBoundBudgetManagement, type BudgetManagementDependencies, type BudgetManagementRequest } from './budget-management.application';
import { GatewayPricingRequestFactory, type GatewayPricingHttpRequest } from './gateway-pricing-request.composition';
import { withRequestAbort, AiRequestWaitError, type AiRequestAbortSource } from '../scenes/request-abort';

export const AI_BUDGET_MANAGEMENT = Symbol('AI_BUDGET_MANAGEMENT');
export const AI_GATEWAY_PRICING_HISTORY = Symbol('AI_GATEWAY_PRICING_HISTORY');
type Application = ReturnType<typeof composeRequestBoundBudgetManagement>;
type SettingsRequest = BudgetManagementRequest & AiRequestAbortSource;
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const refs = (value: unknown): unknown => Array.isArray(value) ? value.map(refs) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, key === '$ref' && typeof child === 'string'
    ? child.replace(/^#\/components\/schemas\//u, 'urn:rental:budget-management:') : refs(child)])) : value;
for (const [name, schema] of Object.entries({ ...AI_USAGE_DRAFT_SCHEMAS, ...AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS })) {
  ajv.addSchema(refs(schema) as object, `urn:rental:budget-management:${name}`);
}
const tenantSummary = ajv.getSchema('urn:rental:budget-management:AiBudgetSettingsSummaryDraft')!;
const platformSummary = ajv.getSchema('urn:rental:budget-management:AiPlatformBudgetSettingsSummaryDraft')!;
const tenantChange = ajv.getSchema('urn:rental:budget-management:AiBudgetSettingsChangeResponseDraft')!;
const tenantOperation = ajv.getSchema('urn:rental:budget-management:AiBudgetSettingsOperationReceiptDraft')!;
async function respondBudgetManagement<T>(work: () => Promise<T>, policyReadback = true, originalOperation = false) {
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
      ...(code === 'AI_RESULT_UNKNOWN' && policyReadback ? { nextAction: originalOperation ? 'read_original_operation' as const : 'read_same_policy' as const } : {}) };
    throw new HttpException(body, status);
  }
}
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
  private hasOperationKey(body: unknown) {
    return !!body && typeof body === 'object' && 'operationKey' in body && typeof body.operationKey === 'string'
      && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(body.operationKey);
  }
  private async respond<T>(request: SettingsRequest, write: boolean, work: (signal: AbortSignal) => Promise<T>, policyReadback = true, originalOperation = false) {
    return respondBudgetManagement(async () => {
      try { return await withRequestAbort(request, work); }
      catch (error) {
        if (error instanceof AiRequestWaitError) throw new BudgetError(write ? 'PENDING_RECONCILIATION' : 'UNAVAILABLE');
        throw error;
      }
    }, policyReadback, originalOperation);
  }
  private priceReviewResult(value: unknown, write: boolean) {
    const validate = ajv.getSchema<AiGatewayPriceReviewResponseDraft>('urn:rental:budget-management:AiGatewayPriceReviewResponseDraft');
    if (!validate?.(value) || Buffer.byteLength(JSON.stringify(value), 'utf8') > 65536)
      throw new BudgetError(write ? 'PENDING_RECONCILIATION' : 'UNAVAILABLE');
    return structuredClone(value as AiGatewayPriceReviewResponseDraft);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.readPriceConfiguration) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readPriceConfiguration(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, false, async signal => {
      const result = await this.application.readPriceConfiguration(request, body, signal);
      const validate = ajv.getSchema('urn:rental:budget-management:AiGatewayPriceConfigurationDraft');
      if (!validate?.(result) || Buffer.byteLength(JSON.stringify(result), 'utf8') > 2048) throw new BudgetError('UNAVAILABLE');
      return structuredClone(result);
    }, false);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.reviewPrice) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reviewPrice(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, true, async signal => this.priceReviewResult(await this.application.reviewPrice(request, body, signal), true), false);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.readPriceReview) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readPriceReview(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, false, async signal => this.priceReviewResult(await this.application.readPriceReview(request, body, signal), false), false);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformReviewPrice) @HttpCode(200) @Header('Cache-Control', 'no-store')
  platformReviewPrice(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, true, async signal => this.priceReviewResult(await this.application.platformReviewPrice(request, body, signal), true), false);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformPriceReviewReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  platformPriceReviewReceipt(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, false, async signal => this.priceReviewResult(await this.application.platformPriceReviewReceipt(request, body, signal), false), false);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.adoptPlatformPrice) @HttpCode(200) @Header('Cache-Control', 'no-store')
  adoptPlatformPrice(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, true, async signal => this.priceReviewResult(await this.application.adoptPlatformPrice(request, body, signal), true), false);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.previewPlatformPrice) @HttpCode(200) @Header('Cache-Control', 'no-store')
  previewPlatformPrice(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, false, async signal => {
      const result = await this.application.previewPlatformPrice(request, body, signal);
      const validate = ajv.getSchema('urn:rental:budget-management:AiGatewayPlatformPricePreviewDraft');
      if (!validate?.(result) || Buffer.byteLength(JSON.stringify(result), 'utf8') > 8192) throw new BudgetError('UNAVAILABLE');
      return structuredClone(result);
    }, false);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.readPlatformPriceAdoption) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readPlatformPriceAdoption(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, false, async signal => this.priceReviewResult(await this.application.readPlatformPriceAdoption(request, body, signal), false), false);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, false, async signal => this.checked(await this.application.read(request, body, signal), false));
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.readOperation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readOperation(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, false, async signal => {
      const result = await this.application.readOperation(request, body, signal);
      if (!tenantOperation(result) || Buffer.byteLength(JSON.stringify(result), 'utf8') > 4096) throw new BudgetError('UNAVAILABLE');
      return structuredClone(result);
    }, false);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.change) @HttpCode(200) @Header('Cache-Control', 'no-store')
  change(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, true, async signal => this.checked(await this.application.change(request, body, signal), false, true), true, this.hasOperationKey(body));
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.initialize) @HttpCode(200) @Header('Cache-Control', 'no-store')
  initialize(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, true, async signal => this.checked(await this.application.initialize(request, body, signal), false, true), true, this.hasOperationKey(body));
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.refreshConfiguration) @HttpCode(200) @Header('Cache-Control', 'no-store')
  refreshConfiguration(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, true, async signal => this.checked(await this.application.refreshConfiguration(request, body, signal), false, true), true, this.hasOperationKey(body));
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformRead) @HttpCode(200) @Header('Cache-Control', 'no-store')
  platformRead(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, false, async signal => this.checked(await this.application.platformRead(request, body, signal), true));
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformSave) @HttpCode(200) @Header('Cache-Control', 'no-store')
  platformSave(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, true, async signal => this.checked(await this.application.platformSave(request, body, signal), true, true), true, this.hasOperationKey(body));
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.platformReadOperation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  platformReadOperation(@Req() request: SettingsRequest, @Body() body: unknown) {
    return this.respond(request, false, async signal => {
      const result = await this.application.platformReadOperation(request, body, signal);
      const validate = ajv.getSchema('urn:rental:budget-management:AiPlatformBudgetSettingsOperationReceiptDraft');
      if (!validate?.(result) || Buffer.byteLength(JSON.stringify(result), 'utf8') > 4096) throw new BudgetError('UNAVAILABLE');
      return structuredClone(result);
    }, false);
  }
}

/** Separate read-only host: no publishing methods, producer, budget admission
 * or model driver. The global Guard and factory both enforce current authority. */
@Controller(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.basePath)
export class AiGatewayPricingHistoryController {
  constructor(@Inject(AI_GATEWAY_PRICING_HISTORY) private readonly application: Pick<GatewayPricingRequestFactory, 'call'>) {}
  private read<T>(request: GatewayPricingHttpRequest, body: unknown, action: 'readPrice' | 'readPublication' | 'readInputBound',
    inputSchema: string, outputSchema: string): Promise<T> {
    return respondBudgetManagement<T>(async () => {
      const validateInput = ajv.getSchema(`urn:rental:budget-management:${inputSchema}`);
      const validateOutput = ajv.getSchema<T>(`urn:rental:budget-management:${outputSchema}`);
      if (!validateInput || !validateInput(body)) throw new BudgetError('INVALID');
      const command = structuredClone(body);
      let result: unknown;
      try {
        result = await withRequestAbort(request,
          signal => this.application.call(request, action, command, signal), { maxWaitMs: 15000 });
      } catch (error) {
        if (error instanceof AiRequestWaitError) throw new BudgetError('UNAVAILABLE');
        throw error;
      }
      if (!validateOutput || !validateOutput(result) || Buffer.byteLength(JSON.stringify(result), 'utf8') > 65536)
        throw new BudgetError('UNAVAILABLE');
      return structuredClone(result as T); // Closed shared schema checked above.
    }, false);
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.priceRead) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readPrice(@Req() request: GatewayPricingHttpRequest, @Body() body: unknown) {
    return this.read<AiGatewayPriceSummaryDraft>(request, body, 'readPrice', 'AiGatewayPriceReadDraft', 'AiGatewayPriceSummaryDraft');
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.pricePublicationRead) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readPublication(@Req() request: GatewayPricingHttpRequest, @Body() body: unknown) {
    return this.read<AiGatewayPriceSummaryDraft>(request, body, 'readPublication', 'AiGatewayPricePublicationReadDraft', 'AiGatewayPriceSummaryDraft');
  }
  @Post(AI_BUDGET_MANAGEMENT_HTTP_DRAFT.inputBoundRead) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readInputBound(@Req() request: GatewayPricingHttpRequest, @Body() body: unknown) {
    return this.read<AiGatewayInputBoundSummaryDraft>(request, body, 'readInputBound', 'AiGatewayInputBoundReadDraft', 'AiGatewayInputBoundSummaryDraft');
  }
}

/** Standalone registration remains opt-in; the standard root supplies its own
 * default-closed settings provider. Disabled module registration contributes
 * no routes, identity reads, timers or financial calls. */
@Module({})
export class AiBudgetManagementModule {
  /** Opt-in observations only; may be assembled without a publication source.
   * Does not mount settings writes or enable anything in the production root. */
  static registerHttpPricingHistory(dependencies?: Omit<ConstructorParameters<typeof GatewayPricingRequestFactory>[0], 'pricingEvidence'>,
    options: { enabled: boolean } = { enabled: false }): DynamicModule {
    if (options.enabled !== true) return { module: AiBudgetManagementModule, controllers: [], providers: [] };
    if (!dependencies || 'pricingEvidence' in dependencies) throw new BudgetError('UNAVAILABLE');
    return { module: AiBudgetManagementModule, controllers: [AiGatewayPricingHistoryController], providers: [{
      provide: AI_GATEWAY_PRICING_HISTORY, useValue: new GatewayPricingRequestFactory(dependencies)
    }], exports: [AI_GATEWAY_PRICING_HISTORY] };
  }
  static registerHttp(dependencies: BudgetManagementDependencies, options: { enabled: boolean } = { enabled: false }): DynamicModule {
    if (options.enabled !== true) return { module: AiBudgetManagementModule };
    const application = composeRequestBoundBudgetManagement(dependencies, { enabled: true });
    return { module: AiBudgetManagementModule, controllers: [AiBudgetManagementController],
      providers: [{ provide: AI_BUDGET_MANAGEMENT, useValue: application }], exports: [AI_BUDGET_MANAGEMENT] };
  }
}

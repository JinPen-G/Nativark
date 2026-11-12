import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_AUTOMATION_REVIEW_QUEUE_HTTP_DRAFT } from '@rental-os/shared';
import { AI_AUTOMATION_EVENT_TASK_HTTP_DRAFT, AI_AUTOMATION_EVENT_TASK_HTTP_SCHEMAS } from '@rental-os/shared';
import { AI_AUTOMATION_REVIEW_HTTP_CONTRACTS, AI_AUTOMATION_REVIEW_HTTP_SCHEMAS, AI_EVENTS_DRAFT_SCHEMAS,
  AI_AUTOMATION_REVIEW_GRANT_HTTP_DRAFT } from '@rental-os/shared';
import { AI_NATIVE_COMPONENT_SCHEMAS } from '../../../contracts/ai-native-schemas';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { BusinessFailureError } from '../business-events/prisma-business-failure-outbox';
import { AutomationError } from './prisma-automation.authority';
import { HumanAutomationReviewError } from './human-automation-review.service';
import { HumanAutomationRequestFactory, type HumanAutomationHttpRequest, type HumanAutomationRequestAction } from './human-automation-request.composition';
import { withRequestAbort } from '../scenes/request-abort';

const eventTaskAjv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(eventTaskAjv);
const validEventTask = eventTaskAjv.compile(AI_AUTOMATION_EVENT_TASK_HTTP_SCHEMAS.AiAutomationEventTaskResponseDraft);
const reviewDefinitions = JSON.parse(JSON.stringify({ ...AI_NATIVE_COMPONENT_SCHEMAS,
  ...AI_EVENTS_DRAFT_SCHEMAS, ...AI_AUTOMATION_REVIEW_HTTP_SCHEMAS }).replaceAll('#/components/schemas/', '#/$defs/'));
const reviewValidators = Object.fromEntries(Object.keys(AI_AUTOMATION_REVIEW_HTTP_SCHEMAS).map(name => [name,
  eventTaskAjv.compile({ $ref: `#/$defs/${name}`, $defs: reviewDefinitions })]));

abstract class HumanAutomationController {
  protected abstract readonly audience: 'operator' | 'staff';
  constructor(protected readonly requests: HumanAutomationRequestFactory) {}

  private async call(request: HumanAutomationHttpRequest, action: HumanAutomationRequestAction, value: unknown) {
    try {
      const contract = AI_AUTOMATION_REVIEW_HTTP_CONTRACTS[action as keyof typeof AI_AUTOMATION_REVIEW_HTTP_CONTRACTS];
      if (contract && !reviewValidators[contract.request](value)) throw new AutomationError('invalid_input');
      const result = await withRequestAbort(request, signal => this.requests.call(request, this.audience, action, value, signal));
      if (contract) {
        try { const copy = structuredClone(result); if (reviewValidators[contract.response](copy)) return copy; }
        catch { /* Do not expose raw internal material or validation diagnostics. */ }
        // Candidate reads may expire an outbox marker. Treat their damaged
        // acknowledgements like other metadata writes, without retry permission.
        throw new AutomationError(['readCandidate', 'prepareCandidate', 'preparePending', 'prepareInput', 'createTask', 'close', 'feedback', 'enableGrant'].includes(action)
          ? 'result_unknown' : 'unavailable');
      }
      if (action !== 'createEventTask') return result;
      // Metadata writes can already have committed. A bad reply is unknown,
      // never a new task, execution grant, or safe automatic retry.
      try { const copy = structuredClone(result); if (validEventTask(copy)) return copy; } catch { /* no raw result escapes */ }
      throw new AutomationError('result_unknown');
    }
    catch (error) {
      const reason = error instanceof AutomationError || error instanceof HumanAutomationReviewError || error instanceof BusinessFailureError
        ? error.code : error instanceof AiTaskRepositoryError && error.code === 'AI_INVALID_INPUT' ? 'invalid_input'
          : error instanceof Error && 'code' in error && error.code === 'AI_RESULT_UNKNOWN' ? 'result_unknown' : 'unavailable';
      const code = reason === 'invalid_input' ? 'AI_INVALID_INPUT' : reason === 'conflict' ? 'AI_REVISION_CONFLICT'
        : reason === 'limit_reached' ? 'AI_LIMIT_REACHED' : reason === 'result_unknown' ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE';
      // Even a failed batch may already have prepared some original candidates.
      // Never turn this into an empty success, a retry instruction or an approval.
      throw new HttpException({ code, retryable: false, executionPermission: false, businessActionRequested: false,
        nextAction: action === 'readQueue' ? 'read_review_queue'
          : action === 'prepareGrant' || action === 'enableGrant' || action === 'readGrant' ? 'read_original_grant'
          : action === 'close' || action === 'feedback' || action === 'operation' ? 'read_original_operation'
          : action === 'createTask' || action === 'readCreation' ? 'read_original_creation' : 'read_original_event' },
      reason === 'invalid_input' ? 400 : reason === 'conflict' || reason === 'result_unknown' ? 409 : reason === 'limit_reached' ? 429 : 503);
    }
  }

  @Post('candidates/read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCandidate(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'readCandidate', value); }

  @Post('candidates/prepare') @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepareCandidate(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'prepareCandidate', value); }

  @Post('candidates/prepare-pending') @HttpCode(200) @Header('Cache-Control', 'no-store')
  preparePending(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'preparePending', value); }

  @Post('inputs/prepare') @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepareInput(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'prepareInput', value); }

  @Post('inputs/read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  readInput(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'readInput', value); }

  @Post('tasks/create') @HttpCode(200) @Header('Cache-Control', 'no-store')
  createTask(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'createTask', value); }

  @Post(AI_AUTOMATION_EVENT_TASK_HTTP_DRAFT.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  createEventTask(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'createEventTask', value); }

  @Post('tasks/read-creation') @HttpCode(200) @Header('Cache-Control', 'no-store')
  readCreation(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'readCreation', value); }

  @Post(AI_AUTOMATION_REVIEW_QUEUE_HTTP_DRAFT.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readQueue(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'readQueue', value); }

  @Post('reviews/read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'read', value); }

  @Post('reviews/for-event') @HttpCode(200) @Header('Cache-Control', 'no-store')
  forEvent(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'forEvent', value); }

  @Post('reviews/close') @HttpCode(200) @Header('Cache-Control', 'no-store')
  close(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'close', value); }

  @Post('reviews/feedback') @HttpCode(200) @Header('Cache-Control', 'no-store')
  feedback(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'feedback', value); }

  @Post('reviews/operation') @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'operation', value); }

  @Post(AI_AUTOMATION_REVIEW_GRANT_HTTP_DRAFT.operations.prepareGrant) @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepareGrant(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'prepareGrant', value); }

  @Post(AI_AUTOMATION_REVIEW_GRANT_HTTP_DRAFT.operations.enableGrant) @HttpCode(200) @Header('Cache-Control', 'no-store')
  enableGrant(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'enableGrant', value); }

  @Post(AI_AUTOMATION_REVIEW_GRANT_HTTP_DRAFT.operations.readGrant) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readGrant(@Req() request: HumanAutomationHttpRequest, @Body() value: unknown) { return this.call(request, 'readGrant', value); }
}

@Controller('ai-native/automation/operator')
export class OperatorAutomationController extends HumanAutomationController {
  protected readonly audience = 'operator' as const;
  constructor(@Inject(HumanAutomationRequestFactory) requests: HumanAutomationRequestFactory) { super(requests); }
}

@Controller('ai-native/automation/staff')
export class StaffAutomationController extends HumanAutomationController {
  protected readonly audience = 'staff' as const;
  constructor(@Inject(HumanAutomationRequestFactory) requests: HumanAutomationRequestFactory) { super(requests); }
}

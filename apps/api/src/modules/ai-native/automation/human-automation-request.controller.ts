import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_AUTOMATION_REVIEW_QUEUE_HTTP_DRAFT } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { BusinessFailureError } from '../business-events/prisma-business-failure-outbox';
import { AutomationError } from './prisma-automation.authority';
import { HumanAutomationReviewError } from './human-automation-review.service';
import { HumanAutomationRequestFactory, type HumanAutomationHttpRequest, type HumanAutomationRequestAction } from './human-automation-request.composition';

abstract class HumanAutomationController {
  protected abstract readonly audience: 'operator' | 'staff';
  constructor(protected readonly requests: HumanAutomationRequestFactory) {}

  private async call(request: HumanAutomationHttpRequest, action: HumanAutomationRequestAction, value: unknown) {
    try { return await this.requests.call(request, this.audience, action, value); }
    catch (error) {
      const reason = error instanceof AutomationError || error instanceof HumanAutomationReviewError || error instanceof BusinessFailureError
        ? error.code : error instanceof AiTaskRepositoryError && error.code === 'AI_INVALID_INPUT' ? 'invalid_input' : 'unavailable';
      const code = reason === 'invalid_input' ? 'AI_INVALID_INPUT' : reason === 'conflict' ? 'AI_REVISION_CONFLICT'
        : reason === 'limit_reached' ? 'AI_LIMIT_REACHED' : reason === 'result_unknown' ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE';
      // Even a failed batch may already have prepared some original candidates.
      // Never turn this into an empty success, a retry instruction or an approval.
      throw new HttpException({ code, retryable: false, executionPermission: false, businessActionRequested: false,
        nextAction: action === 'readQueue' ? 'read_review_queue'
          : action === 'close' || action === 'feedback' || action === 'operation' ? 'read_original_operation'
          : action === 'createTask' || action === 'readCreation' ? 'read_original_creation' : 'read_original_event' },
      reason === 'invalid_input' ? 400 : reason === 'conflict' ? 409 : reason === 'limit_reached' ? 429 : 503);
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

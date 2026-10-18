import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AutomationManagementError } from './automation-management.validation';
import { HumanAutomationPolicyRequestFactory, type HumanAutomationPolicyHttpRequest,
  type HumanAutomationPolicyRequestAction } from './human-automation-policy-request.composition';
import { withRequestAbort } from '../scenes/request-abort';

@Controller('ai-native/automation/operator/policies')
export class HumanAutomationPolicyRequestController {
  constructor(@Inject(HumanAutomationPolicyRequestFactory) private readonly requests: HumanAutomationPolicyRequestFactory) {}

  private async call(request: HumanAutomationPolicyHttpRequest, action: HumanAutomationPolicyRequestAction, value: unknown) {
    try { return await withRequestAbort(request, signal => this.requests.call(request, action, value, signal)); }
    catch (error) {
      const reason = error instanceof AutomationManagementError ? error.code
        : error instanceof AiTaskRepositoryError && error.code === 'AI_INVALID_INPUT' ? 'invalid_input'
          : error instanceof Error && 'code' in error && error.code === 'AI_RESULT_UNKNOWN' ? 'result_unknown' : 'unavailable';
      const code = reason === 'invalid_input' ? 'AI_INVALID_INPUT' : reason === 'conflict' ? 'AI_REVISION_CONFLICT'
        : reason === 'result_unknown' ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE';
      throw new HttpException({ code, retryable: false, executionPermission: false, businessActionRequested: false,
        nextAction: action === 'commit' || action === 'operation' ? 'read_original_operation'
          : action === 'read' || action === 'preview' ? 'preview_current_configuration' : 'read_original_preparation' },
      reason === 'invalid_input' ? 400 : reason === 'conflict' || reason === 'result_unknown' ? 409 : 503);
    }
  }

  @Post('read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: HumanAutomationPolicyHttpRequest, @Body() value: unknown) { return this.call(request, 'read', value); }

  @Post('preview') @HttpCode(200) @Header('Cache-Control', 'no-store')
  preview(@Req() request: HumanAutomationPolicyHttpRequest, @Body() value: unknown) { return this.call(request, 'preview', value); }

  @Post('prepare') @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepare(@Req() request: HumanAutomationPolicyHttpRequest, @Body() value: unknown) { return this.call(request, 'prepare', value); }

  @Post('preparation') @HttpCode(200) @Header('Cache-Control', 'no-store')
  preparation(@Req() request: HumanAutomationPolicyHttpRequest, @Body() value: unknown) { return this.call(request, 'preparation', value); }

  @Post('review') @HttpCode(200) @Header('Cache-Control', 'no-store')
  review(@Req() request: HumanAutomationPolicyHttpRequest, @Body() value: unknown) { return this.call(request, 'review', value); }

  @Post('operation') @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: HumanAutomationPolicyHttpRequest, @Body() value: unknown) { return this.call(request, 'operation', value); }

  @Post('commit') @HttpCode(200) @Header('Cache-Control', 'no-store')
  commit(@Req() request: HumanAutomationPolicyHttpRequest, @Body() value: unknown) { return this.call(request, 'commit', value); }
}

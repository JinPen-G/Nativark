/** Human policy transport over the original staff/inspection-bound authority.
 * Server templates define operations and rights; body fields cannot grant them. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AI_STAFF_INSPECTION_TASK_POLICY_HTTP_DRAFT as routes } from '@rental-os/shared';
import { AI_STAFF_INSPECTION_TASK_POLICIES, type composeStaffInspectionTaskPolicies } from '../staff-inspection-task-policy.composition';
import { respondInspectionHttp, withInspectionRequestSignal, type InspectionHttpRequest } from './inspection-http';
import { inspectionPolicyRequest, inspectionPolicyResponse } from './inspection-task-http.contract';

@Controller(routes.basePath)
export class StaffInspectionTaskPolicyController {
  constructor(@Inject(AI_STAFF_INSPECTION_TASK_POLICIES) private readonly policies: ReturnType<typeof composeStaffInspectionTaskPolicies>) {}
  private respond(request: InspectionHttpRequest, operation: 'read' | 'configure' | 'clear', value: unknown) {
    const current = { headers: { authorization: request?.headers?.authorization } };
    return respondInspectionHttp(async () => {
      const command = inspectionPolicyRequest(operation, value);
      return withInspectionRequestSignal(request, async signal => inspectionPolicyResponse(operation,
        await this.policies[operation](current, structuredClone(command), signal), command), 15000);
    }, 'read_original_action_policy');
  }
  @Post(routes.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: InspectionHttpRequest, @Body() value: unknown) { return this.respond(request, 'read', value); }
  @Post(routes.configure) @HttpCode(200) @Header('Cache-Control', 'no-store')
  configure(@Req() request: InspectionHttpRequest, @Body() value: unknown) { return this.respond(request, 'configure', value); }
  @Post(routes.clear) @HttpCode(200) @Header('Cache-Control', 'no-store')
  clear(@Req() request: InspectionHttpRequest, @Body() value: unknown) { return this.respond(request, 'clear', value); }
}

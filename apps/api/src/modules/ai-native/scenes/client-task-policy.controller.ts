/** Standard operator transport for the original customer policy/CAS producer.
 * No policy seed, client-selected scope/scene/tool, model call or second ledger. */
import { randomUUID } from 'node:crypto';
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AI_CLIENT_TASK_POLICY_HTTP_DRAFT as routes } from '@rental-os/shared';
import { clientPolicyRequest, clientPolicyResponse } from './client-policy-http.contract';
import type { createClientTaskPolicyManagementApplication } from './client-task-policy-management.service';
import { respondInspectionHttp, withInspectionRequestSignal, type InspectionHttpRequest } from '../inspection-assist/inspection-http';

export const AI_NATIVE_CLIENT_TASK_POLICIES = Symbol('AI_NATIVE_CLIENT_TASK_POLICIES');
export const AI_NATIVE_CLIENT_POLICY_CONFIGURATION = Symbol('AI_NATIVE_CLIENT_POLICY_CONFIGURATION');
type Application = ReturnType<typeof createClientTaskPolicyManagementApplication>;
@Controller(routes.basePath)
export class ClientTaskPolicyController {
  constructor(@Inject(AI_NATIVE_CLIENT_TASK_POLICIES) private readonly application: Application) {}
  private respond(request: InspectionHttpRequest, method: keyof Application, body: unknown) {
    const current = { authorization: request?.headers?.authorization, requestId: randomUUID(), audience: 'operator' as const };
    return respondInspectionHttp(() => {
      const command = clientPolicyRequest(method, body);
      return withInspectionRequestSignal(request, async signal => {
        const result = method === 'readModelPlan' ? await this.application.readModelPlan(current, signal)
          : await this.application[method](current, structuredClone(command), signal);
        return clientPolicyResponse(method, result, command);
      }, 15000);
    }, method === 'changeModelPlan' ? 'read_original_model_plan' : 'read_original_policy_operation');
  }
  @Post(routes.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: InspectionHttpRequest, @Body() value: unknown) { return this.respond(request, 'read', value); }
  @Post(routes.change) @HttpCode(200) @Header('Cache-Control', 'no-store')
  change(@Req() request: InspectionHttpRequest, @Body() value: unknown) { return this.respond(request, 'change', value); }
  @Post(routes.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: InspectionHttpRequest, @Body() value: unknown) { return this.respond(request, 'operation', value); }
  @Post(routes.readModelPlan) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readModelPlan(@Req() request: InspectionHttpRequest, @Body() value: unknown) { return this.respond(request, 'readModelPlan', value); }
  @Post(routes.changeModelPlan) @HttpCode(200) @Header('Cache-Control', 'no-store')
  changeModelPlan(@Req() request: InspectionHttpRequest, @Body() value: unknown) { return this.respond(request, 'changeModelPlan', value); }
}

/** Closed original-input transport. The application owns current human access,
 * explicit first execution and original-result recovery; no body-selected
 * subject, policy, task, run, provider or arbitrary tool is accepted. */
import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_AUTOMATION_EXPLANATION_HTTP, AI_AUTOMATION_EXPLANATION_CONTRACTS,
  AI_AUTOMATION_EXPLANATION_SCHEMAS, AI_EVENTS_DRAFT_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS } from '@rental-os/shared';
import type { HumanAutomationHttpRequest } from './human-automation-request.composition';
import { AutomationExplanationApplication } from './automation-explanation.application';
import { withRequestAbort } from '../scenes/request-abort';

const definitions = JSON.parse(JSON.stringify({ ...AI_AUTOMATION_EXPLANATION_SCHEMAS,
  ...AI_EVENTS_DRAFT_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS }).replaceAll('#/components/schemas/', '#/$defs/'));
const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
const validators = Object.fromEntries(Object.keys(AI_AUTOMATION_EXPLANATION_SCHEMAS)
  .map(name => [name, ajv.compile({ $ref: `#/$defs/${name}`, $defs: definitions })]));

@Controller(AI_AUTOMATION_EXPLANATION_HTTP.basePath)
export class AutomationExplanationController {
  constructor(@Inject(AutomationExplanationApplication) private readonly application: AutomationExplanationApplication) {}
  private async call(request: HumanAutomationHttpRequest & { body?: unknown }, action: keyof typeof AI_AUTOMATION_EXPLANATION_CONTRACTS) {
    let entered = false;
    try {
      const contract = AI_AUTOMATION_EXPLANATION_CONTRACTS[action], command = structuredClone(request.body);
      if (!validators[contract.request](command) || Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8') > 65536) {
        throw new HttpException({ code: 'AI_INVALID_INPUT', retryable: false }, 400);
      }
      const result = await withRequestAbort(request, signal => {
        entered = true;
        return this.application.call(request, action, command, signal);
      });
      const copy = structuredClone(result);
      if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > 262144 || !validators[contract.response](copy)) throw Error('invalid response');
      return copy;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const unknown = entered && action === 'start';
      throw new HttpException({ code: unknown ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE',
        retryable: false, executionPermission: false, businessActionRequested: false,
        nextAction: 'read_original_automation_explanation' }, unknown ? 409 : 503);
    }
  }
  @Post(AI_AUTOMATION_EXPLANATION_HTTP.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: HumanAutomationHttpRequest & { body?: unknown }, @Body() _value: unknown) { return this.call(request, 'read'); }
  @Post(AI_AUTOMATION_EXPLANATION_HTTP.prepare) @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepare(@Req() request: HumanAutomationHttpRequest & { body?: unknown }, @Body() _value: unknown) { return this.call(request, 'prepare'); }
  @Post(AI_AUTOMATION_EXPLANATION_HTTP.start) @HttpCode(200) @Header('Cache-Control', 'no-store')
  start(@Req() request: HumanAutomationHttpRequest & { body?: unknown }, @Body() _value: unknown) { return this.call(request, 'start'); }
}

/** Original diagnosis to explicitly reviewed AI proposal metadata. The
 * application revalidates current authority and original receipts; these
 * routes do not save or publish business configuration. */
import { Body, Controller, Header, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT } from '@rental-os/shared';
import type { IncomingMessage } from 'node:http';
import { TaskOpeningProposalApplication } from './task-opening-proposal.application';
import { respondAiScene } from './scenes/original-scenes.controller';
import { withRequestAbort } from './scenes/request-abort';

@Controller(AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT.basePath)
export class TaskOpeningProposalController {
  constructor(@Inject(TaskOpeningProposalApplication) private readonly application: TaskOpeningProposalApplication) {}
  private call(request: IncomingMessage & { body?: unknown }, action: 'list' | 'preview' | 'prepare' | 'operation') {
    return respondAiScene(() => withRequestAbort(request, signal => this.application.call(request, action, request.body, signal)),
      'read_original_opening_proposal');
  }
  @Post(AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT.list) @HttpCode(200) @Header('Cache-Control', 'no-store')
  list(@Req() request: IncomingMessage & { body?: unknown }, @Body() _value: unknown) { return this.call(request, 'list'); }
  @Post(AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT.preview) @HttpCode(200) @Header('Cache-Control', 'no-store')
  preview(@Req() request: IncomingMessage & { body?: unknown }, @Body() _value: unknown) { return this.call(request, 'preview'); }
  @Post(AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT.prepare) @HttpCode(200) @Header('Cache-Control', 'no-store')
  prepare(@Req() request: IncomingMessage & { body?: unknown }, @Body() _value: unknown) { return this.call(request, 'prepare'); }
  @Post(AI_TASK_OPENING_PROPOSAL_HTTP_DRAFT.operation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  operation(@Req() request: IncomingMessage & { body?: unknown }, @Body() _value: unknown) { return this.call(request, 'operation'); }
}

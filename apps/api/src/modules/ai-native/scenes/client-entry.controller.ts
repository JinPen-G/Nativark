import { Body, Controller, Header, HttpCode, HttpException, Inject, Post, Req } from '@nestjs/common';
import { AI_CLIENT_ENTRY_HTTP_DRAFT } from '@rental-os/shared';
import { z } from 'zod';
import { AiClientEntryError } from './client-entry-action';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiClientApplicationRequest, composeRequestBoundClientApplication } from './client-request.application';

export const AI_CLIENT_ENTRY_APPLICATION = Symbol('AI_CLIENT_ENTRY_APPLICATION');
type Application = Pick<ReturnType<typeof composeRequestBoundClientApplication>,
  'readHostCapabilities' | 'issueAction' | 'createBookingDraft' | 'chooseBookingDraft' | 'readBookingDraft' |
  'handoffBookingDraft' | 'readBookingHandoff' | 'readBookingOperation' |
  'acceptBookingSubmission' | 'submitAcceptedBooking' | 'readBookingSubmission' | 'readTaskSnapshot' | 'readTaskEvents' |
  'readOrderExplanation' | 'readSource'>;

@Controller([AI_CLIENT_ENTRY_HTTP_DRAFT.basePath, AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath])
export class AiClientEntryController {
  constructor(@Inject(AI_CLIENT_ENTRY_APPLICATION) private readonly application: Application) {}

  private async respond<T>(work: () => Promise<T>, unknownAction = 'read_booking_operation'): Promise<T> {
    try { return await work(); }
    catch (error) {
      const aliases: Record<string, string> = {
        AI_CLIENT_INVALID_INPUT: 'AI_INVALID_INPUT', AI_CLIENT_CONTEXT_UNAVAILABLE: 'AI_ACCESS_DENIED',
        AI_CLIENT_CAPABILITY_UNAVAILABLE: 'AI_RESOURCE_UNAVAILABLE', AI_CLIENT_MATERIAL_STALE: 'AI_PROPOSAL_STALE',
        AI_CLIENT_REVISION_CONFLICT: 'AI_REVISION_CONFLICT', AI_CLIENT_RESULT_UNKNOWN: 'AI_RESULT_UNKNOWN'
      };
      const statuses: Record<string, number> = { AI_INVALID_INPUT: 400, AI_ACCESS_DENIED: 403,
        AI_RESOURCE_UNAVAILABLE: 503, AI_PROPOSAL_STALE: 409, AI_REVISION_CONFLICT: 409, AI_RESULT_UNKNOWN: 409 };
      let code = 'AI_RESOURCE_UNAVAILABLE';
      if (error instanceof z.ZodError) code = 'AI_INVALID_INPUT';
      else if (error instanceof AiClientEntryError) code = error.code;
      else if (error instanceof AiTaskRepositoryError) code = error.code === 'AI_STORAGE_UNAVAILABLE' ? 'AI_RESOURCE_UNAVAILABLE' : error.code;
      else if (error instanceof Error && aliases[error.message]) code = aliases[error.message];
      else if (error instanceof HttpException) {
        if (error.getStatus() === 400) code = 'AI_INVALID_INPUT';
        else if ([401, 403, 404].includes(error.getStatus())) code = 'AI_ACCESS_DENIED';
        else if (error.getStatus() === 409) code = 'AI_REVISION_CONFLICT';
      }
      if (!Object.prototype.hasOwnProperty.call(statuses, code)) code = 'AI_RESOURCE_UNAVAILABLE';
      throw new HttpException({ code, retryable: false,
        ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: unknownAction } : {}) }, statuses[code]);
    }
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskSnapshot) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskSnapshot(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readTaskSnapshot(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskEvents) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readTaskEvents(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readTaskEvents(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderExplanation) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readOrderExplanation(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readOrderExplanation(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readSource) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readSource(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readSource(request, body));
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readHostCapabilities)
  readHostCapabilities(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readHostCapabilities(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.issueAction)
  issueAction(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.issueAction(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.createBookingDraft)
  createBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.createBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.chooseBookingDraft)
  chooseBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.chooseBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingDraft)
  readBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.handoffBookingDraft)
  handoffBookingDraft(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.handoffBookingDraft(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingHandoff)
  readBookingHandoff(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingHandoff(request, body));
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingOperation)
  readBookingOperation(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingOperation(request, body));
  }

  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.acceptBookingSubmission)
  acceptBookingSubmission(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    // Same handoff re-read can recover an acceptance; it does not submit an order.
    return this.respond(() => this.application.acceptBookingSubmission(request, body), 'accept_booking_submission');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.submitAcceptedBooking)
  submitAcceptedBooking(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.submitAcceptedBooking(request, body), 'read_booking_submission');
  }
  @Post(AI_CLIENT_ENTRY_HTTP_DRAFT.readBookingSubmission)
  readBookingSubmission(@Req() request: AiClientApplicationRequest, @Body() body: unknown) {
    return this.respond(() => this.application.readBookingSubmission(request, body), 'read_booking_submission');
  }
}

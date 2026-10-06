/** Safe public outcome after a callback may have committed. No underlying cause is exposed. */
export class AiApprovedOrderResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly nextAction = 'reconcile';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

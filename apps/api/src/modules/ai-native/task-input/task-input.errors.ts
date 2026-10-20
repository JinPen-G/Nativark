/** The write callback finished but the transaction acknowledgement did not.
 * Read the original request/receipt under current authorization; this is not
 * permission to resubmit a different answer or execute a business effect.
 */
export class AiTaskInputResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly nextAction = 'reconcile';
  readonly retryable = false;
  constructor() { super('AI_RESULT_UNKNOWN'); }
}

/** A trusted source cannot ask another question within the original task's
 * ceiling. This is not a timeout and does not attest a persisted transition. */
export class AiTaskInputLimitError extends Error {
  readonly code = 'AI_RUN_LIMIT';
  readonly retryable = false;
  constructor() { super('AI_RUN_LIMIT'); }
}

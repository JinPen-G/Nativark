/** A deliberate continuation may wait for the server's bounded 120s execution.
 * Read/receipt calls retain the normal short timeout. Unknown outcomes never trigger a retry. */
export const AI_EXECUTION_RESPONSE_TIMEOUT_MS = 135_000;
/** Explicit approval may first renew its short original action policies;
 * allow the server's bounded 20s decision interval to return its receipt. */
export const AI_APPROVAL_RESPONSE_TIMEOUT_MS = 25_000;

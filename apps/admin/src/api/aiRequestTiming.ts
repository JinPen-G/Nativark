/** A deliberate continuation may wait for the server's bounded 120s execution.
 * Read/receipt calls retain the normal short timeout. Unknown outcomes never trigger a retry. */
export const AI_EXECUTION_RESPONSE_TIMEOUT_MS = 135_000;

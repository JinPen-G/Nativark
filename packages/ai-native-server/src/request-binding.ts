/** Bind a verified server request by object identity and content. This is a
 * lifetime check, not authentication, scope expansion or a transaction grant. */
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';

export function captureAiRequestBinding(denied: () => Error) {
  const identity = getRequestIdentity();
  if (!identity) throw denied();
  const fingerprint = requestFingerprint(identity);
  let active = true;
  return Object.freeze({ identity, assertCurrent() {
    if (!active || getRequestIdentity() !== identity || requestFingerprint(identity) !== fingerprint) throw denied();
  }, close() { active = false; } });
}

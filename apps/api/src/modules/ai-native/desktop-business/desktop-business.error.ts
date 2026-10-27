/** Public local-business failures; unknown is an observation, not permission to repeat a write. */
import type { RentalDesktopBusinessFailureCode } from '@rental-os/shared';

export class DesktopBusinessError extends Error {
  constructor(readonly code: RentalDesktopBusinessFailureCode) {
    super(code);
    this.name = 'DesktopBusinessError';
  }
}

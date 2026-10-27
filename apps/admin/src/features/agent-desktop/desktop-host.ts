/** The owned Electron preload is the only desktop marker. URL parameters and cached identities cannot enable it. */
import { RENTAL_DESKTOP_PROTOCOL_VERSION, type RentalAdminDesktopBridge } from "@rental-os/shared";

declare global { interface Window { rentalDesktopAdmin?: RentalAdminDesktopBridge } }

export function rentalDesktopHost(): RentalAdminDesktopBridge | undefined {
  const bridge = window.rentalDesktopAdmin;
  return bridge?.protocolVersion === RENTAL_DESKTOP_PROTOCOL_VERSION
    && typeof bridge.report === "function" && typeof bridge.onCommand === "function" && typeof bridge.complete === "function"
    ? bridge : undefined;
}

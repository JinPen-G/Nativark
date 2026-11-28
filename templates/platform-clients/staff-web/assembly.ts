import { createRentalWebAssembly } from "@rental-os/client-template-rental/browser";
import { connection } from "./connection";
export function assembleStaff() { return createRentalWebAssembly("staff-web", connection, window); }

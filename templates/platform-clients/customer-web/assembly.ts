import { createRentalWebAssembly } from "@rental-os/client-template-rental/browser";
import { connection } from "./connection";
/** 首个 Core 的正式接线；更换 Core 时只替换本装配模块。 */
export function assembleCustomer() { return createRentalWebAssembly("customer-web", connection, window); }

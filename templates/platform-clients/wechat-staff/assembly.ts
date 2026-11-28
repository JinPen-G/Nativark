import { createRentalWechatAssembly } from "@rental-os/client-template-rental/wechat";
import { connection } from "./connection";
export function assembleStaff() { return createRentalWechatAssembly("wechat-staff", connection, wx); }

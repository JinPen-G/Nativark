import { createRentalWechatAssembly } from "@rental-os/client-template-rental/wechat";
import { connection } from "./connection";
export function assembleCustomer() { return createRentalWechatAssembly("wechat-customer", connection, wx); }

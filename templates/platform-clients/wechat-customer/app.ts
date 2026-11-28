import { createWechatClientApp } from "@rental-os/platform-client-wechat";
import { assembleCustomer } from "./assembly";
App(createWechatClientApp("wechat-customer", assembleCustomer));

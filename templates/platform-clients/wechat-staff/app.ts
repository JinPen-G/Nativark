import { createWechatClientApp } from "@rental-os/platform-client-wechat";
import { assembleStaff } from "./assembly";
App(createWechatClientApp("wechat-staff", assembleStaff));

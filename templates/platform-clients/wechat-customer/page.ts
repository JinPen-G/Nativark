import { createWechatClientPage, type WechatClientApp } from "@rental-os/platform-client-wechat";
Page(createWechatClientPage(() => getApp<WechatClientApp>()));

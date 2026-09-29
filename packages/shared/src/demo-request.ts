/** 平台官网演示预约：平台级线索，不属于任何租户或经营空间。 */
export type DemoContactType = "phone" | "email" | "wechat";

export interface CreateDemoRequestInput {
  requestKey: string;
  name: string;
  contactType: DemoContactType;
  contactValue: string;
  company?: string;
  message?: string;
  language: "zh" | "en";
}

export interface DemoRequestReceipt {
  received: true;
}

export interface DemoRequestRow {
  id: string;
  name: string;
  contactType: DemoContactType;
  contactValue: string;
  company: string;
  message: string;
  language: "zh" | "en";
  createdAt: string;
}

export interface DemoRequestListQuery {
  page: number;
  pageSize: number;
}

export interface DemoRequestPage {
  items: DemoRequestRow[];
  total: number;
  page: number;
  pageSize: number;
}

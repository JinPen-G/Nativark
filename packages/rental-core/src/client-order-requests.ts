/** 原客户报价服务项与续租请求的业务合同；字段不授予客户身份、费用批准或履约权限。 */
export interface ClientQuoteServiceRequest {
  serviceId: string;
  quantity: number;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  serviceLocationId?: string;
}

export interface ClientOrderExtensionRequest {
  newEndAt: string;
  services?: ClientQuoteServiceRequest[];
  memo?: string;
}

/** 公共消息页面、受控业务范围插槽与宿主请求工厂。 */
export { AcceptOperatorInvitationPage, type AcceptOperatorInvitationPageProps } from "./AcceptOperatorInvitationPage";
export { OperatorInvitations, type OperatorInvitationsProps, type InvitationBusinessAccessProps } from "./OperatorInvitations";
export { TenantDispatchPage, type TenantMessagingPageProps } from "./TenantDispatchPage";
export { DispatchDetail, DispatchStatus, DISPATCH_STATUS_LABELS } from "./DispatchDetail";
export { CustomerSupportPage } from "./CustomerSupportPage";
export { createTenantMessagingApi, useTenantMessagingApi, createTenantSupportApi, useTenantSupportApi,
  createOperatorInvitationApi, type OperatorInvitationApi, type MessagingRequest, type MessagingRequestOptions } from "./client";
export { messagingMessages } from "./messages";
export { hasTenantMessagingPermission } from "./messagingAccess";

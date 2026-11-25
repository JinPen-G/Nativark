/** Rental 为原公共订阅和寄件页面提供领域文案；身份、数据与动作仍由公共宿主裁定。 */
export const rentalPublicPageContent = {
  subscription: { description: "所有经营空间共用同一订阅。" },
  subscriptionPro: { standardDescription: "基础租赁经营" },
  dispatch: {
    description: "查看当前租户各经营空间的短信、邮件和运营邀请发送记录。",
    businessScopeLabel: "经营空间",
  },
  operatorInvitation: { invitationTitle: "接受运营邀请", businessScopeLabel: "经营空间" },
} as const;

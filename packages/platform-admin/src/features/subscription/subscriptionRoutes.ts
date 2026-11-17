/** 原订阅页面路径保持稳定，公共和Rental宿主复用同一导航声明。 */
export const SUBSCRIPTION_ROUTES = {
  subscription: { path: "/settings/subscription" },
  subscriptionPro: { path: "/settings/subscription/pro" },
  subscriptionRequestDetail: { path: "/settings/subscription/requests/:id" },
  platformSubscriptions: { path: "/platform/subscriptions" },
  platformSubscriptionDetail: { path: "/platform/subscriptions/:id" },
  subscriptionCatalog: { path: "/platform/subscription-catalog" }
} as const;

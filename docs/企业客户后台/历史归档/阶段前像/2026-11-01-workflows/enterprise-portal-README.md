# Enterprise portal

独立企业客户Web，不是商户营运后台。当前只实现个人客户登录衔接、企业选择和受权成员读取；申请、邀请、审批、订单和财务尚未接通，不提供模拟记录。

正式范围和阶段状态见[企业四册入口](../../docs/企业客户后台/企业客户后台-协作接续.md)。视觉和交互沿[管理后台规范](../../docs/公共技术资料/界面规范/管理后台-界面规范.md)及[UI适配规则](../admin/AGENTS.md)，保留原React/UIArc、主题、语言与原生侧栏；不修改vendor。

## 模块边界

- [main](src/main.tsx) / [App](src/App.tsx) → [企业会话宿主](src/enterprise-session.tsx) → [共用客户transport](../../packages/web-client/src/session.ts) → 原客户Auth/Guard及[企业访问服务](../api/src/modules/client/enterprise-access.service.ts)。本地会话和URL只定位请求，服务端当前关系及动作grant决定权限。
- [Shell](src/EnterpriseShell.tsx) / [成员页](src/App.tsx) → [窄UI出口](../admin/src/components/ui/customer-entry.ts) / [UI宿主scope](../admin/src/components/ui/BusinessUiScope.tsx)。营运认证、Copilot及营运路由不能进入企业bundle；[Vite边界](vite.config.ts)在构建时拒绝这些导入。
- 商户授权经[原企业详情](../admin/src/features/membership/CorporateMembershipPage.tsx) → [配置面板](../admin/src/features/membership/EnterprisePortalConfiguration.tsx) → [门户配置服务](../api/src/modules/platform/enterprise-portal.service.ts)。默认关闭；旧admin关系不自动开放。
- 验证入口：[权限/原操作测试](../../tests/enterprise-portal-access.test.cjs)、[跨realm会话测试](../../tests/web-client-session.test.cjs)、本应用`tsconfig.json`。替身行为和离线构建不等于真实数据库、域名代理或正式验收。

## 同源分发约束

公共站点文档路径为`/:tenantCode/enterprise`，登记商户域为`/enterprise`；当前仅root和`members`子路由。`tenantCode`是商户编码，客户登录后再选择其下可管理企业；query不能覆盖商户。绑定域由原`site-resolve`复验，公共host由`VITE_ENTERPRISE_PUBLIC_HOSTS`登记。

静态资产固定`/enterprise-assets/`，不与文档路径混用。正式部署须先将上述已登记企业路径回源到企业`index.html`，然后才允许租户网站的通用SPA回退；不能将`/demo/enterprise`当企业ID或由网站wildcard接管。API保持本站`/api/client/v1`，两应用共用客户storage和同一Web Lock，跨origin凭据运输不在本片范围。

Vite配置`envDir:false`，不读取真实`.env`且无API代理；已批准offline模式只显示未连接限制，不请求业务后端。生产构建并不自动授权启服务、迁移或部署，所需环境值和回源配置须另在获准环境核验。

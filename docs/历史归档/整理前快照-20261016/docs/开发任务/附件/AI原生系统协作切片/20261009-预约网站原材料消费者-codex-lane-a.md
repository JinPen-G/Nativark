# AIN-22 预约网站原材料消费者（2026-10-09）

施工树 codex-ai-native-lane-a，分支 ai/codex-ai-native-lane-a-20261007；固定依赖 f5290e1cb18b042cd5c9df6fb344dd8a18ea6788。本片仅修改原 BookingPage、RemoteBooking、本页 feature-local 宿主、原网站测试及本记录。未修改 App、路由、生产开关、API、shared 或其他施工树。既有 output、锁及备份未清理或提交。

## 已接通

- 原 BookingPage 消费显式 BookingHandoffHostProvider；默认 provider 为 null，不从 URL/storage 取得能力或引用，不自动读取材料。
- 页面需要当前真实租户、登录客户、空间与显式宿主能力匹配。它们仅用于本地隔离，不替代服务器授权。注入的 readBookingHandoff 必须绑定真实请求并在服务器执行原 Guard/归属/版本校验。
- 人工读取显示原 handoffRef、revision、quoteId、有效期、时区和原时间；人工继续再次读取并比对原材料。变化、过期、读取失败、缺能力均不继续。
- 当前原表单仅映射单商品、个人身份、同地点取还或配送。多商品、企业身份、服务行、异地归还等无法映射时 unavailable，不自动删减或降级。
- 继续后按原时区填入日期、数量、履约方式，原材料保持只读。地点/配送地址保留原引用，不自动改为默认地址。修改需求需重新准备。
- RemoteBooking 的 handoff 分支不挂载原自动 createQuote/createOrder 生命周期。仅展示引用及“未提交/未预占”，金额未提供即明确不可用，不从商品现价重算。
- host、登录会话、租户、空间、客户、商品切换产生独立消费实例；首次渲染不展示前实例内容。单请求在途、实例销毁与迟到回调隔离。React StrictMode effect 重挂载保持同样的零自动读取原则。
- 没有注入 enabled host 时，原人工预约/演示路径保持原行为。所谓“零读取”指新增 AI 材料读取，不宣称原业务页面零业务请求。

## 最小宿主接入

未来正式入口在现有 SiteProvider/AuthProvider 范围内包装原页面：

```tsx
<BookingHandoffHostProvider value={requestBoundHost}>
  <BookingPage />
</BookingHandoffHostProvider>
```

requestBoundHost 包含 enabled、服务端能力投影 capability（tenantCode/workspaceCode/customerId/tenantId/workspaceId/releaseRevision）、服务器发放的 handoffRef，以及 readBookingHandoff({ handoffRef }) Promise。这是 feature-local 依赖描述，不是新增公共 DTO/授权协议。不得从查询参数构造能力；host function 只在 React 私有 Context 中，不进入材料 JSON/storage。正式读端口复用已有客户场景 readBookingHandoff；本片不猜 HTTP 地址，也不自动绑定 transport。

## 实际验证与失败

环境 DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT 为施工树；AI_OFFLINE_AUDIT 为本树 output/website-handoff.audit 或 website-handoff-types.audit；TEMP/TMP 为本树 output/entry-booking-tmp。

1. `node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --test tests/tenant-website-resolve.test.cjs`：最终 pass=3/fail=0/skip=0/todo=0，退出码0。新增1项驱动真实消费控制器和时区格式化函数：默认禁用、人工复读、材料修订变化、跨空间、重复读取、销毁迟到、同步抛错、过期。原2项租户解析测试保留。没有新增一套测试产品逻辑。
2. 首次调用本树 `./node_modules/typescript/bin/tsc` 失败：MODULE_NOT_FOUND，退出码1，不伪报通过。随后使用已安装本地 TypeScript（require.resolve 从本树网站及根依赖只读解析），通过 TS API readConfigFile/parseJsonConfigFileContent/createProgram/getPreEmitDiagnostics 执行原网站 tsconfig/noEmit；42个入口，0诊断，退出码0。不安装、不写共享生成物。
3. `git diff --check`：退出码0（仅 LF/CRLF 提示）。

本片新增功能优先，没有前置失败行为测试，不能宣称红测→绿测；保留真实缺模块失败。新增测试为实际纯消费控制器行为，不是实际 DOM/page 点击验收。页面/组件分支和接入结构经过源码自查及类型检查，不将其算浏览器交互证据。

## 剩余依赖 / 未验

- 服务端发布网站入口能力及 request-bound host transport 尚未装配；无 host 默认关闭。
- 原订单提交尚无将 booking handoff 原引用/修订与实际受理操作收据关联的正式入口。当前按钮禁用；不能仅把 quoteId 送到旧 createOrder 就宣称已受理，不能自动标 submitted。
- AiBookingHandoff 不含金额/quote版本明细。该展示不补造金额；需要展示完整原报价时必须读取同一原材料的正式受权明细。
- 未运行 Vite build（可能读取环境文件）、浏览器/屏幕阅读器、真实 HTTP、DB、支付、模型、生产发布。未启用入口。不宣称 AIN-22 或专项完成。

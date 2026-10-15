# CA08 / AIN-21、22：客户原页面预约与订单事实接续

## 归属与状态

唯一写入树 codex-ai-native-lane-a，分支 ai/codex-ai-native-lane-a-20261007，HEAD a63954aa48edde098a54188cf78474467f810782。本片保留为未暂存 WIP，未提交；不覆盖继承的报价、shared、生成脚本及测试 WIP，不复制主线活动修改，不提交历史 output。前片 backend 证据见《20261012-客户预约准备能力接续-codex-lane-a.md》，其中 factory 未接通的描述是此前观察，本片更新如下，不抹除历史证据。

## 已接通的真实入口

- 两端 booking-host.factory.ts：在当前登录/可信发布上下文的显式 openFromUser 后，接回已有 acceptBookingSubmission、submitAcceptedBooking、readBookingSubmission 包装。回调在实例私有内存；操作 single-flight、前后政策与上下文复核。第一次原操作提交后保留 attempted，未知/丢响应不再提交，仅读原接受引用。预算/审批/服务器幂等不由客户端实现。
- 小程序 checkout/index.ts/wxml：attachPublishedBooking(publication,handoffRef) 为未来可信入口提供原页面连接位置；绑定 epoch 隔离隐藏/切换后的迟到 capability。缺 publication 默认关闭；不得用路由参数或 storage 自行启用。原 API/人工办理逻辑未替换。
- 两端 booking-handoff.ts 及网站 BookingHandoffPanel.tsx：未取得原接受引用时“核对原操作”不可用，reconcile 不自动 accept；销毁清私有接受材料。
- 小程序 order/index.ts/json/wxml 与 ai-order-explanation：原订单读取结果通过 customer-order-facts.ts 白名单投影，默认折叠、明确非 AI 回答。切身份/空间、hide 清旧摘要，卸载释放本页 session 订阅并隔离迟到读取。
- 网站 OrderPages.tsx 与 customer-order-facts.ts：消费原本人 ClientOrderView，不新增 AI/财务请求。当前身份/租户/空间/订单组成 owner 世代；首次新渲染不显示旧 owner 订单，旧读取不能回填。原页面支付处理未修改。
- 新事实投影只展示原应收、押金要求、预授权要求、来源 ID/更新时间/原状态码；真实零保留，缺失和非法金额显示未知。未读取付款/退款收据或历史依据就明确未加载，不推断已付款、已退款、已冻结，不计算价格。

## 本片文件

小程序：components/ai-native/{booking-host.factory.ts,booking-handoff.ts,customer-order-facts.ts,ai-order-explanation/index.ts,index.wxml}；pages/checkout/{index.ts,index.wxml}；pages/order/{index.ts,index.json,index.wxml}。

租户网站：features/ai-native/{booking-host.factory.ts,booking-handoff.ts,BookingHandoffPanel.tsx,customer-order-facts.ts}；pages/OrderPages.tsx。

测试复用 tests/miniprogram-static.test.cjs、tests/tenant-website-resolve.test.cjs，未新增测试脚本。mini loader 只补 extensionless .factory.ts 的现有本地文件解析，不放开目录/包约束；注册检查器增加真实 ai-order-explanation 名称和精确路径，不放宽规则。

## 实际验证

统一环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT 为本树绝对路径；TEMP/TMP 在本树 output；AI_OFFLINE_AUDIT 为 output/ca08-booking-host-20261012 下绝对文件。Node 均预加载 prisma-offline-preload.cjs 与 lane-b-local-runtime.cjs，不使用 TS_NODE_IGNORE_DIAGNOSTICS。

命令：`node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='原订单事实|原订单页面|AI原checkout交接|原预约交接' tests/miniprogram-static.test.cjs tests/tenant-website-resolve.test.cjs`。

结果：pass 5 / fail 0 / skip 0 / todo 0，退出 0。实际宿主 factory、consumer、原 checkout 方法/生命周期、小程序 order/render/session 清理、网站 OrderDetailPage hooks 与白名单函数均被执行；宿主与网络响应为显式离线替身。网站 A→B→A 首次渲染隔离及迟到结果被驱动，不是浏览器 DOM。

页面声明快检：同一 preload 环境，`node ... --test --test-name-pattern='^app.json|每个数据绑定|每个 WXML 事件' tests/miniprogram-static.test.cjs`，pass 3 / fail 0 / skip 0 / todo 0，退出 0；仅证明现有页面/组件声明、AST 字段和事件方法配对，不当作交互证据，不与上述行为项合称全量回归。

源码类型：用 TypeScript Compiler API 读取两端现有 tsconfig JSON，noEmit、incremental:false、rootDir/baseUrl 指向本树，shared 指向源码；小程序 typeRoots 从已安装 miniprogram-api-typings/package.json realpath 解析。TS 5.9.3：miniprogram 93 roots / 0 diagnostics；tenant-website 44 roots / 0 diagnostics；退出 0。不是普通 package build 或微信编译。git diff --check 退出 0。

早期无效快检保留：第一次 page loader 不识别 .factory 后缀而失败，修正本地 TS 路径解析后通过；第一次类型检查假定依赖安装在树内得到493个级联诊断，按现有依赖真实路径修正检查器后通过；未改源码类型门槛/依赖安装。不计为已确认产品红测。继承 API quote-preview 两项 TS2554 仍由主线处理，前端源码零诊断不能冒充 API 或整包通过。

## 剩余正式依赖

1. 真实可信 publication + handoffRef 页面入口生产者未交付，两端均不自行从 URL/storage 启用。bookingDrafts 观察不是业务提交许可，原接受/提交必须服务器独立复核。
2. 返回栈/重登录/新页面实例恢复原 acceptanceRef 的正式安全载体缺失；本片仅实例内存，不新增本地敏感缓存。无原引用时禁用核对，不查最新订单/换键创建。
3. 完整客户 orderExplanation/source-reopen 的正式 HTTP/共享契约未提供；本片非 AI 事实卡不等于模型解释。客户模型授权/调用/计量由主线接通，不能复用任务创建/读取政策冒充执行许可。
4. 未跑常规网站构建（可能读取 .env）、微信开发者工具、浏览器/屏幕阅读器、真机、真实 HTTP/MySQL/支付/模型、迁移或生产。离线作者证据不等于原 AIN 整项验收。

已把入口、文件归属、快检结果和上述缺口发送主线对话；主线继续客户快照/事件与执行授权，本线不重复实现。

# AIN-08 订单事实最小读取（2026-10-04）

## 基线与范围

主树 `.claude/worktrees/claude-ai-native-foundation`，分支 `ai/ai-native-contracts-s01-20261002`，基线3af3707。开工仅已知保全patch。Codex树只读核对到735f8d2，本片不合入在途配套、不重派任务、不直接消息。未改main、schema、迁移或公共需求。

## 实现

- 为订单路由上下文适配器新增服务端withOrderRead回调，在既有Guard认证后的同一ALS作用域执行读取；回调不是模型输入或通用工具。
- 新AiOrderReadFactsService调用RentalCoreService.getOrder。该入口与现有Controller.order使用的Core入口相同，本片没有另建订单查询算法。
- Core返回后严格投影白名单：订单ID/号/状态、查询及更新时间、开始/原结束/当前结束、币种和Core已有金额；不重算计价，不查询模型。
- 客户名、电话、备注、完整订单行、地址、附件、操作凭证及其他扩展字段不进入输出。缺金额为null，真实0保留，非法数值/状态/币种/跨tenant或错误orderId拒绝。
- 原endAt和effectiveEndAt分开；存量缺effectiveEndAt时明确endAt_fallback，不隐含新的续租事实。
- 来源引用明确为本次current读取，不伪造historical snapshot。支付和历史费用证据显式not_loaded，不推断已付/退款成功或已加载费率依据。
- 在返回投影前再次跑真实Guard/Auth，比较主体/范围/权限和地点；读取期间撤权、换空间或成员失效，缓冲数据不返回。

## 验证与未验边界

新增19项，与前片身份适配器组合37/37通过。测试实际构造AuthService、ApiAuthGuard、RentalCoreService，仅会话/配置/事实存储采用合成替身；断言Core读取时ALS身份正确、返回后父上下文不变及读后撤权拒绝。

完整回归结果在本片验证补记中列明；离线测试导入前加载preload，固定无效DATABASE_URL，不启服务、不连DB/真实模型/支付。未取得独立审查报告，不冒称独立Review。

本片是内部订单事实读取投影，不是已发布的C02完整输出或已启用工具。没有注册HTTP/AppModule/worker，工具成熟度仍不变。支付事实、历史规则/报价依据、后续动作与完整解释编排尚需接各自正式业务入口；客户/平台/automation身份不能借operator/staff适配器访问。

真实Prisma事实仓储的数据库隔离、微信宿主、真实HTTP端到端、真实模型解释质量均未验；底层存储替身不会证明真库scope隔离。下一步继续补订单解释所需的明确证据和受控工具契约，并推进Gateway/审批主线，不将这个只读投影视为AIN-08或AIN-13整项结项。

## 验证补记

全量AI1249/1249通过，0 fail/skip/todo；API和Admin类型检查通过。离线audit无外联或.env读取拦截记录，git diff --check通过。未改Core实现或既有Controller/Guard，只复用它们的读取/授权行为。

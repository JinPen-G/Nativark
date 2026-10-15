# AIN-09 候选参数准备及 lane A 本轮交接

基线7d1e2fd2；本片只新增 tools/quote-candidate-preparation.service.ts、实际行为测试及本记录。原固定 da6fb9ae 已快进，本树分支 ai/codex-ai-native-lane-a-20261007，没有写主线或其他树。

## 实际实现与边界

AiQuoteCandidatePreparationService 消费现有 AiCatalogReadFactsService、AiMembershipCandidateReadFactsService 及服务端 AiQuoteCoreContextSource。不增加模型调用、公共 DTO、HTTP路由或并行执行链；输入是模型可能提取出的有限词槽，严格 schema 拒绝额外身份、价格、时区字段。

商品精确名称在受权目录中唯一匹配才能形成候选引用；0项缺失、多项歧义。个人客户必须显式选择候选ID，同名不自动选，连唯一名字也不当人类选择。企业身份没有正式读取端口，返回 qualification_required，不把个人会员候选冒充企业资格。

履约与计价枚举消费原共享常量，且候选必须在服务器设置启用范围内；地点来自服务端当前上下文，缺失/重名需澄清。此上下文端口必须由主线绑定真实当前空间与已授权地点集合，不能直接注入调用者配置或另空间缓存。本片不提供生产上下文 adapter，未证明真实页面/路由接线。

日期支持显式带偏移的ISO，以及有限“今天/明天/后天 HH:mm”；相对日期基于可信服务器clock及业务时区，不依赖机器时区或模型声明。解析有界枚举现代四分之一小时偏移（±14小时），DST空洞/重叠、未知词语、无偏移时间拒绝，不猜一个时刻。不声称支持任意自然语言或所有历史时区。

设置读回复制隔离；设置等待后重新读取已有受权目录和客户候选，scope/audience/投影变化拒绝。此为顺序一致性检查，不是原子授权、全配置CAS或派发许可。输出只为 needs_confirmation，复用现有正式报价请求schema；没有调用 createQuote、锁库存、建单、支付、审批。宿主以后必须绑定不可变输入和配置修订，用户确认后经正式报价权限重新调用既有 Core bridge，不能凭这个状态推进业务。

## 本片验证

红测 node --test tests/ai-native-lane-a-quote-candidates.test.cjs：模块尚未实现，0 pass / 1 fail / 0 skip，退出1（加载失败，不计为9个行为红测）。

首轮同命令9 pass / 0 fail / 0 skip，退出0。实际 ApiAuthGuard → ALS → Core目录读取和 MembershipService → 现有投影 → 候选准备，仅配置/身份/数据库执行替身；不存在恒真权限adapter。包括同名不选、未知商品地点、身份/价格/时区额外字段、0/10001数量、非确定日期、企业依赖缺失、真实会员权限撤销、UTC/上海和纽约DST边界。

有界自查复制配置对象后，补当前空间变化与唯一姓名仍待选择两例。最终扩大命令：

```
node --test --test-concurrency=2 tests/ai-native-lane-a-membership.test.cjs tests/ai-native-lane-a-order-history.test.cjs tests/ai-native-lane-a-diagnostics.test.cjs tests/ai-native-lane-a-quote-boundaries.test.cjs tests/ai-native-lane-a-quote-candidates.test.cjs tests/ai-native-persisted-availability-runner.test.cjs tests/ai-native-ain09-quote-preview.test.cjs tests/ai-native-ain08-membership-candidate-read.test.cjs tests/ai-native-order-read-facts.test.cjs
```

实际106 pass / 0 fail / 0 skip / 0 todo，退出0；其中本片11例。API node -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit'];require('typescript/lib/tsc')" 退出0；git diff --check退出0。

全部Node带本树 tests/fixtures/ai-native/prisma-offline-preload.cjs，DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_AUDIT为本树绝对 output/lane-a-final-regression.audit / lane-a-final-types.audit；网络拦截测试保护在位。未读.env、未安装、未启服务、未执行真实数据库/模型/支付、未推送或合main；output没有提交。

## 本轮固定提交与文件归属

| 提交 | 生产源码 | 测试及记录 |
|---|---|---|
| e6c3c606 | membership-candidate-read-facts.service.ts | ai-native-lane-a-membership.test.cjs；AIN-08-客户候选脱敏与授权回归-20261007-codex-lane-a.md |
| 24891d6f | order-read-facts.service.ts | ai-native-lane-a-order-history.test.cjs；AIN-08-订单历史依据-20261007-codex-lane-a.md |
| d60a4cab | tools/diagnostic-read-facts.service.ts | ai-native-lane-a-diagnostics.test.cjs；AIN-08-开业与经营风险投影-20261007-codex-lane-a.md |
| 7d1e2fd2 | quote-preview.service.ts | ai-native-lane-a-quote-boundaries.test.cjs；AIN-09-报价绑定与四品类回归-20261007-codex-lane-a.md |
| 本片 | tools/quote-candidate-preparation.service.ts | ai-native-lane-a-quote-candidates.test.cjs；本记录（SHA以提交后git历史为准） |

源码路径统一 apps/api/src/modules/ai-native/；测试路径 tests/；记录路径 docs/开发任务/附件/AI原生系统协作切片/。没有修改 rental-core、共享契约、Auth入口、runner、task-input、审批、知识、Prisma或中央文档。

## 主线精确依赖/补丁（未完成，不能自行启用）

1. **持久执行**：当前policy/input/executor封闭集合仅已有catalog/availability。本线无该目录写权；主线在同一份不可变输入、计划政策、服务端选工具、result与累计资源链加入会员/订单/开业/风险/报价，复用本片导出schemas，默认关闭。不能另造dispatch或仅改maturity声明。
2. **开业/经营正式授权**：原AiBusinessReadRouteAuthority需增加固定GET tenant-readiness、reports/operations桥，完整actor/audience/scope/access读后复验。原Guard不改宽；地点配置汇总是否还需逐地点裁剪，按原业务权限确定。在此之前诊断服务只是等待可信adapter的投影，不算已授权生产工具。
3. **会员有界源**：MembershipService.listPersonalOptions的原findMany没有take。本服务只拒绝超50响应，主线需在原服务复用personalBookingOptionScope添加有界查询，定义截断/分页语义；不能伪称现有查询已有限。
4. **历史来源**：getOrder仅给价格版本引用、保存规则和检查模板，没有原始费率/pricingContext。本片complete=false。完整历史价格需授权、同order.quoteId绑定的历史报价来源；缺失不得用当前价格/模板补齐。
5. **报价正式消费**：现有AiQuotePreviewAuthority与AiQuoteCoreContextSource仍需真实受权装配，候选服务也依赖其绑定当前空间/地点的settings来源。主线负责企业预约身份来源、资格与库存负例、明确结构化Core错误码、当前配置修订/有效期和确认的不可变输入。此处没有任意NLP、企业资格成功或当前库存可用证明。报价persist不是预占；一个R1 quote步骤不得伪装成R0。
6. **费用版本证据**：Core目前分项保留sourceId/sourceVersion，局部整体定价/rule/price/calendar引用原样输出；没有凭空生成优惠版本，没有价格版本（如内存源）就保留缺失。正式优惠/资格版本契约缺口需主线确认，不自行扩shared。

作者已完成上述可提交实现与离线验证，待非作者独立复核；真实MySQL锁/并发、真实HTTP、模型、浏览器、微信宿主/真机与生产灰度均未验。**本轮不是AIN-08/09整项验收，也不是整批主线接线完成。**

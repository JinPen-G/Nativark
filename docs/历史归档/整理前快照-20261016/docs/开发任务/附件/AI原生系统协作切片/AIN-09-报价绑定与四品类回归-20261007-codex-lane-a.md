# AIN-09 报价绑定：lane A 第四切片

基线 d60a4cab，修改现有 quote-preview.service，不改 Core 计价、公共权限/契约或持久执行链。

## 实现

pricingUnit 改为消费已有 RENTAL_PRICING_UNIT_CODES，修正 AI 枚举遗漏 calendar_day。导出现有严格请求 schema，供主线不可变输入复用。报价前保存原请求指纹，分别复制给授权与 Core，拒绝下游修改请求后冒充原请求；结果按完成时点检查有效期。费用分项按原 RentalQuoteChargeLine 字段白名单和有界类型解析，不透传附加内部字段。报价仍只调用 RentalBusinessService.createQuote，保留 not_reserved，无库存锁定、建单、付款或交付调用。

## 实际红绿过程

node --test tests/ai-native-lane-a-quote-boundaries.test.cjs 红测：1 pass / 7 fail / 0 skip，退出1。三项确认生产缺陷（过期时点、可变请求指纹、费用行额外字段透传）；另外四项错误地强选了尚未配置费率的 calendar_day，人工 Core 先拒绝。这是合成输入错误，不是四个额外生产缺陷。改用每品类正式配置中的费率单位，另加 calendar_day 枚举消费独立验证。

绿测 node --test --test-concurrency=2 tests/ai-native-lane-a-quote-boundaries.test.cjs tests/ai-native-ain09-quote-preview.test.cjs：17 pass / 0 fail / 0 skip，退出0。后续边界红测又补出并修复报价保存依据不完整、非法时区、价格版本半绑定等问题；本轮与候选准备一起复验为 38/38 pass、0 fail、0 skip，退出0。

四品类测试实际执行 RentalCoreService 初始化与 RentalBusinessService.createQuote，两次同输入分别走人工 Core 和 AI bridge，逐项比较租金、应付、应收、费用分项、时区；仅配置/事实仓储吸收替身。固定带 +08:00 起止，真实计价没有复制算法。此部分注入的 quote authority 只是显式生命周期测试端口，**不算真实报价 Guard 或权益验收**。

边界还验证相对自由文本、无时区时间、0/10001/小数数量拒绝并零 Core 调用。这证明不会猜时间/数量，不代表自然语言候选已完全解析。原 Core 缺货分类、过期、异常金额和返回另一请求的既有回归保留。

API node -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit'];require('typescript/lib/tsc')" 退出0；git diff --check退出0。所有 Node预加载本树 prisma-offline-preload.cjs、固定无效DATABASE_URL，AI_OFFLINE_AUDIT为本树绝对output/lane-a-quote-*.audit；无外联或共享生成物修改。

## 原权限与精确剩余

原报价权限/Guard 必须由主线正式报价授权 adapter 注入；createAiQuotePreviewService 已要求该依赖，缺方法拒绝，本线没有默认恒真授权、HTTP 注册或执行政策启用。报价持久化为 R1，无库存预留，不得按 R0 假定没有写入。费用行最多100，时间/版本原值来自 Core。

剩余：自然语言候选的服务器参数解析/确认；正式当前报价权限、权益、不可变确认输入及资源/result 装配；共享类型没有正式 AI 结构化失败码对应 Core 全部原因，目前仍保留既有局部分类，不能说覆盖所有不支持品类/资格分支；customerType=corporate 只存在输入枚举，不证明企业正式预约身份已接通；报价未装配双轨 Gateway。上述由主线按原链补依赖，不另建执行链。

本片函数级行为、严格类型通过，MySQL、HTTP、模型、浏览器、微信/设备、生产未验，待独立复核。不宣布 AIN-09 完成。

# CA04 订单检查事实消费

接续45740608，施工仅codex-ai-native-lane-a。复用原Core `listInspections`，未改Core、Guard、共享契约、审批或runner。

## 实际入口

`composeAiAuthorizedBusinessTools(...).orderExplanationPreparation(orderId).prepare({question:'fees'})` 接通实际检查记录；status/payments问题不加载检查。`reopenCitation` 支持封闭来源字段inspection_records，再经原订单检查GET路由Guard/ALS读取。正式Core实例存在listInspections才装配；依赖缺失明确unavailable。

读取前后校验当前订单版本，并由现有authority复核当前身份/scope。记录限定同tenant/order、唯一ID、最多50条、每条最多50个异常、投影总量32768字节。输出stage、原template/version、关联检查、异常review/customerResponse及观察时间；不输出原始results、附件URL、操作人、建议收费，不推断责任、争议裁决或结算。coverage保持partial。既有场景事实指纹及受权来源枚举接回inspection_records，观察时间不参与稳定事实内容比较。

## 快检

复用既有order-consumption用例和真实AuthService/ApiAuthGuard/RentalCoreService，替身仅为其底层业务存储。首次编译失败1处TS2339（闭包scope未保持workspace收窄），已改为克隆收窄后的scope；不是业务红测证据。

最终定向1pass/0fail/0skip/0todo，退出0：status不读取检查；fees读取原阶段/模板版本/客户disputed记录；私密字段不透传；来源重开；跨tenant记录拒绝；读取期间注销拒绝。

前置环境：DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT为本树output/ca04-inspections.audit；TEMP/TMP为本树output/lane-a-original-request-tmp。

`node --require ./tests/fixtures/ai-native/prisma-offline-preload.cjs --require ./tests/fixtures/ai-native/lane-b-local-runtime.cjs --test --test-name-pattern='actual order consumer' tests/ai-native-lane-a-order-consumption.test.cjs`

API源码noEmit沿用原tsconfig strict，paths指本树shared/src/index.ts及私有Prisma/index.d.ts，不写共享dist；getPreEmitDiagnostics=0，退出0（output/ca04-inspection-types.audit）。git diff --check退出0。未扩大矩阵或新增测试脚本。

## 精确依赖与未验

`RentalCoreService.listInspections(tenantId,orderId)` → `RentalCoreFactRepository.listInspections` 当前findMany只有where/orderBy，没有take/cursor；AI输出限制不是数据库查询有界。主线需在原公开入口提供有限take/cursor及截断/下一页语义，保持tenant/workspace/order条件及当前Guard。A不跨范围修改Core。

尚未验证实际模型费用场景、MySQL、真实HTTP、浏览器/微信、部署或生产。原模板的检查记录不等于当前订单全部检查已加载。CA06/07仍等待主线安全固定依赖，不重复尝试公共历史冲突合并。此片不代表AIN-13或AIN整体验收。

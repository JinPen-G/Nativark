# AIN-08 客户候选：lane A 第一切片

## 归属与基线

负责人本轮派工生效，仅施工 codex-ai-native-lane-a / ai/codex-ai-native-lane-a-20261007。06c5cd1a 已快进固定 da6fb9ae，无重复合并。未修改中央索引、完成率、runner、task-input、公共授权或其他施工树。

## 实现与实际调用层

导出现有严格候选输入 schema（limit 1–50，拒绝额外字段），收紧 phoneMasked：只允许空值或最多三位前缀、至少三颗星、最多四位后缀的脱敏号码，拒绝明文号码挂星、附加文本及换行。没有自动选择客户、声明预约资格或读取共享订单。

新增测试调用实际 ApiAuthGuard → ALS → MembershipService.listPersonalOptions → AiMembershipCandidateReadFactsService；仅数据库执行和身份持久依赖为合成替身。复用原 own/地点范围查询，测试同名候选、租户过滤、own、空地点拒绝、撤权、读取期间缩权和无结果。静态/严格 TS 与函数级行为证据，不是 HTTP、MySQL、模型或设备验收。

## 失败过程与验证

初次新树回归因隔离 Prisma 尚未生成、工作树 shared 构建/解析尚未建立而加载失败；一次输入了不存在的测试路径，不能算业务红测。使用现有 scripts/ai-native-generate-local-prisma.cjs 隔离生成，报告 generated=true、guardViolations=0、sharedArtifactsUnchanged=true；本树 shared 编译及 API 本地指向本树 shared 的解析链接，无安装依赖、无修改 shared 源码或共享生成物。

基线命令：node --test --test-concurrency=2 tests/ai-native-knowledge-selection.test.cjs tests/ai-native-persisted-availability-runner.test.cjs tests/ai-native-ain08-membership-candidate-read.test.cjs tests/ai-native-order-read-facts.test.cjs。47 pass / 0 fail / 0 skip，退出0。

红测：node --test tests/ai-native-lane-a-membership.test.cjs：6 pass / 6 fail / 0 skip，退出1。其中五项实际证明脱敏漏洞；一项原测试误期望空地点返回空候选，实际 Guard 更严格拒绝，已纠正为拒绝且零查询，未放宽生产授权。

绿测：node --test --test-concurrency=2 tests/ai-native-lane-a-membership.test.cjs tests/ai-native-ain08-membership-candidate-read.test.cjs：16 pass / 0 fail / 0 skip，退出0。

API 类型检查：node -e "process.argv=[process.execPath,'tsc','-p','apps/api/tsconfig.json','--noEmit'];require('typescript/lib/tsc')"，退出0。git diff --check 退出0（仅换行归一化警告）。

上述 Node 均使用本树 tests/fixtures/ai-native/prisma-offline-preload.cjs，DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_AUDIT 为本树 output/lane-a-*.audit。报告不附带提交 output。

## 原权限、成熟度与主线最小补丁

原入口 GET /rental/v1/booking-members，rental-os:order:create；tenant 共享候选仍必须经过当前 workspace/operator 或 staff Guard。最大投影50条，查询时点 observedAt；历史依据对此工具不适用，候选不是历史事实。

当前成熟度：受权只读服务及离线行为已验证，**尚未接入持久执行链，不能标正式可执行工具**。

1. 主线应在现有不可变输入/计划政策的受控工具联合中登记 membership.customer.resolve，复用此 input schema 和现有 facts service，按 availability 既有链绑定输入、工具选择、result 与累计资源；本线无 runner/task-input 写权，未新建平行执行链。
2. MembershipService.listPersonalOptions 现有 Prisma findMany 未带 take；事实服务只能拒绝超过 limit 的响应，不能保证数据库查询有界。请主线在原会员服务增加受控有界候选读取（复用 personalBookingOptionScope，take 不超过50并明确截断/分页语义），不能通过此 lane 复制鉴权算法。当前不声称数据库层有界已实现。
3. 企业候选与正式预约资格另有业务入口，尚未验证/接通；不得由同名或会员活跃状态推断资格。

待非作者独立复核。未执行真库、真实 HTTP、模型、浏览器、微信宿主或生产灰度；不宣布 AIN-08 完成。

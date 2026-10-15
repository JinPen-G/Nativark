# 持久目录分页与报价候选消费

接续112a7b0a；主线授权固定b1ba6337安全merge为4cb6af13，无冲突，保留本线cafee/112a与全部output。不追活动HEAD；Core/配置仓储/shared此次变化全来自该固定历史，本片不自行修改。

## 真实接线

- AiCatalogReadFactsService.read使用Core.listItemGroupsPage，现有input闭合扩展cursor/itemGroupId/name（精确名），不回退listItemGroups/cache。实际business-tools及business-read-facts组合保留该port类型。返回脱敏items及原truncated/nextCursor/configurationVersion/source、观察时间，检查行tenant/精确筛选/排序/游标/重复/版本/页形状；原Guard/ALS复验不变。
- quote.candidates.prepare按每行明确ID或精确productName构造distinct查询，一次每query一页limit100，最多50query/100distinct items，再按同组query复验；不无限翻页找“唯一”。名查询被截断不能据当前页选中，要求明确ID；同名多项仍ambiguous。配置页version/query/截断/cursor绑定selectionRevision；版本变化需要重确认，不沿旧选择。组合页版本只代表所查页，不是全局配置版本或历史。
- quote.businessPreparation.alternatives的原商品改精确ID查询，避免它不在第一候选页被误判不存在；替代候选仍最多5次availability，保留候选页partial/nextCursor/配置版本，不自动替换、不组合计价。

原quote context仍使用Core配置缓存（含listItemGroups/pricingGroups等）作为原业务上下文，本片不能声称整个报价过程所有配置都DB分页。Pricing/Core算法、资格、时区、建单及审批均未改。

## 一次定向快检

实际AuthService/ApiAuthGuard、RentalCoreService、RentalCoreConfigRepository、MembershipService与business-tools/报价候选服务；仅DB delegates及原吸收式配置/计价基础来源合成。目录limit1触发原take+1、tenant/workspace where；精确ID返回原商品；原候选完成计价单位澄清后needs_confirmation，更新DB updatedAt使同输入selectionRevision过期并重确认；添加同名商品得到ambiguous；撤销会话后零新目录查询且拒绝。exit0，无商品报价写入/模型/订单。实际查询由仓储生产实现生成，非复制产品分页算法替代仓储；合成DB仍不证明MySQL排序/锁。

命令：node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e '<inline实际目录与报价消费者断言>'；ts-node transpileOnly:false。固定DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_WRITE_ROOT/TEMP/TMP为本树绝对路径，AI_OFFLINE_AUDIT=本树output/ca-business-bounded-20261014.audit。Compiler API noEmit原场景模块/client-request根0诊断/exit0；git diff --check0。没有新增修改tests/fixtures，不报虚构TAP计数。

## 已交主线的公共补丁与未验

runner/persisted-catalog-runner.composition.ts:120显式只传listItemGroups会剥掉page，需要主线保留并绑定listItemGroupsPage；否则新reader按缺端口failclosed。formal-approved-order-reprepare.composition传d.core本身，不运行时剥方法，主线需检查其声明/正式注入仍携带新port。公开shared合同需扩大目录input/结果时由主线核验，本线只改既有内部schema，不私增公共协议。已发精确方法/行号，不改runner/审批归属。

真实DB/HTTP/模型/支付/设备/生产未验；深度分页稳定性、>100同名截断、全50query与跨进程竞态本轮未跑，不凭一次正常冒烟声称完整矩阵通过。通用开业分区Core提案缺依赖仍prepared_not_submitted，不借通知/order协议；原客户Booking页结果reader与原订单来源链直接复用，不重复包装、不涨原AIN完成率。

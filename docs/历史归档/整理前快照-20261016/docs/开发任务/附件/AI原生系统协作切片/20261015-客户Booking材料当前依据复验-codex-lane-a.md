# 客户 Booking 材料当前依据复验

基线1330c7dceda145e275137985f52f624cf77fd412，A树和原分支正确，tracked/index空，无MERGE_HEAD；固定主线提交已包含，不重复合并。既有output保留。本片只改client-booking-material.ts和本记录。

## 实际接通

沿用readClientBookingMaterial→readPreparedQuoteBookingMaterial→composeClientOriginalBookingFlow.prepare及既有Booking材料入口，不新增类、路由、DTO、报价或订单。库存读取后，再由原member reader复读当前选中商品/地点/履约/时区、同一原报价及当前可用身份；相关配置变化或报价已消费要求reprepare，资格变化拒绝。无权限异常原样传播，不降级返回旧材料。

初次配置、报价、身份候选和库存结果取独立快照，输出冻结；不因依赖继续修改原对象而改变先前观察的指纹。比较只包含选中商品及地点，不因无关商品变化要求重选。库存始终available_at_observation_not_reserved，不称预占。独立多次读取不是Core原子事务，最终办理仍必须由原入口复验。

## 一次针对性冒烟及类型

PowerShell设置DATABASE_URL=mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_WRITE_ROOT为本树绝对路径，TEMP/TMP为本树output，AI_OFFLINE_AUDIT为本树output/ca-booking-current-20261015.audit。

命令入口：node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e（内联ts-node加载实际readClientBookingMaterial与node:assert）。只用显式member外部读取替身制造正常、库存等待期间选中配置变化、资格撤销、原报价已消费四例，预算/鉴权/数据库并未在此模拟为正式验收。

最初内联合成枚举误用pickup触发AI_INVALID_INPUT，已按正式store_pickup_return纠正，未据此计作产品红测。有效红测1 pass/3 fail/0 skip/0 todo，exit1（后三例Missing expected rejection）；修复后4 pass/0 fail/0 skip/0 todo，exit0。未新增或修改tests/fixtures/测试脚本。

同一离线preload下Compiler API检查original-scenes.module.ts、client-request.application.ts及依赖，noEmit 0诊断，exit0。git diff --check exit0（仅既有CRLF提示）。并非全仓库回归或真实客户身份链验收。

## 边界与下一步

原完整链已经具备显式确认原报价、独立Booking Draft、人工选择/交接、页面接受及原操作读取；本片不将确认报价升级为批准建单，不修改客户application/controller/module、认证、仓储、公共契约。服务能力、一次性送达地址复验、额外服务容量、独立企业资格缺口继续unavailable，不降级个人。不连接HTTP/MySQL/模型/支付，未验真实宿主、锁并发或生产。继续原包核查原报价确认等待中的材料有效期，不扩展其他线。

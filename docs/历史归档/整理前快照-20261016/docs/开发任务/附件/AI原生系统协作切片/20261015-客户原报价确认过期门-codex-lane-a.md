# 客户原报价确认过期门

父提交145cae04，唯一A树原分支，无他人源码WIP。本片只改client-quote-preparation.composition.ts和此记录。

## 功能

composeClientOriginalQuotePreparation.confirm原先仅load时核材料到期。规范化、权限和仓储读取均可能等待，参数不变不代表材料仍有效。现在最后一次精确findSource并比对原行后、调用原quotes.create之前，再比较latest.expiresAt与注入服务器clock；已过期拒绝AI_REVISION_CONFLICT，不发生R1报价写入。正常仍是parameters_only_not_order_approval；readOriginal只读核对不因本改动增加创建或重试。

## 定向证据

命令node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e（内联ts-node、实际composeClientOriginalQuotePreparation、AiClientPolicyAuthority、PrismaClientSceneMaterialRepository、原Guard/ALS适配及DTO验证）。仅外部Guard宿主、Prisma数据源、订阅事实和Core方法显式离线替身；不是正式身份/数据库/真实报价验收。用受控Promise挂起prepareQuoteForOriginalOperation，时钟从00:00推进00:06，原材料00:05过期，政策仍有效。

红测1 pass/1 fail/0 skip/0 todo exit1（过期后原create仍调用，Missing expected rejection）；修后2 pass/0 fail/0 skip/0 todo exit0（正常仅一次create；等待过期拒绝且create为0）。首次内联语法错误修正后才取得上述有效红测，不计产品失败。无新增测试/fixture/脚本。

同本树离线环境的Compiler API noEmit：original-scenes.module.ts、client-request.application.ts及依赖0诊断exit0。git diff --check exit0。DATABASE_URL固定无效offline URL，AI_OFFLINE_AUDIT=本树output/ca-booking-current-20261015.audit，TEMP/TMP/write-root均本树。无.env、网络、DB、模型、支付或共享生成物操作；未运行全量回归/真实宿主。

## 公共依赖交主线

继续核对原包发现：client-original-booking-flow.readOperation先resolve→readPreparedQuoteBookingMaterial→当前库存/配置/报价，application.readOperation再verify→readMaterial。若材料写入应答丢失后原报价到期/被消费/当前库存变化，当前读键路径会拒绝，无法区分原写是否存在。不能把拒绝解释成未写或新建第二份。

所需最小公共入口：在client-request.application及既有仓储根提供原operationKey+command/inputHash的只读存在性收据。保留当前客户身份、tenant/workspace/channel/publication/owner绑定、原行内容校验和读后撤权检查；允许报告原行存在但stale/not_executable，不能返回可执行action或重新授予旧材料。不存在仍unknown/nonretryable。该文件不在本线范围，本线不修改、不放宽verify；主线给固定接口后再消费。

readClientBookingMaterial目前收到一次性的Date，库存等等待期间无法使用同一注入时钟复核报价expiresAt/租期开始是否经过。当前本线已补配置、原报价内容和资格复读，**不声称解决经过时间问题**。最小补丁是主线在该helper调用处传入现有clock函数（保留原Date兼容）并在最后读取完成后检查时间；需要改client-request.application两处调用，由主线协调固定补丁。未接前不得说整个Booking链已闭环或AIN完成。

# 客户 Booking 等待后时钟复核

父727dde5a，A树原分支。本片由主线明确协调：A只改client-booking-material.ts；主线认领client-request.application.ts两处调用及原键只读收据，不双写。

readClientBookingMaterial第四参数兼容Date或服务器注入的()=>Date。开始和最后一次配置/报价/资格复读完成后各取一次有效时间；报价到期或租期开始经过时拒绝AI_PROPOSAL_STALE，非法时钟unavailable。不是模型/客户端时间，也不自行获取机器时钟。现有Date调用兼容，但固定Date不能证明真实等待耗时，生产消费须主线两处改传现有clock函数后才生效；本片不改application。

一次针对性inline加载实际helper，显式member读取替身。有效红测正常1 pass，依赖等待时推进同一注入Date的报价过期/租期已开始2 fail（Missing expected rejection），exit1；修后以clock函数驱动3 pass/0 fail/0 skip/0 todo，exit0。租期开始例将报价有效期延至之后，确保独立命中租期边界，非复用过期断言。初始尝试向旧签名传function的TypeError不冒充有效业务红测。未新增修改测试或fixture文件。

命令node -r ./tests/fixtures/ai-native/prisma-offline-preload.cjs -r ./tests/fixtures/ai-native/lane-b-local-runtime.cjs -e（ts-node实际helper+内联受控时间和assert）。同preload的Compiler API original-scenes.module.ts/client-request.application.ts及依赖noEmit0诊断/exit0；git diff --check0。DATABASE_URL固定mysql://offline:offline@127.0.0.1:1/rental_os_offline，AI_OFFLINE_WRITE_ROOT和TEMP/TMP在本树，audit为本树output/ca-booking-current-20261015.audit。无新脚本、.env、外联或共享生成物，未验真实宿主/DB/模型/支付。

原键只读收据仍交主线提供正式接口；A暂不改client-original-booking-flow.readOperation，不以材料失效断言原写未提交，不重建quote或伪造action。一次性地址/额外服务容量/独立企业资格仍按原unavailable，不宣称AIN整项完成。

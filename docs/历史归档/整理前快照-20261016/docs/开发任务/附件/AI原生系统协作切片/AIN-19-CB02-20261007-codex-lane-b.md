# CB-02 草稿列表的当前目标隔离

接续 27fe3967，复用 LB05/06 的当前身份动作授权、实际 Prisma 草稿/收据和 CAS，不另建草稿服务。

发现宿主 drafts.list 接收完整 target 并校验其模板，但仓储只按 orderId 查询，返回同订单其他 allocation/stage/template 的草稿。修复为应用传入完整目标过滤，仓储在 take/分页前包含 allocationId、stage、templateId；不依赖返回后 filter，不返回 state 正文。原内部订单级仓储读取兼容，宿主入口固定采用精确目标。

实际验证 node --test tests/ai-native-inspection-persistent-application.test.cjs。红测 5 pass/1 fail/0 skip/0 todo，退出码1，确实读出三个其他目标草稿；修复后6 pass/0 fail/0 skip/0 todo，退出码0。使用本树绝对 prisma-offline-preload.cjs 与 lane-b-local-runtime.cjs；固定 mysql://offline:offline@127.0.0.1:1/rental_os_offline；AI_OFFLINE_AUDIT=本树 output/inspection-cb02-audit；TEMP/TMP=本树 output/inspection-lb05-tmp。ts-node transpileOnly:false 检查实际应用/仓储，不是全 API tsc。diff --check 通过。

真实 Auth/Guard/服务/Prisma 仓储适配，事务 DB/Core 为离线替身；不是 MySQL锁、文件存储或设备验收。当前编辑授权仍复用原订单阶段动作许可，不增加新权限码；没有把订单 GET 当作写权限。Runtime 可继续用同 target/revision/operation；Provider 不参与该读取。

本片是 CB-02 实际缺陷修复，不以一条新测试宣称整项完成。下一步核对 CB-01 受控存储实际生产者、CB-03 媒体正式依赖，再接 CB-05～12 其余合法包。原 Knowledge module WIP 保留，尚未夹带提交。

# AIN-10 / CB07：有界读取窗口超量拒绝

知识管理列表和已确认偏好读取改为 `take: 101`，当第 101 行存在时明确 `unavailable`，不把静默截断误报为完整结果；对外仍保持既有有界窗口和 `pagination: unavailable`，没有伪造 cursor 或跨范围计数。

验证：复用既有知识组合与正式授权冒烟，2 pass / 0 fail / 0 skip / 0 todo，退出码 0；`git diff --check` 通过。未连接真实 MySQL，未修改 schema/shared/Auth/Guard。

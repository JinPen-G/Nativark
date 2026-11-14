# 平台底座文档入口

本目录按平台公共能力归属组织资料，不属于某个行业Core，也不属于AI Native子功能。目录归并不代表工程已解耦或获准部署。

目标是对开发者和开发AI友好的AI Native SaaS底座：无Core可进入公共后台；注册的Core由SaaS管理员直接授权租户，租户管理员再分配给成员，同租户可同时使用多个Core。各Core自有业务分区，AI工具可选；首期沿用统一订阅期限，停用保留数据，重新授权按当前条件恢复。采用同仓独立模块，产品边界唯一见[Core接入需求](Core接入/平台Core接入-需求.md)，不开放无Core通用Agent产品。

拆分按现有功能清单逐片验证，AI Native未完成不阻止无关边界施工。开发新Core从[五步快速接入](Core接入/平台Core接入-开发任务.md#core-quick-start)和[Agent任务模板](Core接入/平台Core接入-开发任务.md#core-agent-template)开始，接口细节按需查阅。首期设计包括标准包、GitHub Topic发现和固定Release下载安装；这些入口随工程实现交付，当前仍为正式开发要求。

整个平台按模块梳理自有代码、源码职责备注和API说明，保持实现简洁、接口与文档同版本；轻量工单/工作流也可成为Core。无Core租户仍能登录并使用获权公共设置。底座与各Core分别发布、分别更新，下游的业务Core、配置和数据在兼容更新中保留。

## Core接入四册及内设章节

| 资料 | 用途 |
| --- | --- |
| [Core接入需求](Core接入/平台Core接入-需求.md) | 平台与Rental/CRM/TMS等业务Core的责任、接入边界及验收 |
| [Core接入开发任务](Core接入/平台Core接入-开发任务.md) | PCH原编号、依赖和唯一有据百分比 |
| [Core接入协作接续](Core接入/平台Core接入-协作接续.md) | 当前授权、归属、缺口及下一入口 |
| [Core接入开发记录](Core接入/平台Core接入-开发记录.md) | 已做/未做、静态现状和分层证据 |
| [接口与生命周期设计](Core接入/平台Core接入-开发任务.md#contract-design) | 合同职责、版本、权限、事务、错误、停用与回退；尚非已发布SDK |
| [业务Core接入指南](Core接入/平台Core接入-开发任务.md#integration-guide) | 其他AI/开发者的接手步骤、交付单和后续可复现要求 |
| [Core包与分发标准](Core接入/平台Core接入-开发任务.md#core-package-standard) | 清单、必需/可选贡献、本地包、GitHub Topic/Release及受控安装 |
| [拆分兼容与AI并行](Core接入/平台Core接入-开发任务.md#compatibility-slices) | 现有功能前后对照、切片门槛和AI未完接点的处理 |
| [源码梳理与API资料](Core接入/平台Core接入-开发任务.md#source-organization) | 全平台代码阅读路线、文件/逻辑说明、简洁实现与API一致性 |
| [底座与Core独立更新](Core接入/平台Core接入-开发任务.md#independent-upgrades) | 跟随上游发行、版本兼容、自定义配置/数据保留与升级验证 |

## 未来规划与相邻领域

- [通用化与开源方案](未来规划/平台底座-通用化与开源方案.md)：工程内容归并PCH；保留跨Core业务协作、外部宿主复用及开源产品化前置，不另立任务队列。
- [Rental Core](<../Rental Core/Rental Core-需求.md>)：租赁行业内核，其品类治理位于自身目录。
- [AI Native](<../AI Native/AI Native-需求.md>)：可选智能机制及原业务场景，Runtime/Provider SDK替换仍归AI专项，不与Core替换捆绑。
- [SaaS订阅](../SaaS订阅/SaaS订阅-需求.md)：现有租赁产品的基础版/PRO商业规则，独立维护；不因名称含SaaS就无审查搬成所有行业默认。
- [公共技术资料](../公共技术资料/开发指南/项目-开发指南.md)：跨专项实现约定，继续唯一维护。

2026-10-31目录归并说明和原路径映射见[Core接入开发记录](Core接入/平台Core接入-开发记录.md)。历史原文保留，现行资料通过[总导航](../文档导航.md)查找。

# UIArc Empty states

来源：https://uiarc.dev/components/blocks/empty-states

复用仓库已保留的公开源码 packages/ui-arc/vendor/registry/blocks/empty-states；原文件与 CSS 不变。沿用仓库 UIArc MIT 来源许可。

从原 TSX 抽取向量渲染器，geometry/CSS 直接导入，保留 spring、逐形延迟、路径变形及 pointer parallax。演示场景选择改为业务受控属性，使用平台有效动效偏好，初始图形按真实场景初始化。装饰插画不重复播报，可读标题提供状态。

不挂载演示 tabs，不运行模拟请求、定时成功、虚构结果或自动重试。加载仍用骨架；权限或一般请求错误不冒充离线或空数据。

TSX 导入时 SHA256：5f2d3852e649bb777bec2171d6fc48ea5ebe8a8564cf317a82ac82eb5fc6cdaf

通用无资料场景复用原 inbox 托盘，适配层隐藏第 6/9 个徽章图元，原几何不改；带勾版本仅表达真实已处理完。首次出现从不可见图元进入原逐形弹簧，保留线条绘制与指针视差；不再直接停在最终帧。只调整显示生命周期，不将 loading/done 演示阶段当作业务事实。

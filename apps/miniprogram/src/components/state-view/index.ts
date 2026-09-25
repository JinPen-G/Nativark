/**
 * 页面共用状态（需求 §4.3）：加载骨架、空态、错误态。
 * 错误态保留已加载内容由页面自己决定（本组件只渲染自身区域），并总是给出可执行的下一步。
 */
Component({
  options: { addGlobalClass: true },
  properties: {
    state: { type: String, value: "idle" },
    title: { type: String, value: "" },
    message: { type: String, value: "" },
    actionText: { type: String, value: "" },
    secondaryText: { type: String, value: "" },
    /** 加载骨架形状：list（列表行）/ detail（详情大图）/ form（表单），缺省用通用骨架，与真实内容结构更贴合。 */
    skeleton: { type: String, value: "" },
    compact: { type: Boolean, value: false }
  },
  methods: {
    onAction() {
      this.triggerEvent("action");
    },
    onSecondary() {
      this.triggerEvent("secondary");
    }
  }
});

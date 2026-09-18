/** 半屏面板（需求 §3：选择项用面板，不为每个选择建独立页）。点遮罩或关闭按钮触发 close。 */
Component({
  options: { addGlobalClass: true, multipleSlots: true },
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: "" },
    closable: { type: Boolean, value: true },
    /** 是否渲染底部操作区（WXSS 不能用 :empty 判断插槽是否有内容，由使用方声明）。 */
    footer: { type: Boolean, value: false }
  },
  methods: {
    onClose() {
      if (this.data.closable) this.triggerEvent("close");
    },
    noop() {
      // 阻止面板内部点击冒泡到遮罩。
    }
  }
});

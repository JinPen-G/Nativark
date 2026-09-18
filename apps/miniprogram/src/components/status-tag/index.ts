/** 状态标签：文字 + 颜色同时表达，不只用颜色（需求 §4.1）。 */
Component({
  options: { addGlobalClass: true },
  properties: {
    label: { type: String, value: "" },
    tone: { type: String, value: "neutral" },
    small: { type: Boolean, value: false }
  }
});

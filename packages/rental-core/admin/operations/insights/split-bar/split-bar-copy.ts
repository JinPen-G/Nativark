/** Labels only; the preserved component owns segment filtering, values and interaction. */
export function splitBarCopy(locale: string) {
  const zh = locale === "zh-CN";
  return {
    chart: zh ? "分段占比图" : "split bar",
    hidden: zh ? "已隐藏" : "hidden",
    off: zh ? "已隐藏" : "Off",
    keepLast: (label: string) => zh ? `${label}是最后一个显示的分类，至少保留一项。` : `${label} is the only share shown, so it stays on.`,
    visibility: (label: string, shown: boolean) => zh ? `${label}已${shown ? "显示" : "隐藏"}。` : `${label} ${shown ? "shown" : "hidden"}.`,
    legend: (title: string) => zh ? `${title}分类图例` : `${title} segments`,
    group: (title: string, parts: string[]) => zh ? `${title}：${parts.join("，")}。使用方向键查看各分类。` : `${title}: ${parts.join(", ")}. Use the arrow keys to read each share.`,
  };
}

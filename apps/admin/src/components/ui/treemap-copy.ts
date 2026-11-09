/** Treemap interface copy, independent of the original business labels and values. */
export function treemapCopy(locale: string) {
  const zh = locale === "zh-CN";
  return {
    chart: zh ? "矩形树图" : "treemap",
    pathHeader: zh ? "路径" : "Path",
    valueHeader: zh ? "数值" : "Value",
    shareHeader: zh ? "占上级比例" : "Share of parent",
    path: (label: string) => zh ? `${label}路径` : `${label} path`,
    instructions: (label: string, center: string) => zh ? `${label}，${center}。方向键切换分类，Enter放大，Esc返回上级。` : `${label}, ${center}. Arrow keys move between tiles, Enter zooms in, Escape zooms out.`,
    parentShare: (share: string, parent: string) => zh ? `占${parent} ${share}` : `${share} of ${parent}`,
    describe: (path: string[], value: string, share: string, parent: string, color?: string) => zh
      ? `${path.join("，")}，${value}，占${parent} ${share}${color ? `，${color}` : ""}`
      : `${path.join(", ")}, ${value}, ${share} of ${parent}${color ? `, ${color}` : ""}`,
  };
}

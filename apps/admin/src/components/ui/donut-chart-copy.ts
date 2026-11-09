/** Localized chart chrome only; labels and formatted business values pass through unchanged. */
interface DonutChartCopy {
  segment: string;
  value: string;
  share: string;
  sharePrefix: string;
  shareSuffix: (total: string) => string;
  hidden: (label: string) => string;
  legend: (label: string, toggle: boolean) => string;
  ring: (label: string) => string;
  visibility: (label: string, shown: boolean, totalLabel: string, total: string) => string;
  describe: (label: string, value: string, share: string, members?: string[]) => string;
  members: (labels: string[]) => string;
  summary: (label: string, totalLabel: string, total: string, segments: string[]) => string;
  empty: (label: string, empty: string) => string;
}

const english: DonutChartCopy = {
  segment: "Segment", value: "Value", share: "Share", sharePrefix: "",
  shareSuffix: total => ` of ${total.toLowerCase()}`,
  hidden: label => `${label}, hidden`,
  legend: (label, toggle) => `${label}, segments${toggle ? ". Press a segment to show or hide it" : ""}`,
  ring: label => `${label}. Use the arrow keys to read each segment.`,
  visibility: (label, shown, totalLabel, total) => `${label} ${shown ? "shown" : "hidden"}. ${totalLabel} ${total}.`,
  describe: (label, value, share, members) => `${label}, ${value}, ${share}${members ? `. Includes ${members.join(", ")}` : ""}`,
  members: labels => labels.length > 2 ? `${labels.slice(0, 2).join(", ")} and ${labels.length - 2} more` : labels.join(" and "),
  summary: (label, totalLabel, total, segments) => `${label}. ${totalLabel} ${total}. ${segments.join(". ")}.`,
  empty: (label, empty) => `${label}. ${empty}.`,
};

const chinese: DonutChartCopy = {
  segment: "分类", value: "数值", share: "占比", sharePrefix: "占比 ",
  shareSuffix: () => "",
  hidden: label => `${label}，已隐藏`,
  legend: (label, toggle) => `${label}，分类图例${toggle ? "。按下分类可显示或隐藏" : ""}`,
  ring: label => `${label}。使用方向键查看各分类。`,
  visibility: (label, shown, totalLabel, total) => `${label}已${shown ? "显示" : "隐藏"}。${totalLabel} ${total}。`,
  describe: (label, value, share, members) => `${label}，${value}，占比 ${share}${members ? `，包含${members.join("、")}` : ""}`,
  members: labels => labels.length > 2 ? `${labels.slice(0, 2).join("、")}等 ${labels.length} 项` : labels.join("、"),
  summary: (label, totalLabel, total, segments) => `${label}。${totalLabel} ${total}。${segments.join("；")}。`,
  empty: (label, empty) => `${label}。${empty}。`,
};

export function donutChartCopy(locale: string): DonutChartCopy {
  return locale === "zh-CN" ? chinese : english;
}

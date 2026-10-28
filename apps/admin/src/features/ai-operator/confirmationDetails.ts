import type { OperatorArtifact } from "./capabilities";

/** Review the same result values shown in the workspace; never invent a second quote. */
export function confirmationDetails(artifact: OperatorArtifact) {
  if (artifact.kind === "quote") return {
    description: "将按当前资料准备预约草稿，关联客户、租期与报价。",
    facts: [
      { label: "租赁安排", value: artifact.rows[0]?.[1] ?? "待补充" },
      { label: "租金", value: artifact.rows.find(row => row[0] === "租金")?.[2] ?? "待核对" },
      { label: "可退押金", value: artifact.rows.find(row => row[0] === "可退押金")?.[2] ?? "待核对" },
      { label: "待支付合计", value: artifact.metrics?.find(metric => metric.label === "示例待支付")?.value ?? "待核对" },
    ],
  };
  if (artifact.kind === "tasks") return {
    description: "将按交接清单准备履约任务并分派负责人，实际交付仍需门店核验。",
    facts: [
      { label: "交接事项", value: `${artifact.rows.length} 项` },
      { label: "关联订单", value: artifact.rows.filter(row => row[0].startsWith("DEMO-")).map(row => row[0].split(" · ")[0]).join("、") || "待核对" },
      { label: "负责人", value: [...new Set(artifact.rows.map(row => row[1]))].join("、") },
      { label: "交付时间", value: artifact.rows.slice(0, 2).map(row => row[2]).join("、") },
    ],
  };
  return {
    description: "将按门店协同清单分派任务，保留对应负责人、计划时间与处理记录。",
    facts: [
      { label: "协同安排", value: `${artifact.rows.length} 项` },
      { label: "涉及门店", value: [...new Set(artifact.rows.filter(row => row[0].includes(" · ")).map(row => row[0].split(" · ")[0]))].join("、") || "待核对" },
      { label: "负责人", value: [...new Set(artifact.rows.map(row => row[1]))].join("、") },
      { label: "计划时间", value: artifact.rows.map(row => row[2]).join("、") },
    ],
  };
}

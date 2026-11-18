/** One presentation meaning across order lists, customer history and reports. */
export function orderStatusTone(status: string) {
  if (status === "completed") return "success";
  if (["pickup_overdue", "return_inspection", "settling", "no_show"].includes(status)) return "warning";
  if (status === "renting") return "active";
  if (["reserved", "ready_for_pickup"].includes(status)) return "info";
  return "neutral";
}
export function orderStatusTagColor(status: string) {
  const tone = orderStatusTone(status);
  return tone === "active" || tone === "info" ? "processing" : tone === "neutral" ? "default" : tone;
}

/** Charts use the same meaning as status badges, independent of account accent. */
export function orderStatusChartColor(status: string) {
  const tone = orderStatusTone(status);
  const semantic = tone === "active" ? "info" : tone;
  return `var(--rental-status-${semantic}-ink)`;
}

/** Display labels only; stored category attribute values and API contracts stay unchanged. */
const labels: Record<string, string> = {
  camera_body:"相机机身", lens:"镜头", tripod:"三脚架", gimbal_camera:"云台相机", action_camera:"运动相机", lighting:"灯光",
  full_frame:"全画幅", aps_c:"APS-C", m43:"M4/3", medium_format:"中画幅", one_inch:"一英寸",
  body:"机身", power:"供电", storage:"存储", accessory:"配件", battery:"电池", charger:"充电器", monitor:"监视器",
  stabilizer:"稳定器", flash:"闪光灯", cage:"兔笼", clean:"已清洁", needs_cleaning:"待清洁", damaged:"已损坏",
};
export function catalogAttributeText(value: unknown, t: (value:string)=>string): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return t(value ? "是" : "否");
  if (Array.isArray(value)) return value.map(item=>catalogAttributeText(item,t)).join(" · ");
  const raw=String(value);
  return t(labels[raw]??raw);
}

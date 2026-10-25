import { AppstoreOutlined, CameraOutlined, CarOutlined, FireOutlined, InboxOutlined, SkinOutlined, ToolOutlined } from "@/components/ui/icons";
const icons = { rental: AppstoreOutlined, camera: CameraOutlined, camping: FireOutlined, construction: ToolOutlined, vehicle: CarOutlined, clothing: SkinOutlined, tool: ToolOutlined, package: InboxOutlined };
export function CategoryTemplateIcon({ code }: { code?: string }) {
  const Icon = icons[code as keyof typeof icons] ?? AppstoreOutlined;
  return <Icon aria-hidden />;
}

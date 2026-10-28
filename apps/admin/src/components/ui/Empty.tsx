import { Empty as AntEmpty, type EmptyProps } from "antd";
import { Folder } from "lucide-react";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { useLocale } from "@/app/locale";
import { EmptyScene, type EmptySceneKind } from './EmptyScene';

function EmptyView(props: EmptyProps & { scene?: EmptySceneKind; compact?: boolean }) {
  const { t } = useLocale();
  const { description = t("暂无数据"), image, children, style, className, styles, classNames, scene, compact, ...rest } = props;
  // Keep custom image/semantic slot contracts, notably the 36px catalog image cell.
  if (styles || classNames || props.imageStyle || description === false || image && image !== AntEmpty.PRESENTED_IMAGE_SIMPLE && image !== AntEmpty.PRESENTED_IMAGE_DEFAULT || typeof description !== "string") return <AntEmpty {...rest} description={description} image={image} style={style} className={className} styles={styles} classNames={classNames}>{children}</AntEmpty>;
  if (scene) return <EmptyScene scene={scene} compact={compact} title={description} action={children} style={style} className={className} />;
  return <div style={style} className={["arc-empty-state", className].filter(Boolean).join(" ")}><EmptyState title={description} description="" action={children} icon={<Folder aria-hidden="true" />} /></div>;
}
export const Empty = Object.assign(EmptyView, { PRESENTED_IMAGE_SIMPLE: AntEmpty.PRESENTED_IMAGE_SIMPLE, PRESENTED_IMAGE_DEFAULT: AntEmpty.PRESENTED_IMAGE_DEFAULT });


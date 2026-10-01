import { ConfigProvider } from "antd";
import { FileUpload as ArcFileUpload, type FileUploadProps } from "@/registry/components/file-upload/file-upload";
import { useLocale } from "@/app/locale";
import { ArcLocale } from "./ArcLocale";

/** Native Arc contract for new uploads; use Upload only for existing Ant request contracts. */
export function FileUpload(props: FileUploadProps) {
  const { t } = useLocale();
  const { componentDisabled } = ConfigProvider.useConfig();
  return <ArcLocale><ArcFileUpload {...props} disabled={props.disabled ?? componentDisabled} label={props.label ?? t("选择文件")} description={props.description ?? t("拖入文件，或点击选择；文件类型与数量以本页面要求为准。")} /></ArcLocale>;
}
export type { FileUploadItem, FileUploadProps } from "@/registry/components/file-upload/file-upload";

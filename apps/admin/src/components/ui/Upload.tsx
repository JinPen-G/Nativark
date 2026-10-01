import { useRef, useState } from "react";
import { ConfigProvider, Upload as AntUpload, type UploadProps, type UploadFile } from "antd";
import type { RcFile } from "antd/es/upload/interface";
import type { CustomUploadRequestOption } from "@rc-component/upload/lib/interface";
import { FileUpload, type FileUploadItem } from "@/registry/components/file-upload/file-upload";
import { useLocale } from "@/app/locale";
import { ArcLocale } from "./ArcLocale";

/** Keep validation and the actual business request. Arc never invents upload progress/success. */
function UploadField(props: UploadProps) {
  const { t } = useLocale();
  const { componentDisabled: formDisabled } = ConfigProvider.useConfig();
  const [internal, setInternal] = useState<UploadFile[]>(props.defaultFileList ?? []);
  const files = props.fileList ?? internal;
  const live = useRef(files); live.current = files;
  const ids = useRef(new WeakMap<File, string>());
  const gates = useRef(new WeakMap<File, Promise<boolean>>());
  const allowed = useRef(new WeakSet<File>());
  const selectionRevision = useRef(0);
  const disabled = props.disabled ?? formDisabled;
  const convert = (file: File): RcFile => { const rc = file as RcFile; if (!rc.uid) rc.uid = crypto.randomUUID(); return rc; };
  const notify = (next: UploadFile[], file: UploadFile) => { live.current = next; setInternal(next); props.onChange?.({ file, fileList: next }); };
  const gate = (file: File, batch: RcFile[]) => {
    let pending = gates.current.get(file);
    if (!pending) { pending = Promise.resolve(props.beforeUpload?.(convert(file), batch)).then(result => result !== AntUpload.LIST_IGNORE); gates.current.set(file, pending); }
    return pending;
  };
  // Remote-only file previews and automatic action URLs still require Ant's transport contract.
  if (props.action || props.directory || props.itemRender || props.onPreview || (props.beforeUpload && props.customRequest) || (props.onRemove && props.customRequest) || (props.accept && typeof props.accept !== "string") || files.some(file => !file.originFileObj)) return <AntUpload {...props} />;
  const items: FileUploadItem[] = files.flatMap(file => file.originFileObj ? [{ id: ids.current.get(file.originFileObj) ?? file.uid, file: file.originFileObj }] : []);
  return <div className="arc-upload-field"><ArcLocale><FileUpload accept={props.accept as string | undefined} disabled={disabled || props.maxCount === 0} multiple={props.multiple ?? props.maxCount !== 1}
    label={t("选择文件")} description={t("拖入文件，或点击选择；文件类型与数量以本页面要求为准。")} value={items}
    onChange={incoming => {
      if (disabled) return;
      const revision = ++selectionRevision.current;
      const previous = live.current;
      const removed = previous.filter(file => !incoming.some(item => item.file === file.originFileObj));
      const retained = previous.filter(file => incoming.some(item => item.file === file.originFileObj));
      const added = incoming.filter(item => !previous.some(file => file.originFileObj === item.file));
      const slots = props.maxCount == null ? added.length : Math.max(0, props.maxCount - retained.length);
      added.slice(0, slots).forEach(item => allowed.current.add(item.file));
      added.slice(slots).forEach(item => allowed.current.delete(item.file));
      void Promise.all(added.slice(0, slots).map(async item => {
        ids.current.set(item.file, item.id);
        if (item.error || !await gate(item.file, added.map(row => convert(row.file)))) { allowed.current.delete(item.file); return null; }
        return { uid: convert(item.file).uid, name: item.file.name, size: item.file.size, type: item.file.type, originFileObj: convert(item.file) } as UploadFile;
      })).then(async additions => {
        const refused: UploadFile[] = [];
        for (const file of removed) { if (await props.onRemove?.(file) === false) refused.push(file); }
        if (revision !== selectionRevision.current) return;
        const selected = [...retained, ...refused, ...additions.filter((file): file is UploadFile => Boolean(file))];
        const next = selected.map(file => live.current.find(latest => latest.uid === file.uid) ?? file);
        const changed = additions.find(Boolean) ?? removed[0];
        if (changed) notify(next, changed);
      }).catch(() => { /* Existing beforeUpload owns its user-facing validation error. */ });
    }}
    onUpload={props.customRequest ? async (file, options) => {
      if (!allowed.current.has(file) || !await gate(file, [convert(file)]) || options.signal.aborted) throw new Error(t("文件未通过验证"));
      const rc = convert(file);
      const update = (status: UploadFile["status"], response?: unknown, percent?: number) => {
        if (options.signal.aborted) return;
        const previous = live.current.find(row => row.uid === rc.uid) ?? { uid: rc.uid, name: file.name, originFileObj: rc };
        const next = { ...previous, status, response, percent };
        notify(live.current.some(row => row.uid === rc.uid) ? live.current.map(row => row.uid === rc.uid ? next : row) : [...live.current, next], next);
      };
      await new Promise<void>((resolve, reject) => {
        const request = (props.customRequest as CustomUploadRequestOption)({ file: rc, filename: props.name ?? "file", action: "", method: props.method ?? "post", data: props.data as Record<string, unknown>, headers: props.headers, withCredentials: props.withCredentials,
          onProgress: event => { options.onProgress(event.percent ?? 0); update("uploading", undefined, event.percent); },
          onSuccess: response => { update("done", response, 100); resolve(); },
          onError: error => { update("error"); reject(error); }
        }, { defaultRequest: () => { throw new Error("Business upload request required"); } });
        options.signal.addEventListener("abort", () => { request?.abort?.(); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
    } : undefined} /></ArcLocale>{props.children && <div className="text-meta">{t("选择文件后，按本页面流程提交。")}</div>}</div>;
}
export const Upload = Object.assign(UploadField, { LIST_IGNORE: AntUpload.LIST_IGNORE, Dragger: AntUpload.Dragger });

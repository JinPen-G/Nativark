import { App, Alert, Form, Input, Modal, Select } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FeatureOwnership,
  FeatureReleaseStatus,
  type SubscriptionFeatureCatalogEntry,
  type UpsertFeatureCatalogRequest
} from "@rental-os/shared";
import { useLocale } from "@/app/locale";
import { subscriptionApi } from "@/api/subscription";
import { RELEASE_STATUS_LABEL } from "./subscriptionLabels";

/**
 * SUB-03 §3.3/§8 功能目录维护弹层：新增/编辑目录项并设当前归属。
 * currentOwnership=基础版 即公共下放（§3.5）；code 为键，编辑时只读。修改归属不改未交付功能的上线状态（§3.3）。
 */
const OWNERSHIP_OPTIONS = [{ value: FeatureOwnership.Standard, label: "基础版" }, { value: FeatureOwnership.Pro, label: "PRO" }];

export function FeatureCatalogModal({ open, entry, onClose }: { open: boolean; entry: SubscriptionFeatureCatalogEntry | null; onClose: () => void }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm<UpsertFeatureCatalogRequest>();
  const queryClient = useQueryClient();
  const editing = Boolean(entry);

  const mutation = useMutation({
    // contentVersion（§3.3 介绍内容版本）不在本表单维护，编辑时原样带回，避免整体 PUT 把它清空。
    mutationFn: (values: UpsertFeatureCatalogRequest) => subscriptionApi.upsertFeatureCatalog(values.code, { ...values, contentVersion: entry?.contentVersion }),
    onSuccess: () => {
      message.success(t("已保存功能目录项"));
      void queryClient.invalidateQueries({ queryKey: ["subscription", "feature-catalog"] });
      onClose();
    },
    onError: () => message.error(t("保存失败，请稍后重试（后端服务联调中）"))
  });

  const initialValues: Partial<UpsertFeatureCatalogRequest> = entry
    ? { ...entry }
    : { defaultOwnership: FeatureOwnership.Pro, currentOwnership: FeatureOwnership.Pro, releaseStatus: FeatureReleaseStatus.Planned, categories: [] };

  return (
    <Modal open={open} title={editing ? t("编辑功能目录项") : t("新增功能目录项")} okText={t("保存")} confirmLoading={mutation.isPending}
      onOk={() => form.submit()} onCancel={onClose} destroyOnHidden width={560}>
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message={t("当前归属选「基础版」即把该 PRO 功能公共下放给基础版；修改归属不会把未交付功能改成已上线，也不得静默停用基础版既有承诺。")} />
      <Form<UpsertFeatureCatalogRequest> form={form} layout="vertical" initialValues={initialValues} onFinish={(values) => mutation.mutate(values)}>
        <Form.Item name="code" label={t("功能标识")} rules={[{ required: true }]}><Input disabled={editing} placeholder="camera.high_value_handover" /></Form.Item>
        <Form.Item name="name" label={t("名称")} rules={[{ required: true }]}><Input maxLength={64} /></Form.Item>
        <Form.Item name="module" label={t("模块")} rules={[{ required: true }]}><Input maxLength={64} /></Form.Item>
        <Form.Item name="categories" label={t("适用品类")}>
          <Select mode="multiple" allowClear options={[
            { value: "camera", label: t("摄影设备") }, { value: "camping", label: t("露营装备") },
            { value: "vehicle", label: t("车辆载具") }, { value: "construction", label: t("工程设备") }
          ]} />
        </Form.Item>
        <Form.Item name="defaultOwnership" label={t("默认归属")} rules={[{ required: true }]}><Select options={OWNERSHIP_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} /></Form.Item>
        <Form.Item name="currentOwnership" label={t("当前归属（选基础版=公共下放）")} rules={[{ required: true }]}><Select options={OWNERSHIP_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))} /></Form.Item>
        <Form.Item name="releaseStatus" label={t("上线状态")} rules={[{ required: true }]}>
          <Select options={Object.values(FeatureReleaseStatus).map((value) => ({ value, label: t(RELEASE_STATUS_LABEL[value]) }))} />
        </Form.Item>
        <Form.Item name="valueText" label={t("客户价值")}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        <Form.Item name="prerequisiteText" label={t("前提条件")}><Input maxLength={200} /></Form.Item>
        <Form.Item name="externalFeeNote" label={t("外部费用说明")}><Input maxLength={200} /></Form.Item>
        <Form.Item name="reason" label={t("变更原因")}><Input maxLength={200} /></Form.Item>
      </Form>
    </Modal>
  );
}

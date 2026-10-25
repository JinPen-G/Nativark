import { DownloadOutlined, PlusOutlined } from "@/components/ui/icons";
import type { CreateRentalCarrierShipmentEventRequest, RentalCarrierShipmentEvent, RentalOrder } from "@rental-os/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Descriptions, Space, Tag, Timeline } from "antd";
import { App } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, DatePicker, Upload } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button, SaveButton } from "@/components/ui";
import type { UploadFile, UploadProps } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";

type EvidenceFile = UploadFile<{ id: string; mimeType: string }>;

export function CarrierShipmentPanel({ order }: { order: RentalOrder }) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ carrierName: string; trackingNumber: string; occurredAt: dayjs.Dayjs }>();
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const events = useQuery({ queryKey: ["rental-core", "carrier-shipment", order.id], queryFn: () => rentalCoreApi.carrierShipmentEvents(order.id) });
  const signed = events.data?.find((row) => row.type === "customer_signed");
  const outbound = events.data?.find((row) => row.type === "outbound_dispatched");
  const handoff = events.data?.find((row) => row.type === "customer_handoff");
  const nextType: CreateRentalCarrierShipmentEventRequest["type"] | undefined = order.status === "ready_for_pickup" && !outbound
    ? "outbound_dispatched"
    : order.status === "renting" && signed && !handoff ? "customer_handoff" : undefined;

  const createEvent = useMutation({
    mutationFn: (input: CreateRentalCarrierShipmentEventRequest) => rentalCoreApi.createCarrierShipmentEvent(order.id, input, crypto.randomUUID()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rental-core", "carrier-shipment", order.id] });
      setFiles([]);
      form.resetFields();
      form.setFieldValue("occurredAt", dayjs());
      message.success(t("承运里程碑已登记"));
    },
    onError: (error: Error) => message.error(error.message || t("承运里程碑登记失败；请核对时间线与证据"))
  });

  const uploadEvidence: UploadProps["customRequest"] = async (options) => {
    try {
      const file = options.file as File;
      const session = await rentalCoreApi.createCarrierEvidenceUploadSession(order.id, {
        fileName: file.name, mimeType: file.type, sizeBytes: file.size, idempotencyKey: crypto.randomUUID()
      });
      if (session.mode === "provider") {
        if (!session.uploadUrl) throw new Error(t("文件平台未返回上传地址"));
        // 预签名地址是第三方短时凭证；不用带 Authorization 的共享 axios 实例。
        const response = await fetch(session.uploadUrl, { method: "PUT", headers: session.uploadHeaders, body: file });
        if (!response.ok) throw new Error(t("承运凭证上传失败"));
      }
      const asset = await rentalCoreApi.completeCarrierEvidenceUpload(order.id, session.sessionId);
      options.onSuccess?.({ id: asset.id, mimeType: asset.mimeType });
    } catch (error) {
      options.onError?.(error instanceof Error ? error : new Error(t("承运凭证上传失败")));
    }
  };

  const openEvidence = async (fileId: string) => {
    try {
      const file = await rentalCoreApi.carrierEvidenceDownloadUrl(order.id, fileId);
      if (file.mode === "simulation") {
        message.info(t("开发模拟文件没有实际影像内容，配置云存储后可预览"));
        return;
      }
      window.open(file.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("承运凭证读取失败"));
    }
  };

  const onSubmit = async (values: { carrierName: string; trackingNumber: string; occurredAt: dayjs.Dayjs }) => {
    if (!nextType) throw new Error(t("当前订单没有可登记的承运里程碑"));
    const evidenceFileAssetIds = files.filter((file) => file.status === "done").map((file) => file.response?.id).filter((id): id is string => Boolean(id));
    if (!evidenceFileAssetIds.length) {
      message.error(t("请先上传至少一份承运凭证"));
      throw new Error(t("请先上传至少一份承运凭证"));
    }
    return createEvent.mutateAsync({ type: nextType, occurredAt: values.occurredAt.toISOString(), carrierName: values.carrierName, trackingNumber: values.trackingNumber, evidenceFileAssetIds });
  };

  const eventLabels: Record<RentalCarrierShipmentEvent["type"], string> = {
    outbound_dispatched: "已交承运商发出",
    customer_signed: "客户签收（开始计租）",
    customer_handoff: "客户交承运商（停止计租）",
    warehouse_received: "仓库实物验收（释放在途库存）"
  };
  const timelineItems = (events.data ?? []).map((event) => ({
    color: event.type === "customer_signed" || event.type === "warehouse_received" ? "green" : "blue",
    children: <Space orientation="vertical" size={4}>
      <b>{t(eventLabels[event.type])}</b>
      <span>{dayjs(event.occurredAt).format("YYYY-MM-DD HH:mm:ss")} · {event.carrierName} · {event.trackingNumber}</span>
      <Space wrap>{event.evidenceFileAssetIds.map((fileId) => <Button key={fileId} type="link" size="small" icon={<DownloadOutlined />} onClick={() => openEvidence(fileId)}>{t("查看凭证")}</Button>)}</Space>
    </Space>
  }));

  return <Card title={t("承运寄送履约")} extra={<Tag color="processing">{t("库存至仓库验收前持续占用")}</Tag>}>
    <Descriptions size="small" column={{ xs: 1, md: 3 }} items={[
      { key: "start", label: t("计租开始"), children: signed ? dayjs(signed.occurredAt).format("YYYY-MM-DD HH:mm") : t("等待客户签收凭证") },
      { key: "stop", label: t("计租停止"), children: handoff ? dayjs(handoff.occurredAt).format("YYYY-MM-DD HH:mm") : t("等待客户交寄凭证") },
      { key: "inventory", label: t("库存状态"), children: events.data?.some((row) => row.type === "warehouse_received") ? t("仓库已验收") : t("在途占用") }
    ]} />
    <Alert type="info" showIcon title={t("承运延误不计客户租金；时间或凭证无法核实则保持库存占用并人工处理。自营配送不属于承运寄送。")} style={{ margin: "12px 0" }} />
    {events.isError && <Alert type="error" showIcon title={t("承运时间线读取失败，请刷新后重试")} />}
    {timelineItems.length ? <Timeline items={timelineItems} /> : <div className="muted">{t("暂无承运里程碑")}</div>}
    {nextType && <Card size="small" title={t(nextType === "outbound_dispatched" ? "登记发出运单" : "登记客户交寄揽收")}>
      <Form form={form} layout="vertical" onFinish={(values) => { void onSubmit(values).catch(() => undefined); }} initialValues={{ occurredAt: dayjs() }}>
        <Form.Item name="carrierName" label={t("承运商")} rules={[{ required: true, whitespace: true }]}><Input maxLength={120} /></Form.Item>
        <Form.Item name="trackingNumber" label={t("运单号")} rules={[{ required: true, whitespace: true }]}><Input maxLength={191} /></Form.Item>
        <Form.Item name="occurredAt" label={t(nextType === "outbound_dispatched" ? "实际发出时间" : "承运商揽收时间")} rules={[{ required: true }]}><DatePicker showTime style={{ width: "100%" }} disabledDate={(date) => date.isAfter(dayjs(), "day")} /></Form.Item>
        <Form.Item label={t("运单或揽收凭证")} required>
          <Upload accept="image/jpeg,image/png,image/webp,application/pdf" multiple maxCount={5} fileList={files} customRequest={uploadEvidence} onChange={({ fileList }) => setFiles(fileList as EvidenceFile[])}>
            <Button icon={<PlusOutlined />}>{t("上传凭证（图片或 PDF）")}</Button>
          </Upload>
        </Form.Item>
        <SaveButton form={form} pending={createEvent.isPending} label={t("登记里程碑")} onSave={onSubmit} />
      </Form>
    </Card>}
  </Card>;
}

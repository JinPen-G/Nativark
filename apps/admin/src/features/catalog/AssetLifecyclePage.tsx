import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type {
  CreateVehicleAccidentRecordRequest,
  CreateVehicleConditionPhotoRecordRequest,
  CreateVehicleLocationEventRequest,
  CreateVehicleMaintenanceRecordRequest,
  SaveStationCalendarDayRequest,
  SaveVehicleCredentialRequest,
  SaveVehicleOnboardItemRequest,
  StoreStationSummary,
  UpdateVehicleAccidentRecordRequest,
  UpdateVehicleLocationEventRequest,
  UpdateVehicleMaintenanceRecordRequest,
  UpdateVehicleStatusRequest,
  VehicleInstanceSummary
} from "@store-rental/shared";
import { App, Button, Card, Col, Drawer, Form, Input, InputNumber, Row, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/rental";
import {
  createVehicleAccidentRecord,
  createVehicleConditionPhotoRecord,
  createVehicleLocationEvent,
  createVehicleMaintenanceRecord,
  getVehicleDetail,
  listStationCalendar,
  listStationCapacitySnapshots,
  refreshStationCapacitySnapshots,
  saveStationCalendarDay,
  saveVehicleCredential,
  saveVehicleOnboardItem,
  updateVehicleAccidentRecord,
  updateVehicleLocationEvent,
  updateVehicleMaintenanceRecord,
  updateVehicleStatus
} from "@/api/operations";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

type AssetAction = "status" | "location" | "maintenance" | "accident" | "photo" | "credential" | "onboard" | undefined;

export function AssetLifecyclePage() {
  const { message } = App.useApp();
  const operator = useAuthStore((state) => state.user?.displayName ?? "资产管理员");
  const queryClient = useQueryClient();
  const [selectedAsset, setSelectedAsset] = useState<VehicleInstanceSummary>();
  const [selectedStation, setSelectedStation] = useState<StoreStationSummary>();
  const [assetAction, setAssetAction] = useState<AssetAction>();
  const [editingRecordId, setEditingRecordId] = useState<string>();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [actionForm] = Form.useForm<Record<string, unknown>>();
  const [calendarForm] = Form.useForm<SaveStationCalendarDayRequest>();
  const assets = useQuery({ queryKey: ["assets", "lifecycle"], queryFn: () => api.assets({ page: 1, pageSize: 300 }) });
  const stations = useQuery({ queryKey: ["locations", "lifecycle"], queryFn: () => api.locations({ page: 1, pageSize: 300 }) });
  const detail = useQuery({ queryKey: ["asset-detail", selectedAsset?.id], queryFn: () => getVehicleDetail(selectedAsset!.id), enabled: Boolean(selectedAsset) });
  const calendar = useQuery({ queryKey: ["station-calendar", selectedStation?.id], queryFn: () => listStationCalendar(selectedStation!.id), enabled: Boolean(selectedStation) });
  const capacity = useQuery({ queryKey: ["station-capacity", selectedStation?.id], queryFn: () => listStationCapacitySnapshots(selectedStation?.id), enabled: Boolean(selectedStation) });

  const refreshAsset = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["asset-detail", selectedAsset?.id] }), queryClient.invalidateQueries({ queryKey: ["assets"] })]);
  };
  const assetMutation = useMutation({
    mutationFn: async ({ action, values }: { action: Exclude<AssetAction, undefined>; values: Record<string, unknown> }) => {
      if (!selectedAsset) throw new Error("未选择资产");
      const id = selectedAsset.id;
      if (action === "status") return updateVehicleStatus(id, { ...(values as UpdateVehicleStatusRequest), operator });
      if (action === "location") return editingRecordId ? updateVehicleLocationEvent(id, editingRecordId, { ...(values as unknown as UpdateVehicleLocationEventRequest), operator }) : createVehicleLocationEvent(id, { ...(values as unknown as CreateVehicleLocationEventRequest), operator });
      if (action === "maintenance") return editingRecordId ? updateVehicleMaintenanceRecord(id, editingRecordId, { ...(values as unknown as UpdateVehicleMaintenanceRecordRequest), operator }) : createVehicleMaintenanceRecord(id, { ...(values as unknown as CreateVehicleMaintenanceRecordRequest), operator });
      if (action === "accident") return editingRecordId ? updateVehicleAccidentRecord(id, editingRecordId, { ...(values as unknown as UpdateVehicleAccidentRecordRequest), operator }) : createVehicleAccidentRecord(id, { ...(values as unknown as CreateVehicleAccidentRecordRequest), operator });
      if (action === "photo") return createVehicleConditionPhotoRecord(id, { ...(values as unknown as CreateVehicleConditionPhotoRecordRequest), photos: String(values.photoText ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean), operator });
      if (action === "credential") return saveVehicleCredential(id, { ...(values as unknown as SaveVehicleCredentialRequest), attachments: String(values.attachmentText ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean), operator });
      return saveVehicleOnboardItem(id, { ...(values as unknown as SaveVehicleOnboardItemRequest), operator });
    },
    onSuccess: async () => { await refreshAsset(); setAssetAction(undefined); setEditingRecordId(undefined); actionForm.resetFields(); message.success("资产运维记录已保存"); },
    onError: () => message.error("保存失败，请检查资产状态和必填字段")
  });
  const saveCalendar = useMutation({
    mutationFn: (values: SaveStationCalendarDayRequest) => saveStationCalendarDay(selectedStation!.id, { ...values, operator }),
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["station-calendar", selectedStation?.id] }), queryClient.invalidateQueries({ queryKey: ["station-capacity", selectedStation?.id] })]); setCalendarOpen(false); calendarForm.resetFields(); message.success("营业日历已保存"); },
    onError: () => message.error("营业日历保存失败")
  });
  const refreshCapacity = useMutation({
    mutationFn: () => refreshStationCapacitySnapshots(selectedStation?.id),
    onSuccess: async (result) => { await queryClient.invalidateQueries({ queryKey: ["station-capacity", selectedStation?.id] }); message.success(result.message); },
    onError: () => message.error("容量快照刷新失败")
  });

  function openAction(action: Exclude<AssetAction, undefined>, initialValues?: Record<string, unknown>, recordId?: string) {
    const defaults: Record<string, unknown> = {
      status: { operationStatus: selectedAsset?.operationStatus, enabled: selectedAsset?.enabled, reason: "React 资产运维调整" },
      location: { type: "manual_adjust", storeName: selectedAsset?.currentStoreName, stationName: selectedAsset?.currentStationName, mileage: selectedAsset?.mileage, note: "" },
      maintenance: { type: "临时维保", vendor: "门店自检", mileage: selectedAsset?.mileage, costAmount: 0, status: "processing", remark: "" },
      accident: { description: "", claimStatus: "processing", estimatedCostAmount: 0, reportNo: "" },
      photo: { scene: "manual", remark: "", photoText: "" },
      credential: { credentialType: "license", credentialName: "", certNo: "", reminderDays: 30, attachmentText: "" },
      onboard: { category: "key", itemName: "", standardQuantity: 1, actualQuantity: 1, status: "normal", priceAmount: 0, remark: "" }
    }[action] as Record<string, unknown>;
    setEditingRecordId(recordId);
    actionForm.setFieldsValue(initialValues ?? defaults);
    setAssetAction(action);
  }

  const assetOptions = (assets.data?.rows ?? []).map((item) => ({ value: item.id, label: `${item.licensePlate} · ${item.vehicleGroupName}` }));
  const stationOptions = (stations.data?.rows ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.parentStoreName}` }));

  return (
    <>
      <PageHeader title="资产生命周期" description="集中维护车辆品类的状态、位置、证照、随车物品、维保、事故与车况照片，并管理履约点营业日历和容量。" />
      <Card className="tabbed-workspace">
        <Tabs className="standalone-tabs" items={[
          { key: "asset", label: "资产运维", children: <>
            <div className="table-toolbar"><Select showSearch optionFilterProp="label" placeholder="选择资产" style={{ width: 360 }} options={assetOptions} value={selectedAsset?.id} onChange={(id) => setSelectedAsset(assets.data?.rows.find((item) => item.id === id))} /><Space wrap>{(["status", "location", "maintenance", "accident", "photo", "credential", "onboard"] as const).map((action) => <Button key={action} disabled={!selectedAsset} onClick={() => openAction(action)}>{({ status: "调整状态", location: "位置流水", maintenance: "新增维保", accident: "事故记录", photo: "车况照片", credential: "证照", onboard: "随车物品" } as const)[action]}</Button>)}</Space></div>
            <QueryState loading={detail.isLoading} error={detail.error}>{detail.data ? <Tabs items={[
              { key: "summary", label: "概览", children: <Row gutter={[16, 16]}><Col span={24}><Typography.Text strong>{detail.data.vehicle.licensePlate}</Typography.Text><Typography.Text type="secondary"> · {detail.data.vehicle.currentStoreName} / {detail.data.vehicle.currentStationName}</Typography.Text></Col></Row> },
              { key: "credentials", label: `证照 ${detail.data.credentialRecords.length}`, children: <Table rowKey="id" dataSource={detail.data.credentialRecords} columns={[{ title: "证照", dataIndex: "credentialName" }, { title: "编号", dataIndex: "certNo" }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "到期日", dataIndex: "expiresAt", render: (value) => value ?? "—" }, { title: "操作人", dataIndex: "operator" }]} /> },
              { key: "onboard", label: `随车物品 ${detail.data.onboardItems.length}`, children: <Table rowKey="id" dataSource={detail.data.onboardItems} columns={[{ title: "物品", dataIndex: "itemName" }, { title: "分类", dataIndex: "category" }, { title: "标准 / 实际", render: (_, record) => `${record.standardQuantity} / ${record.actualQuantity}` }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "赔付金额", dataIndex: "priceAmount" }]} /> },
              { key: "maintenance", label: `维保 ${detail.data.maintenanceRecords.length}`, children: <Table rowKey="id" dataSource={detail.data.maintenanceRecords} columns={[{ title: "日期", dataIndex: "date" }, { title: "类型", dataIndex: "type" }, { title: "厂商", dataIndex: "vendor" }, { title: "费用", dataIndex: "costAmount" }, { title: "状态", dataIndex: "status", render: (value) => <Tag>{value}</Tag> }, { title: "操作", render: (_, record) => <Button type="link" onClick={() => openAction("maintenance", record as unknown as Record<string, unknown>, record.id)}>编辑</Button> }]} /> },
              { key: "accident", label: `事故 ${detail.data.accidentRecords.length}`, children: <Table rowKey="id" dataSource={detail.data.accidentRecords} columns={[{ title: "日期", dataIndex: "date" }, { title: "报案号", dataIndex: "reportNo" }, { title: "说明", dataIndex: "description" }, { title: "预估费用", dataIndex: "estimatedCostAmount" }, { title: "状态", dataIndex: "claimStatus", render: (value) => <Tag>{value}</Tag> }, { title: "操作", render: (_, record) => <Button type="link" onClick={() => openAction("accident", record as unknown as Record<string, unknown>, record.id)}>编辑</Button> }]} /> },
              { key: "location", label: `位置 ${detail.data.locationEvents.length}`, children: <Table rowKey="id" dataSource={detail.data.locationEvents} columns={[{ title: "时间", dataIndex: "at" }, { title: "类型", dataIndex: "type" }, { title: "位置", render: (_, record) => `${record.storeName} / ${record.stationName}` }, { title: "里程", dataIndex: "mileage" }, { title: "说明", dataIndex: "note" }, { title: "操作", render: (_, record) => <Button type="link" onClick={() => openAction("location", record as unknown as Record<string, unknown>, record.id)}>编辑</Button> }]} /> },
              { key: "photos", label: `照片 ${detail.data.conditionPhotos.length}`, children: <Table rowKey="id" dataSource={detail.data.conditionPhotos} columns={[{ title: "时间", dataIndex: "at" }, { title: "场景", dataIndex: "scene" }, { title: "说明", dataIndex: "remark" }, { title: "图片数", dataIndex: "photos", render: (values: string[]) => values.length }]} /> }
            ]} /> : <Typography.Text type="secondary">请选择资产查看生命周期记录。</Typography.Text>}</QueryState>
          </> },
          { key: "station", label: "营业与容量", children: <>
            <div className="table-toolbar"><Select showSearch optionFilterProp="label" placeholder="选择履约点" style={{ width: 360 }} options={stationOptions} value={selectedStation?.id} onChange={(id) => setSelectedStation(stations.data?.rows.find((item) => item.id === id))} /><Space><Button icon={<PlusOutlined />} disabled={!selectedStation} onClick={() => { calendarForm.setFieldsValue({ date: new Date().toISOString().slice(0, 10), businessStatus: "open", openTime: "09:00", closeTime: "20:00", capacityLimit: selectedStation?.parkingTotal, note: "" }); setCalendarOpen(true); }}>维护营业日</Button><Button icon={<ReloadOutlined />} disabled={!selectedStation} loading={refreshCapacity.isPending} onClick={() => refreshCapacity.mutate()}>刷新容量</Button></Space></div>
            <QueryState loading={calendar.isLoading || capacity.isLoading} error={calendar.error ?? capacity.error}>{selectedStation ? <Tabs items={[
              { key: "calendar", label: "营业日历", children: <Table rowKey="id" dataSource={calendar.data ?? []} columns={[{ title: "日期", dataIndex: "date" }, { title: "状态", dataIndex: "businessStatus", render: (value) => <Tag>{value}</Tag> }, { title: "营业时间", render: (_, record) => `${record.openTime} - ${record.closeTime}` }, { title: "容量上限", dataIndex: "capacityLimit" }, { title: "说明", dataIndex: "note" }]} /> },
              { key: "capacity", label: "容量快照", children: <Table rowKey="id" dataSource={capacity.data ?? []} scroll={{ x: 1050 }} columns={[{ title: "日期", dataIndex: "date" }, { title: "总车位", dataIndex: "totalSpaces" }, { title: "可用", dataIndex: "availableSpaces" }, { title: "已占用", dataIndex: "occupiedVehicles" }, { title: "领取队列", dataIndex: "pickupQueueVehicles" }, { title: "归还队列", dataIndex: "returnQueueVehicles" }, { title: "预计等待", dataIndex: "estimatedWaitMinutes", render: (value) => `${value} 分钟` }, { title: "压力", dataIndex: "pressureLevel", render: (value) => <Tag color={value === "overloaded" ? "error" : value === "busy" ? "warning" : "success"}>{value}</Tag> }]} /> }
            ]} /> : <Typography.Text type="secondary">请选择履约点查看营业日历和容量快照。</Typography.Text>}</QueryState>
          </> }
        ]} />
      </Card>

      <Drawer title={editingRecordId ? "编辑资产运维记录" : "资产运维操作"} open={Boolean(assetAction)} width={560} destroyOnHidden onClose={() => { setAssetAction(undefined); setEditingRecordId(undefined); }} extra={<Button type="primary" loading={assetMutation.isPending} onClick={() => actionForm.submit()}>保存</Button>}>
        <Form form={actionForm} layout="vertical" onFinish={(values) => assetAction && assetMutation.mutate({ action: assetAction, values })}>
          {assetAction === "status" && <><Form.Item name="operationStatus" label="运营状态"><Select options={["idle", "reserved", "renting", "controlled", "maintenance", "disabled"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="enabled" label="启用状态"><Select options={[{ value: true, label: "启用" }, { value: false, label: "停用" }]} /></Form.Item><Form.Item name="reason" label="原因" rules={[{ required: true }]}><Input.TextArea /></Form.Item></>}
          {assetAction === "location" && <><Form.Item name="type" label="事件类型"><Select options={["pickup", "return", "transfer", "manual_adjust", "iot_sync"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="storeName" label="门店" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="stationName" label="履约点" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="mileage" label="里程"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="note" label="说明"><Input.TextArea /></Form.Item></>}
          {assetAction === "maintenance" && <><Form.Item name="type" label="维保类型"><Input /></Form.Item><Form.Item name="vendor" label="厂商 / 门店"><Input /></Form.Item><Form.Item name="mileage" label="里程"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="costAmount" label="费用"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item><Form.Item name="status" label="状态"><Select options={["pending", "processing", "completed"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="remark" label="说明"><Input.TextArea /></Form.Item></>}
          {assetAction === "accident" && <><Form.Item name="claimStatus" label="理赔状态"><Select options={["pending", "processing", "closed"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="estimatedCostAmount" label="预估费用"><InputNumber min={0} precision={2} style={{ width: "100%" }} /></Form.Item><Form.Item name="reportNo" label="报案号"><Input /></Form.Item><Form.Item name="description" label="事故说明" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item></>}
          {assetAction === "photo" && <><Form.Item name="scene" label="场景"><Select options={["pickup", "return", "maintenance", "manual"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="remark" label="说明" rules={[{ required: true }]}><Input.TextArea /></Form.Item><Form.Item name="photoText" label="图片地址（每行一个）" rules={[{ required: true }]}><Input.TextArea rows={5} /></Form.Item></>}
          {assetAction === "credential" && <><Form.Item name="credentialType" label="证照类型"><Select options={["license", "insurance", "inspection", "permit", "other"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="credentialName" label="证照名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="certNo" label="证件编号" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="status" label="状态"><Select allowClear options={["valid", "expiring", "expired", "missing"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="expiresAt" label="到期时间"><Input placeholder="ISO 时间" /></Form.Item><Form.Item name="reminderDays" label="提前提醒天数"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="attachmentText" label="附件地址（每行一个）"><Input.TextArea /></Form.Item></>}
          {assetAction === "onboard" && <><Form.Item name="category" label="物品分类"><Select options={["key", "document", "equipment", "cleaning", "other"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="itemName" label="物品名称" rules={[{ required: true }]}><Input /></Form.Item><Row gutter={12}><Col span={8}><Form.Item name="standardQuantity" label="标准数量"><InputNumber min={0} /></Form.Item></Col><Col span={8}><Form.Item name="actualQuantity" label="实际数量"><InputNumber min={0} /></Form.Item></Col><Col span={8}><Form.Item name="priceAmount" label="赔付金额"><InputNumber min={0} /></Form.Item></Col></Row><Form.Item name="status" label="状态"><Select options={["normal", "missing", "damaged"].map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="remark" label="备注"><Input.TextArea /></Form.Item></>}
        </Form>
      </Drawer>
      <Drawer title={`维护营业日 · ${selectedStation?.name ?? ""}`} open={calendarOpen} width={460} destroyOnHidden onClose={() => setCalendarOpen(false)} extra={<Button type="primary" loading={saveCalendar.isPending} onClick={() => calendarForm.submit()}>保存</Button>}>
        <Form form={calendarForm} layout="vertical" onFinish={(values) => saveCalendar.mutate(values)}><Form.Item name="date" label="日期" rules={[{ required: true }]}><Input placeholder="YYYY-MM-DD" /></Form.Item><Form.Item name="businessStatus" label="营业状态"><Select options={["open", "paused", "closed"].map((value) => ({ value, label: value }))} /></Form.Item><Row gutter={12}><Col span={12}><Form.Item name="openTime" label="开始时间"><Input placeholder="09:00" /></Form.Item></Col><Col span={12}><Form.Item name="closeTime" label="结束时间"><Input placeholder="20:00" /></Form.Item></Col></Row><Form.Item name="capacityLimit" label="容量上限"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item><Form.Item name="note" label="说明"><Input.TextArea /></Form.Item></Form>
      </Drawer>
    </>
  );
}

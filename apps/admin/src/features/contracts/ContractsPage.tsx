import { FileAddOutlined, PrinterOutlined, SignatureOutlined } from "@ant-design/icons";
import type { StoreRentalContractCenterQuery, StoreRentalContractCenterRow } from "@store-rental/shared";
import { Alert, App, Button, Card, Col, Drawer, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api/rental";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useAuthStore } from "@/features/auth/authStore";

const typeLabels: Record<string, string> = { rental_contract: "租赁合同", pickup_sheet: "领取单", return_sheet: "归还单", settlement_sheet: "结算单" };
const statusLabels: Record<string, string> = { pending: "待签署", signed: "已签署", fallback_uploaded: "线下回传", voided: "已作废" };

export function ContractsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const operator = useAuthStore((state) => state.user?.displayName ?? "运营用户");
  const [filters, setFilters] = useState<StoreRentalContractCenterQuery>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [signing, setSigning] = useState<StoreRentalContractCenterRow>();
  const [createForm] = Form.useForm();
  const [signForm] = Form.useForm();
  const [searchParams, setSearchParams] = useSearchParams();
  const contracts = useQuery({ queryKey: ["contracts", filters], queryFn: () => api.contracts(filters) });
  const orders = useQuery({ queryKey: ["orders"], queryFn: api.orders });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["contracts"] });
  const createContract = useMutation({ mutationFn: ({ orderId, values }: { orderId: string; values: Record<string, string> }) => api.createContract(orderId, {
    type: values.type as "rental_contract" | "pickup_sheet" | "return_sheet" | "settlement_sheet",
    title: values.title,
    status: "pending",
    signMethod: values.signMethod as "app" | "counter" | "offline_paper" | "system",
    templateCode: values.type,
    operator
  }), onSuccess: async () => { await refresh(); setCreateOpen(false); createForm.resetFields(); message.success("合同文档已生成"); }, onError: () => message.error("合同生成失败") });
  const printContract = useMutation({ mutationFn: (record: StoreRentalContractCenterRow) => api.printContract(record.id, { operator, mode: "print" }), onSuccess: async (result) => { await refresh(); Modal.success({ title: "模拟打印文件已生成", content: result.message }); }, onError: () => message.error("模拟打印失败") });
  const signContract = useMutation({ mutationFn: ({ record, values }: { record: StoreRentalContractCenterRow; values: Record<string, string> }) => api.signContract(record.id, { operator, signerName: values.signerName, signMethod: values.signMethod as "app" | "counter" | "offline_paper" | "system", fileUrl: values.fileUrl }), onSuccess: async (result) => { await refresh(); setSigning(undefined); signForm.resetFields(); message.success(result.message); }, onError: () => message.error("模拟签署失败") });

  useEffect(() => {
    const orderId = searchParams.get("orderId");
    if (!orderId) return;
    createForm.setFieldValue("orderId", orderId);
    setCreateOpen(true);
    setSearchParams({}, { replace: true });
  }, [createForm, searchParams, setSearchParams]);

  function confirmPrint(record: StoreRentalContractCenterRow) {
    modal.confirm({
      title: `生成 ${record.documentNo} 的模拟打印文件？`,
      content: "当前打印提供方为 reserved/mock，不会调用真实电子合同或打印服务。",
      okText: "继续生成",
      onOk: () => printContract.mutateAsync(record)
    });
  }

  const stats = contracts.data?.stats;
  return (
    <>
      <PageHeader title="合同与单据" description="集中管理租赁合同、领取单、归还单和结算单。电子签章与打印当前是后端 mock 能力。" extra={<Button type="primary" icon={<FileAddOutlined />} onClick={() => setCreateOpen(true)}>生成合同</Button>} />
      <Alert type="warning" showIcon message="外部电子合同尚未接入" description="“模拟打印”和“模拟签署”仅验证业务留痕与状态流转，不代表真实文件已送达或具备法律效力。" style={{ marginBottom: 16 }} />
      <Row className="page-metrics" gutter={[16, 16]}>
        {[
          ["文档总数", stats?.total ?? 0], ["待签署", stats?.pending ?? 0], ["已签署", stats?.signed ?? 0], ["已生成打印", stats?.printed ?? 0]
        ].map(([label, value]) => <Col xs={12} lg={6} key={String(label)}><Card className="data-panel"><Statistic title={label} value={value} /></Card></Col>)}
      </Row>
      <Card className="data-panel" styles={{ body: { paddingBottom: 0 } }}>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search allowClear placeholder="合同号、订单号、客户" style={{ width: 280 }} onSearch={(keyword) => setFilters((value) => ({ ...value, keyword: keyword || undefined }))} />
          <Select allowClear placeholder="文档类型" style={{ width: 150 }} onChange={(type) => setFilters((value) => ({ ...value, type }))} options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))} />
          <Select allowClear placeholder="签署状态" style={{ width: 150 }} onChange={(status) => setFilters((value) => ({ ...value, status }))} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} />
        </Space>
        <QueryState loading={contracts.isLoading} error={contracts.error}>
          <Table<StoreRentalContractCenterRow>
            rowKey="id"
            scroll={{ x: 1350 }}
            dataSource={contracts.data?.rows ?? []}
            columns={[
              { title: "文档编号", dataIndex: "documentNo", fixed: "left", render: (value, record) => <><b>{value}</b><br /><span className="muted">{typeLabels[record.type]}</span></> },
              { title: "订单", dataIndex: "orderNo" },
              { title: "客户", render: (_, record) => <>{record.customerName}<br /><span className="muted">{record.customerPhoneMasked}</span></> },
              { title: "租赁标的", render: (_, record) => <>{record.vehicleGroupName}<br /><span className="muted">{record.plateNo ?? "待分配"}</span></> },
              { title: "领取 / 归还", render: (_, record) => <>{record.pickupStoreName}<br /><span className="muted">→ {record.returnStoreName}</span></> },
              { title: "签署状态", dataIndex: "status", render: (value) => <Tag color={value === "signed" ? "success" : value === "pending" ? "warning" : "default"}>{statusLabels[value] ?? value}</Tag> },
              { title: "打印状态", dataIndex: "printStatus", render: (value) => <Tag>{value ?? "not_generated"}</Tag> },
              { title: "创建时间", dataIndex: "createdAt" },
              { title: "操作", fixed: "right", width: 210, render: (_, record) => <Space size={0}><Button type="link" icon={<PrinterOutlined />} loading={printContract.isPending} onClick={() => confirmPrint(record)}>模拟打印</Button><Button type="link" icon={<SignatureOutlined />} disabled={record.status === "signed" || record.status === "voided"} onClick={() => { signForm.setFieldsValue({ signerName: record.customerName, signMethod: "counter" }); setSigning(record); }}>模拟签署</Button></Space> }
            ]}
          />
        </QueryState>
      </Card>

      <Drawer title="生成订单合同" open={createOpen} width={480} destroyOnHidden onClose={() => setCreateOpen(false)} extra={<Button type="primary" loading={createContract.isPending} onClick={() => createForm.submit()}>生成</Button>}>
        <Form form={createForm} layout="vertical" initialValues={{ type: "rental_contract", signMethod: "counter" }} onFinish={(values) => createContract.mutate({ orderId: values.orderId, values })}>
          <Form.Item name="orderId" label="关联订单" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={(orders.data ?? []).map((item) => ({ value: item.id, label: `${item.orderNo} · ${item.customerName} · ${item.vehicleGroupName}` }))} /></Form.Item>
          <Form.Item name="type" label="文档类型" rules={[{ required: true }]}><Select options={Object.entries(typeLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="title" label="文档标题"><Input placeholder="留空时由模板生成" /></Form.Item>
          <Form.Item name="signMethod" label="签署方式" rules={[{ required: true }]}><Select options={[{ value: "counter", label: "柜台签署" }, { value: "app", label: "App 签署（预留）" }, { value: "offline_paper", label: "线下纸质" }, { value: "system", label: "系统生成" }]} /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title={`模拟签署 · ${signing?.documentNo ?? ""}`} open={Boolean(signing)} width={440} destroyOnHidden onClose={() => setSigning(undefined)} extra={<Button type="primary" loading={signContract.isPending} onClick={() => signForm.submit()}>确认模拟签署</Button>}>
        <Alert type="info" showIcon message="此操作不会调用真实签章服务" style={{ marginBottom: 20 }} />
        <Form form={signForm} layout="vertical" onFinish={(values) => signing && signContract.mutate({ record: signing, values })}>
          <Form.Item name="signerName" label="签署人" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="signMethod" label="签署方式" rules={[{ required: true }]}><Select options={[{ value: "counter", label: "柜台签署" }, { value: "offline_paper", label: "线下纸质" }, { value: "app", label: "App（预留）" }]} /></Form.Item>
          <Form.Item name="fileUrl" label="回传文件地址"><Input placeholder="可选；用于模拟线下文件回传" /></Form.Item>
        </Form>
      </Drawer>
    </>
  );
}

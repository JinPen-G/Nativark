import { useOrderEditor } from "../orders/useOrderEditor";
import { CorePage } from "@rental-os/platform-admin/core";
import { useRentalMembershipContext, useRentalMembershipSession } from "./page-context";
import type { SaveCustomerMembershipQualificationTypeRequest } from "@rental-os/rental-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "@rental-os/platform-admin/ui";
import { Checkbox } from "@rental-os/platform-admin/ui";
import { Form } from "@rental-os/platform-admin/ui";
import { Alert, Table } from "@rental-os/platform-admin/ui";
import { Input } from "@rental-os/platform-admin/ui";
import {
  DataTableStatus,
  ListFilterItem,
  ListFilters,
  Modal,
  useListFilter,
} from "@rental-os/platform-admin/ui";
import { useState } from "react";
import { useLocale } from "@rental-os/platform-admin/locale";
import { QueryState } from "@rental-os/platform-admin/ui";
import { Col, Row } from "antd";
import { Button, InfoPopover } from "@rental-os/platform-admin/ui";
import { InfoCircleOutlined, PlusOutlined } from "@rental-os/platform-admin/ui";

export function QualificationTypesEditor({ standalone = false }: { standalone?: boolean } = {}) {
  const { api: membershipApi } = useRentalMembershipContext();

  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const workspaceId = useRentalMembershipSession((state) => state.currentWorkspaceId);
  const hasPermission = useRentalMembershipSession((state) => state.hasPermission);
  // 证件类型是当前经营空间的业务配置，走专属的空间级权限。服务端写入只认新码，
  // 页面的编辑入口与之对齐：member:manage / member:view 只开放查看，不再显示一个保存后必 403 的表单。
  const canManage = Boolean(workspaceId) && hasPermission("rental-os:qualification-type:manage");
  const canView =
    canManage ||
    (Boolean(workspaceId) &&
      (hasPermission("rental-os:member:manage") || hasPermission("rental-os:member:view")));
  const [form] = Form.useForm<SaveCustomerMembershipQualificationTypeRequest>();
  const [editorOpen, setEditorOpen] = useState(false);
  const types = useQuery({
    queryKey: ["membership-qualification-types", workspaceId],
    queryFn: membershipApi.qualificationTypes,
    enabled: canView,
  });
  const filter = useListFilter(types.data, {
    fields: (row) => [row.name, row.code],
    status: (row) => row.status,
  });
  const save = useMutation({
    mutationFn: membershipApi.saveQualificationType,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["membership-qualification-types", workspaceId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["membership-qualification-options", workspaceId],
      });
      form.resetFields();
      setEditorOpen(false);
      message.success(t("证件类型已保存"));
    },
  });
  const createAction = (
    <Button
      type="primary"
      disabled={!canManage || types.isLoading || Boolean(types.error)}
      icon={<PlusOutlined />}
      onClick={() => {
        form.resetFields();
        setEditorOpen(true);
      }}
    >
      {t("新增证件类型")}
    </Button>
  );
  const scopeTitle = t("仅配置当前经营空间");
  const scopeDescription = t(
    "这里维护本空间使用的证件类型；不授予租户会员资料维护权，也不改变已提交的证件与审核历史。",
  );
  const header = standalone ? (
    <CorePage
      title={t("空间证件类型")}
      note={{ title: scopeTitle, description: scopeDescription }}
      actions={
        canView
          ? [
              {
                id: "create-qualification-type",
                kind: "open",
                emphasis: "primary",
                label: t("新增证件类型"),
                icon: <PlusOutlined />,
                disabled: !canManage || types.isLoading || Boolean(types.error),
                open: () => {
                  form.resetFields();
                  setEditorOpen(true);
                },
              },
            ]
          : []
      }
      children={null}
    />
  ) : null;

  const typeEditor = useOrderEditor({
    form: form,
    identity: editorOpen ? JSON.stringify([workspaceId, "qualification-type"]) : undefined,
    disabled: !canManage,
    onSave: (values) => {
      if (!canManage) return Promise.reject(new Error(t("当前操作不可用")));
      return save.mutateAsync(values);
    },
  });
  if (!canView)
    return (
      <>
        {header}
        <Alert type="warning" title={t("需要当前空间的证件配置权限")} />
      </>
    );
  return (
    <>
      {header}
      <QueryState
        loading={types.isLoading}
        error={types.error}
        onRetry={() => types.refetch({ throwOnError: true })}
      >
        <Table
          toolbar={
            <>
              <ListFilters
                filter={filter}
                placeholder="证件名称或编码"
                options={[
                  { value: "enabled", label: "已启用" },
                  { value: "disabled", label: "已停用" },
                ]}
              />
              {!standalone && <ListFilterItem kind="action">{createAction}</ListFilterItem>}
              {!standalone && (
                <ListFilterItem kind="action">
                  <InfoPopover title={scopeTitle} content={scopeDescription}>
                    <Button
                      type="text"
                      size="small"
                      aria-label={t("配置范围")}
                      icon={<InfoCircleOutlined />}
                    />
                  </InfoPopover>
                </ListFilterItem>
              )}
            </>
          }
          emptyScene={filter.keyword || filter.status ? "search" : "empty"}
          exportConfig={{
            filename: t("证件类型"),
            fields: [
              { label: t("名称"), value: (row) => row.name },
              { label: t("编码"), value: (row) => row.code },
              { label: t("下单要求"), value: (row) => t(row.requiredForBooking ? "必需" : "可选") },
              {
                label: t("状态"),
                value: (row) => t(row.status === "enabled" ? "已启用" : "已停用"),
              },
            ],
          }}
          rowKey="id"
          size="small"
          onRefresh={() => types.refetch()}
          loading={types.isLoading}
          refreshing={types.isFetching}
          dataSource={filter.rows}
          pagination={filter.pagination}
          columns={[
            { title: t("名称"), dataIndex: "name" },
            { title: t("编码"), dataIndex: "code" },
            {
              title: t("下单要求"),
              render: (_, row) => (row.requiredForBooking ? t("必需") : t("可选")),
            },
            {
              title: t("状态"),
              dataIndex: "status",
              render: (value) => (
                <DataTableStatus variant="soft" tone={value === "enabled" ? "success" : "neutral"}>
                  {t(value === "enabled" ? "已启用" : "已停用")}
                </DataTableStatus>
              ),
            },
          ]}
        />
        <Modal
          title={t("新增证件类型")}
          open={editorOpen}
          onCancel={() => typeEditor.dismiss(() => setEditorOpen(false))}
          okText={t("新增证件类型")}
          confirmLoading={save.isPending}
          okButtonProps={{ disabled: !canManage }}
          cancelButtonProps={{ disabled: save.isPending }}
          closable={!save.isPending}
          keyboard={!save.isPending}
          maskClosable={!save.isPending}
          destroyOnHidden
          onConfirm={typeEditor.confirm}
        >
          <p className="text-meta">
            {t(
              "这里维护本空间使用的证件类型；不授予租户会员资料维护权，也不改变已提交的证件与审核历史。",
            )}
          </p>
          <Form
            {...typeEditor.formProps}
            form={form}
            layout="vertical"
            disabled={!canManage || save.isPending}
          >
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item label={t("名称")} name="name" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label={t("编码")} name="code" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="requiredForBooking" valuePropName="checked">
              <Checkbox>{t("下单必需")}</Checkbox>
            </Form.Item>
          </Form>
        </Modal>
      </QueryState>
    </>
  );
}

export function QualificationTypesPage() {
  return <QualificationTypesEditor standalone />;
}

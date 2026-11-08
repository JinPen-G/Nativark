import { ListFilters, useListFilter } from "@/components/ui";
import { DataTableRowActions, DataTableText, DatePicker, FormSection, ListSection, SaveButton } from "@/components/ui";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { CalendarPlus, Pencil } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Tag, Typography } from "antd";
import { App, Modal } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button } from "@/components/ui";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import type { OfficialCalendarSource, RegisterOfficialCalendarSourceVersionRequest } from "@rental-os/shared";
import { officialCalendarApi } from "@/api/officialCalendar";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";

/**
 * 公共官方日历来源（需求 4.5.2/4.5.8）。
 *
 * 这是 SaaS 平台管理员的页面：官方节假日数据是**跨租户的公共基础来源**，
 * 在这里登记来源与年度来源版本；租户经营空间只能引用某个来源版本生成自己的年度草稿，
 * 再由有权限的空间人员确认发布。平台侧不能替租户发布空间日历，也看不到空间业务数据。
 */
export function OfficialCalendarSourcePage() {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [sourceEditor, setSourceEditor] = useState<OfficialCalendarSource | null>();
  const [versionTarget, setVersionTarget] = useState<OfficialCalendarSource>();
  const [expanded, setExpanded] = useState<string>();
  const [sourceForm] = Form.useForm<{ name: string; url: string; notes?: string; isActive: boolean }>();
  const [versionForm] = Form.useForm<{ year: number; publishedAt: Dayjs; daysText: string }>();
  const sourceDialog = useModalDismissal(sourceEditor !== undefined, () => setSourceEditor(undefined));
  const versionDialog = useModalDismissal(Boolean(versionTarget), () => { setVersionTarget(undefined); versionForm.resetFields(); });

  const sources = useQuery({ queryKey: ["official-calendars"], queryFn: officialCalendarApi.sources });
  const sourceFilter = useListFilter(sources.data, { fields: row => [row.name, row.url] });
  const versions = useQuery({
    queryKey: ["official-calendar-versions", expanded],
    queryFn: () => officialCalendarApi.versions(expanded!),
    enabled: Boolean(expanded)
  });

  const saveSource = useMutation({
    mutationFn: (values: { name: string; url: string; notes?: string; isActive: boolean }) =>
      officialCalendarApi.saveSource({
        id: sourceEditor?.id,
        region: "CN",
        name: values.name,
        url: values.url,
        notes: values.notes,
        isActive: values.isActive
      }),
    onSuccess: async () => {
      sourceDialog.dismiss();
      await queryClient.invalidateQueries({ queryKey: ["official-calendars"] });
      message.success(t("官方来源已保存"));
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t("保存失败")
      )
  });

  const registerVersion = useMutation({
    mutationFn: (values: { year: number; publishedAt: Dayjs; daysText: string }) =>
      officialCalendarApi.registerVersion(versionTarget!.id, {
        year: Number(values.year),
        publishedAt: new Date(values.publishedAt.format("YYYY-MM-DD")).toISOString(),
        days: JSON.parse(values.daysText)
      }),
    onSuccess: async (created) => {
      versionDialog.dismiss();
      await queryClient.invalidateQueries({ queryKey: ["official-calendar-versions"] });
      message.success(`${t("已登记来源版本")} v${created.version}，${t("租户空间可以引用它生成草稿")}`);
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          t("登记失败：请检查年度、发布日期与日期数组")
      )
  });
  const dateArrayRule = { validator: async (_rule: unknown, text: string) => {
    let dates: RegisterOfficialCalendarSourceVersionRequest["days"];
    try { dates = JSON.parse(text); } catch { throw new Error(t("请输入有效的日期 JSON 数组")); }
    if (!Array.isArray(dates) || !dates.length) throw new Error(t("请至少填写一条官方日期"));
    const year = versionForm.getFieldValue("year");
    const seen = new Set<string>();
    for (const date of dates) {
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date.date) || !dayjs(date.date).isValid() || dayjs(date.date).format("YYYY-MM-DD") !== date.date || !date.date.startsWith(`${year}-`)
        || !["statutory_holiday", "makeup_workday"].includes(date.dayType) || typeof date.name !== "string" || !date.name.trim() || seen.has(date.date)) throw new Error(t("日期须在所选年度内且不能重复，填写法定节假日或调休工作日及名称"));
      seen.add(date.date);
    }
  } };

  return (
    <>
      <PageHeader
        title={t("公共官方日历来源")}
        description={t("租户引用官方来源后，仍需自行确认发布日历。")}
        note={{
          title: t("官方数据是公共基础来源，导入不会自动影响任何经营空间"),
          description: t("官方再次调整时请登记新的来源版本；已发布的空间日历、有效报价和订单继续指向它们各自引用的那一版，不会被静默覆盖。")
        }}
        extra={
          <Button
            type="primary"
            onClick={() => {
              sourceForm.resetFields();
              sourceForm.setFieldsValue({ name: "", url: "", notes: "", isActive: true });
              setSourceEditor(null);
            }}
          >
            {t("登记来源")}
          </Button>
        }
      />
      <QueryState loading={sources.isLoading} error={sources.error} onRetry={() => sources.refetch({ throwOnError: true })}>
        <ListSection controls={<ListFilters filter={sourceFilter} placeholder="来源名称或网址" />}>
          <Table<OfficialCalendarSource>
            rowKey="id"
            size="small"
            onRefresh={() => sources.refetch()} loading={sources.isLoading} refreshing={sources.isFetching} dataSource={sourceFilter.rows}
            pagination={sourceFilter.pagination}
            expandable={{
              expandedRowKeys: expanded ? [expanded] : [],
              onExpand: (open, row) => setExpanded(open ? row.id : undefined),
              expandedRowRender: () => (
                <QueryState loading={versions.isLoading} error={versions.error} onRetry={() => versions.refetch({ throwOnError: true })}>
                  <Table
                    rowKey="id"
                    size="small"
                    onRefresh={() => versions.refetch()} loading={versions.isLoading} refreshing={versions.isFetching} dataSource={versions.data ?? []}
                    pagination={false}
                    locale={{ emptyText: t("该来源尚未登记任何年度版本") }}
                    columns={[
                      { title: t("年度"), dataIndex: "year", width: 90 },
                      { title: t("来源版本"), dataIndex: "version", width: 110, render: (value) => `v${value}` },
                      {
                        title: t("官方发布日期"),
                        dataIndex: "publishedAt",
                        width: 140,
                        render: (value) => dayjs(value as string).format("YYYY-MM-DD")
                      },
                      { title: t("日期条数"), dataIndex: "dayCount", width: 100 },
                      {
                        title: t("入库时间"),
                        dataIndex: "importedAt",
                        render: (value) => dayjs(value as string).format("YYYY-MM-DD HH:mm")
                      },
                      { title: t("登记人"), dataIndex: "importedBy", render: (value) => value ?? "—" }
                    ]}
                  />
                </QueryState>
              )
            }}
            columns={[
              { title: t("来源名称"), render: (_, row) => <DataTableText primary={row.name} secondary={row.region === "CN" ? t("中国大陆") : row.region} /> },
              {
                title: t("公告地址"),
                dataIndex: "url",
                render: (value) => (
                  <Typography.Text copyable className="text-meta">
                    {value}
                  </Typography.Text>
                )
              },
              {
                title: t("状态"),
                dataIndex: "isActive",
                width: 90,
                render: (value) => <Tag color={value ? "success" : "default"}>{value ? t("启用") : t("停用")}</Tag>
              },
              {
                title: t("操作"),
                render: (_, row) => {
                  const edit = () => {
                        sourceForm.resetFields();
                        sourceForm.setFieldsValue({
                          name: row.name,
                          url: row.url,
                          notes: row.notes ?? "",
                          isActive: row.isActive
                        });
                        setSourceEditor(row);
                  };
                  const register = () => {
                        versionForm.resetFields();
                        versionForm.setFieldsValue({
                          year: new Date().getFullYear() + 1,
                          daysText: "[]",
                        });
                        setVersionTarget(row);
                  };
                  return <DataTableRowActions details={edit} detailLabel={t("编辑来源")} menuLabel={`${row.name} · ${t("更多操作")}`}
                    primary={{ id: "version", label: t("登记年度版本"), icon: CalendarPlus, onSelect: register }} actions={[{ id: "edit", label: t("编辑来源"), icon: Pencil, onSelect: edit }]} />;
                }
              }
            ]}
          />
        </ListSection>
      </QueryState>
      <Modal
        title={sourceEditor ? `${t("编辑来源")}：${sourceEditor.name}` : t("登记官方来源")}
        open={sourceDialog.visible}
        onCancel={sourceDialog.dismiss}
        afterClose={sourceDialog.afterClose}
        width={520}
        closable={!saveSource.isPending} keyboard={!saveSource.isPending} maskClosable={!saveSource.isPending}
        destroyOnHidden
        footer={<><Button disabled={saveSource.isPending} onClick={sourceDialog.dismiss}>{t("取消")}</Button><SaveButton label={t("保存")} form={sourceForm} pending={saveSource.isPending} onSave={values => saveSource.mutateAsync(values)} /></>}
      >
        <Form form={sourceForm} layout="vertical" disabled={saveSource.isPending} onFinish={(values) => saveSource.mutate(values)}>
          <Form.Item name="name" label={t("来源名称")} rules={[{ required: true, whitespace: true }]}>
            <Input placeholder={t("例如：国务院办公厅年度放假通知")} />
          </Form.Item>
          <Form.Item
            name="url"
            label={t("公告地址")}
            rules={[{ required: true, whitespace: true }, { validator: async (_, value: string) => { try { if (new URL(value).protocol !== "https:") throw new Error(); } catch { throw new Error(t("请输入 HTTPS 公告地址")); } } }]}
            tooltip={t("必须是 HTTPS 地址：这份数据会被所有租户引用，来源不可验证时出错面是全平台。")}
          >
            <Input placeholder="https://www.gov.cn/..." />
          </Form.Item>
          <Form.Item name="notes" label={t("备注")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="isActive" label={t("启用")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      <Modal presentation="side"
        title={versionTarget ? `${t("登记年度版本")}：${versionTarget.name}` : t("登记年度版本")}
        open={versionDialog.visible}
        onCancel={versionDialog.dismiss}
        afterClose={versionDialog.afterClose}
        onConfirm={() => versionForm.validateFields().then((values) => registerVersion.mutateAsync(values))}
        confirmLoading={registerVersion.isPending}
        closable={!registerVersion.isPending} keyboard={!registerVersion.isPending} maskClosable={!registerVersion.isPending} cancelButtonProps={{ disabled: registerVersion.isPending }}
        okText={t("登记")}
        width={680}
        destroyOnHidden
      >
        <Form form={versionForm} layout="vertical" disabled={registerVersion.isPending} onFinish={(values) => registerVersion.mutate(values)}>
          <Alert
            type="warning"
            showIcon
            title={t("来源版本只追加，版本号由服务端递增")}
            description={t("官方再次调整时请再登记一版，不要修改历史版本——已引用旧版的空间日历、报价与订单必须继续指向原版本。")}
            style={{ marginBottom: 16 }}
          />
          <SettingsWorkspace sections={[
            { key: "publication", label: t("公告资料"), content: <FormSection title={t("公告资料")}>
          <Row gutter={16}><Col span={12}><Form.Item name="year" label={t("年度")} rules={[{ required: true }]}>
            <InputNumber min={2000} max={2999} precision={0} style={{ width: "100%" }} />
          </Form.Item></Col><Col span={12}>
          <Form.Item name="publishedAt" label={t("官方公告发布日期")} rules={[{ required: true }]}>
            <DatePicker format="YYYY-MM-DD" />
          </Form.Item></Col></Row>
            </FormSection> },
            { key: "dates", label: t("日期内容"), content: <FormSection title={t("日期内容")}>
          <Form.Item
            name="daysText"
            label={t("官方日期（JSON 数组）")}
            dependencies={["year"]}
            rules={[{ required: true }, dateArrayRule]}
            tooltip={t("只接受法定节假日与调休工作日，日期必须是该年度的 YYYY-MM-DD。整年替换语义：空间应用该版本时，本版未包含的日期会回落到每周模板。")}
          >
            <Input.TextArea rows={12} spellCheck={false} />
          </Form.Item>
            </FormSection> },
          ]} />
        </Form>
      </Modal>
    </>
  );
}

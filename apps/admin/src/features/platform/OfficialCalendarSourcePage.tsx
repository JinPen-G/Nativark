import { ListFilters, useListFilter } from "@/components/ui";
import { CopyButton, DataTableRowActions, DataTableText, DatePicker, FormSection, ListSection, SaveButton, Select } from "@/components/ui";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { useModalDismissal } from "@/components/ui/useModalDismissal";
import { CalendarPlus, Pencil } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Col, InputNumber, Row, Tag } from "antd";
import { App, Modal } from "@/components/ui";
import { Form } from "@/components/ui";
import { Alert, Table } from "@/components/ui";
import { Switch } from "@/components/ui";
import { Input } from "@/components/ui";
import { Button } from "@/components/ui";
import dayjs, { type Dayjs } from "dayjs";
import { useState } from "react";
import type { OfficialCalendarSource } from "@rental-os/shared";
import { officialCalendarApi } from "@/api/officialCalendar";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { OfficialCalendarDatesField } from "./OfficialCalendarDatesField";
import { readOfficialCalendarDates } from "./official-calendar-dates";
import styles from "./PlatformSettings.module.css";

type VersionFormValues = { sourceId: string; year: number; publishedAt: Dayjs; daysText: string };

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
  const [versionOpen, setVersionOpen] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const [sourceForm] = Form.useForm<{ name: string; url: string; notes?: string; isActive: boolean }>();
  const [versionForm] = Form.useForm<VersionFormValues>();
  const versionYear = Form.useWatch("year", versionForm);
  const versionSourceId = Form.useWatch("sourceId", versionForm);
  const sourceDialog = useModalDismissal(sourceEditor !== undefined, () => setSourceEditor(undefined));
  const versionDialog = useModalDismissal(versionOpen, () => { setVersionOpen(false); versionForm.resetFields(); });

  const sources = useQuery({ queryKey: ["official-calendars"], queryFn: officialCalendarApi.sources });
  const sourceFilter = useListFilter(sources.data, { fields: row => [row.name, row.url] });
  const activeSources = sources.data?.filter(source => source.isActive) ?? [];
  const versionSource = activeSources.find(source => source.id === versionSourceId);
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
    mutationFn: (values: VersionFormValues) => {
      const source = activeSources.find(item => item.id === values.sourceId);
      if (!source) throw new Error(t("请选择已启用的官方来源"));
      return officialCalendarApi.registerVersion(source.id, {
        year: Number(values.year),
        publishedAt: new Date(values.publishedAt.format("YYYY-MM-DD")).toISOString(),
        days: readOfficialCalendarDates(values.daysText, values.year, t),
      });
    },
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
  const dateArrayRule = { validator: async (_rule: unknown, text: string) => { readOfficialCalendarDates(text, versionForm.getFieldValue("year"), t); } };
  function openVersion(source?: OfficialCalendarSource) {
    versionForm.resetFields();
    versionForm.setFieldsValue({ sourceId: source?.id, year: new Date().getFullYear() + 1, daysText: "[]" });
    setVersionOpen(true);
  }

  return (
    <>
      <PageHeader
        title={t("公共官方日历来源")}
        description={t("租户引用官方来源后，仍需自行确认发布日历。")}
        note={{
          title: t("官方数据是公共基础来源，导入不会自动影响任何经营空间"),
          description: t("官方再次调整时请登记新的来源版本；已发布的空间日历、有效报价和订单继续指向它们各自引用的那一版，不会被静默覆盖。")
        }}
        extra={<div className={styles.controls}>
          <Button disabled={!sources.isSuccess} onClick={() => openVersion()}>{t("登记年度版本")}</Button>
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
        </div>}
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
                render: (value: string) => <div className={styles.controls}><span className={styles.context}>{value}</span><CopyButton value={value} label={t("复制公告地址")} /></div>,
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
                  return <DataTableRowActions details={edit} detailLabel={t("编辑来源")} menuLabel={`${row.name} · ${t("更多操作")}`}
                    primary={{ id: "version", label: t("登记年度版本"), icon: CalendarPlus, disabled: !row.isActive, onSelect: () => openVersion(row) }} actions={[{ id: "edit", label: t("编辑来源"), icon: Pencil, onSelect: edit }]} />;
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
        title={t("登记年度版本")}
        open={versionDialog.visible}
        onCancel={versionDialog.dismiss}
        afterClose={versionDialog.afterClose}
        closable={!registerVersion.isPending} keyboard={!registerVersion.isPending} maskClosable={!registerVersion.isPending} cancelButtonProps={{ disabled: registerVersion.isPending }}
        footer={<>{!versionSource && <p className={styles.footerNote}>{t("请选择已启用的官方来源")}</p>}<Button disabled={registerVersion.isPending} onClick={versionDialog.dismiss}>{t("取消")}</Button><SaveButton label={t("登记年度版本")} form={versionForm} pending={registerVersion.isPending} disabled={!versionSource || sources.isError} onSave={values => registerVersion.mutateAsync(values)} /></>}
        width={760}
        destroyOnHidden
      >
        <Form form={versionForm} name="official-calendar-version" layout="vertical" disabled={registerVersion.isPending} onFinish={(values) => registerVersion.mutate(values)}>
          <Alert
            type="warning"
            showIcon
            title={t("来源版本只追加，版本号由服务端递增")}
            description={t("官方再次调整时请再登记一版，不要修改历史版本——已引用旧版的空间日历、报价与订单必须继续指向原版本。")}
            style={{ marginBottom: 16 }}
          />
          <SettingsWorkspace sections={[
            { key: "publication", label: t("公告资料"), content: <FormSection title={t("公告资料")}>
          <Form.Item name="sourceId" label={t("官方来源")} rules={[{ required: true, message: t("请选择已启用的官方来源") }]}
            extra={!activeSources.length ? t("暂无已启用来源，请先登记来源；可以先整理本年度的日期。") : versionSource?.url}>
            <Select placeholder={t("请选择已启用的官方来源")} options={activeSources.map(source => ({ value: source.id, label: source.name }))} />
          </Form.Item>
          <Row gutter={16}><Col span={12}><Form.Item name="year" label={t("年度")} rules={[{ required: true, type: "integer", min: 2000, max: 2999 }]}>
            <InputNumber min={2000} max={2999} precision={0} style={{ width: "100%" }} />
          </Form.Item></Col><Col span={12}>
          <Form.Item name="publishedAt" label={t("官方公告发布日期")} rules={[{ required: true }]}>
            <DatePicker format="YYYY-MM-DD" />
          </Form.Item></Col></Row>
            </FormSection> },
            { key: "dates", label: t("日期内容"), content: <FormSection title={t("日期内容")} description={t("只登记官方公告中的法定节假日和调休工作日；未列入的日期沿用空间每周模板。") }>
          <Form.Item
            name="daysText"
            validateTrigger={["onChange", "onBlur"]}
            dependencies={["year"]}
            rules={[{ required: true }, dateArrayRule]}
          >
            <OfficialCalendarDatesField year={versionYear} />
          </Form.Item>
            </FormSection> },
          ]} />
        </Form>
      </Modal>
    </>
  );
}

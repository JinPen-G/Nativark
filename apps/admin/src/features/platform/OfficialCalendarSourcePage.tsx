import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Alert, Button, Card, Drawer, Form, Input, Modal, Space, Switch, Table, Tag, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import type { OfficialCalendarSource } from "@rental-os/shared";
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
  const [versionForm] = Form.useForm<{ year: number; publishedAt: string; daysText: string }>();

  const sources = useQuery({ queryKey: ["official-calendars"], queryFn: officialCalendarApi.sources });
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
      setSourceEditor(undefined);
      await queryClient.invalidateQueries({ queryKey: ["official-calendars"] });
      message.success(t("官方来源已保存"));
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t("保存失败")
      )
  });

  const registerVersion = useMutation({
    mutationFn: (values: { year: number; publishedAt: string; daysText: string }) =>
      officialCalendarApi.registerVersion(versionTarget!.id, {
        year: Number(values.year),
        publishedAt: new Date(values.publishedAt).toISOString(),
        days: JSON.parse(values.daysText)
      }),
    onSuccess: async (created) => {
      setVersionTarget(undefined);
      versionForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["official-calendar-versions"] });
      message.success(`${t("已登记来源版本")} v${created.version}，${t("租户空间可以引用它生成草稿")}`);
    },
    onError: (error) =>
      message.error(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ??
          t("登记失败：请检查年度、发布日期与日期数组")
      )
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <PageHeader
        title={t("公共官方日历来源")}
        description={t("登记中国大陆官方节假日来源与年度来源版本。租户经营空间只能引用某一版生成自己的年度草稿并自行确认发布。")}
        note={{
          title: t("官方数据是公共基础来源，导入不会自动影响任何经营空间"),
          description: t("官方再次调整时请登记新的来源版本；已发布的空间日历、有效报价和订单继续指向它们各自引用的那一版，不会被静默覆盖。")
        }}
        extra={
          <Button
            type="primary"
            onClick={() => {
              sourceForm.setFieldsValue({ name: "", url: "https://www.gov.cn/", notes: "", isActive: true });
              setSourceEditor(null);
            }}
          >
            {t("登记来源")}
          </Button>
        }
      />
      <QueryState loading={sources.isLoading} error={sources.error}>
        <Card className="data-panel">
          <Table<OfficialCalendarSource>
            rowKey="id"
            size="small"
            dataSource={sources.data ?? []}
            pagination={false}
            expandable={{
              expandedRowKeys: expanded ? [expanded] : [],
              onExpand: (open, row) => setExpanded(open ? row.id : undefined),
              expandedRowRender: () => (
                <QueryState loading={versions.isLoading} error={versions.error}>
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={versions.data ?? []}
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
              { title: t("地区"), dataIndex: "region", width: 80 },
              { title: t("来源名称"), dataIndex: "name" },
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
                width: 180,
                render: (_, row) => (
                  <Space size={0}>
                    <Button
                      type="link"
                      onClick={() => {
                        sourceForm.setFieldsValue({
                          name: row.name,
                          url: row.url,
                          notes: row.notes ?? "",
                          isActive: row.isActive
                        });
                        setSourceEditor(row);
                      }}
                    >
                      {t("编辑")}
                    </Button>
                    <Button
                      type="link"
                      onClick={() => {
                        versionForm.setFieldsValue({
                          year: new Date().getFullYear() + 1,
                          publishedAt: dayjs().format("YYYY-MM-DD"),
                          daysText: '[{"date":"2027-10-01","dayType":"statutory_holiday","name":"国庆节"}]'
                        });
                        setVersionTarget(row);
                      }}
                    >
                      {t("登记年度版本")}
                    </Button>
                  </Space>
                )
              }
            ]}
          />
        </Card>
      </QueryState>
      <Drawer
        title={sourceEditor ? `${t("编辑来源")}：${sourceEditor.name}` : t("登记官方来源")}
        open={sourceEditor !== undefined}
        onClose={() => setSourceEditor(undefined)}
        size={520}
        destroyOnHidden
        extra={
          <Button type="primary" loading={saveSource.isPending} onClick={() => sourceForm.submit()}>
            {t("保存")}
          </Button>
        }
      >
        <Form form={sourceForm} layout="vertical" onFinish={(values) => saveSource.mutate(values)}>
          <Form.Item name="name" label={t("来源名称")} rules={[{ required: true, whitespace: true }]}>
            <Input placeholder={t("例如：国务院办公厅年度放假通知")} />
          </Form.Item>
          <Form.Item
            name="url"
            label={t("公告地址")}
            rules={[{ required: true, whitespace: true }]}
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
      </Drawer>
      <Modal
        title={versionTarget ? `${t("登记年度版本")}：${versionTarget.name}` : t("登记年度版本")}
        open={Boolean(versionTarget)}
        onCancel={() => setVersionTarget(undefined)}
        onOk={() => versionForm.submit()}
        confirmLoading={registerVersion.isPending}
        okText={t("登记")}
        width={680}
        destroyOnHidden
      >
        <Form form={versionForm} layout="vertical" onFinish={(values) => registerVersion.mutate(values)}>
          <Alert
            type="warning"
            showIcon
            title={t("来源版本只追加，版本号由服务端递增")}
            description={t("官方再次调整时请再登记一版，不要修改历史版本——已引用旧版的空间日历、报价与订单必须继续指向原版本。")}
            style={{ marginBottom: 16 }}
          />
          <Form.Item name="year" label={t("年度")} rules={[{ required: true }]}>
            <Input placeholder="2027" />
          </Form.Item>
          <Form.Item name="publishedAt" label={t("官方公告发布日期")} rules={[{ required: true }]}>
            <Input placeholder="2026-11-01" />
          </Form.Item>
          <Form.Item
            name="daysText"
            label={t("官方日期（JSON 数组）")}
            rules={[{ required: true }]}
            tooltip={t("只接受法定节假日与调休工作日，日期必须是该年度的 YYYY-MM-DD。整年替换语义：空间应用该版本时，本版未包含的日期会回落到每周模板。")}
          >
            <Input.TextArea rows={12} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

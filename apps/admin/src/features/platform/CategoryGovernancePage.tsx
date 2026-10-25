import { ListFilters, useListFilter } from "@/components/ui";
import { ListSection, SaveButton } from "@/components/ui";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Space, Tag } from "antd";
import { Form } from "@/components/ui";
import { App, Modal } from "@/components/ui";
import { Alert, Button, Input, Select, Table } from "@/components/ui";
import { CATEGORY_GOVERNANCE_PERMISSIONS as P, type CategoryVersionView } from "@rental-os/shared";
import { categoryGovernanceApi, type CategoryGovernanceSummary } from "@/api/categoryGovernance";
import { useAuthStore } from "@/features/auth/authStore";
import { useLocale } from "@/app/locale";
import { PageHeader } from "@/components/PageHeader";
import { QueryState } from "@/components/QueryState";
import { CategoryDraftEditor } from "./CategoryDraftEditor";
import { CategoryPolicyDialog } from "./CategoryPolicyDialog";
import { CategoryTemplateIcon } from "./CategoryTemplateIcon";

export function CategoryGovernancePage() {
  const { t, locale } = useLocale();
  const { message } = App.useApp();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<string>();
  const [viewer, setViewer] = useState<string>();
  const [auditCode, setAuditCode] = useState<string>();
  const [editor, setEditor] = useState<{ code: string; version: CategoryVersionView }>();
  const [policyTarget, setPolicyTarget] = useState<{ code: string; version?: CategoryVersionView }>();
  const [form] = Form.useForm<{ sourceVersionId: string; versionLabel: string; reason: string }>();
  const list = useQuery({ queryKey: ["platform-category-governance"], queryFn: categoryGovernanceApi.list });
  const categoryFilter = useListFilter(list.data, { fields: row => [row.name, row.code] });
  const detail = useQuery({ queryKey: ["platform-category-governance", target], queryFn: () => categoryGovernanceApi.detail(target!), enabled: Boolean(target) });
  const viewed = useQuery({ queryKey: ["platform-category-governance", viewer], queryFn: () => categoryGovernanceApi.detail(viewer!), enabled: Boolean(viewer) });
  const policyDetail = useQuery({ queryKey: ["platform-category-governance", policyTarget?.code], queryFn: () => categoryGovernanceApi.detail(policyTarget!.code), enabled: Boolean(policyTarget) });
  const audits = useQuery({ queryKey: ["platform-category-governance-audits", auditCode], queryFn: () => categoryGovernanceApi.audits(auditCode!), enabled: Boolean(auditCode) && hasPermission(P.audit) });
  const copy = useMutation({
    mutationFn: (values: { sourceVersionId: string; versionLabel: string; reason: string }) => categoryGovernanceApi.createDraft(target!, values),
    onSuccess: async () => { setTarget(undefined); form.resetFields(); await queryClient.invalidateQueries({ queryKey: ["platform-category-governance"] }); message.success(t("草稿已创建")); },
    onError: () => message.error(t("创建失败，请检查版本号或刷新后重试"))
  });
  const scope = (value: string) => t(({ all: "全部租户", pilot: "试点租户", unopened: "尚未开放", stopped: "停止新开通", none: "不允许采用" } as Record<string, string>)[value] ?? value);
  return <>
    <PageHeader title="租赁品类" description={t("发布品类版本不会自动升级经营空间。")} />

    <QueryState loading={list.isLoading} error={list.error}>
      <ListSection controls={<ListFilters filter={categoryFilter} placeholder="品类名称或编码" />}>
        <Table<CategoryGovernanceSummary> rowKey="code" onRefresh={() => list.refetch()} loading={list.isFetching} dataSource={categoryFilter.rows} pagination={categoryFilter.pagination} scroll={{ x: 900 }} columns={[
          { title: t("品类"), render: (_, row) => <Space><CategoryTemplateIcon code={row.icon ?? row.code} />{locale === "en-US" && row.nameEn?.trim() ? row.nameEn : row.name}</Space> },
          { title: t("编码"), dataIndex: "code" },
          { title: t("新开通范围"), dataIndex: "openingScope", render: (value: string) => <Tag>{scope(value)}</Tag> },
          { title: t("默认推荐版本"), render: (_, row) => row.recommendedVersionLabel ?? (row.recommendedVersionId ? t("查看版本") : "—") },
          { title: t("最新发布版本"), render: (_, row) => row.latestPublished?.versionLabel ?? "—" },
          { title: t("草稿"), render: (_, row) => row.drafts.map((draft) => <Tag key={draft.id}>{draft.versionLabel}</Tag>) },
          { title: t("采用空间数"), dataIndex: "adoptedSpaces" },
          { title: t("操作"), render: (_, row) => <Space wrap><Button onClick={() => setViewer(row.code)}>{t("查看版本")}</Button>{hasPermission(P.edit) && <Button onClick={() => { form.resetFields(); setTarget(row.code); }}>{t("复制为同品类草稿")}</Button>}{hasPermission(P.opening) && <Button onClick={() => setPolicyTarget({ code: row.code })}>{t("新开通政策")}</Button>}{hasPermission(P.audit) && <Button onClick={() => setAuditCode(row.code)}>{t("治理记录")}</Button>}</Space> }
        ]} />
      </ListSection>
    </QueryState>
    <Modal title={t("复制为同品类草稿")} open={Boolean(target)} footer={null} onCancel={() => { if (!copy.isPending) setTarget(undefined); }} mask={{ closable: !copy.isPending }}>
      <QueryState loading={detail.isLoading} error={detail.error}>
        <Form form={form} layout="vertical" onFinish={(values) => copy.mutate(values)}>
          <Form.Item name="sourceVersionId" label={t("来源发布版本")} rules={[{ required: true }]}><Select options={detail.data?.versions.filter((v) => ["published", "legacy_baseline"].includes(v.status)).map((v) => ({ value: v.id, label: v.versionLabel }))} /></Form.Item>
          <Form.Item name="versionLabel" label={t("新版本号")} rules={[{ required: true }, { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/ }]}><Input maxLength={64} /></Form.Item>
          <Form.Item name="reason" label={t("变更原因")} rules={[{ required: true, whitespace: true }]}><Input.TextArea maxLength={512} /></Form.Item>
          <Space><SaveButton  label={t("创建草稿")} form={form} pending={copy.isPending} onSave={(values) => copy.mutateAsync(values)} /><Button onClick={() => setTarget(undefined)} disabled={copy.isPending}>{t("取消")}</Button></Space>
        </Form>
      </QueryState>
    </Modal>
    <Modal title={t("品类版本")} open={Boolean(viewer) && !editor} footer={null} width="80%" onCancel={() => setViewer(undefined)}>
      <QueryState loading={viewed.isLoading} error={viewed.error}>
        <Table<CategoryVersionView> rowKey="id" onRefresh={() => viewed.refetch()} loading={viewed.isFetching} dataSource={viewed.data?.versions ?? []} scroll={{ x: 700 }} columns={[
          { title: t("版本"), dataIndex: "versionLabel", render: (value: string, row) => <Space>{value}{row.id === viewed.data?.recommendedVersionId && <Tag>{t("默认推荐版本")}</Tag>}</Space> },
          { title: t("状态"), dataIndex: "status", render: (value: string) => t(({ draft: "草稿", published: "已发布", legacy_baseline: "历史基线", archived: "已归档" } as Record<string, string>)[value] ?? value) },
          { title: t("新建采用资格"), render: (_, row) => row.policy ? scope(row.policy.createScope) : "—" },
          { title: t("升级采用资格"), render: (_, row) => row.policy ? scope(row.policy.upgradeScope) : "—" },
          { title: t("恢复采用资格"), render: (_, row) => row.policy ? scope(row.policy.restoreScope) : "—" },
          { title: t("操作"), render: (_, row) => <Space wrap><Button onClick={() => setEditor({ code: viewer!, version: row })}>{t(row.status === "draft" && hasPermission(P.edit) ? "编辑草稿" : "查看")}</Button>{row.policy && hasPermission(P.publish) && <Button onClick={() => setPolicyTarget({ code: viewer!, version: row })}>{t("采用资格")}</Button>}</Space> }
        ]} />
      </QueryState>
    </Modal>
    {editor && <CategoryDraftEditor key={editor.version.id} code={editor.code} initial={editor.version} editable={hasPermission(P.edit)} canPublish={hasPermission(P.publish)} saved={() => { void queryClient.invalidateQueries({ queryKey: ["platform-category-governance"] }); }} close={() => setEditor(undefined)} />}
    {policyTarget && <QueryState loading={policyDetail.isLoading} error={policyDetail.error}>{policyDetail.data && <CategoryPolicyDialog key={`${policyTarget.code}:${policyTarget.version?.id ?? "opening"}`} detail={policyDetail.data} version={policyTarget.version} saved={() => { void queryClient.invalidateQueries({ queryKey: ["platform-category-governance"] }); }} close={() => setPolicyTarget(undefined)} />}</QueryState>}
    <Modal title={t("治理记录")} open={Boolean(auditCode) && hasPermission(P.audit)} footer={null} width="80%" onCancel={() => setAuditCode(undefined)}>
      {hasPermission(P.audit) && <QueryState loading={audits.isLoading} error={audits.error}><Table rowKey="id" onRefresh={() => audits.refetch()} loading={audits.isFetching} dataSource={audits.data ?? []} scroll={{ x: 650 }} columns={[
        { title: t("操作"), dataIndex: "action", render: (value: string) => t(({ draft_create: "创建草稿", draft_patch: "保存草稿", publish: "发布版本", draft_archive: "归档草稿", opening_policy: "新开通政策", version_policy: "版本采用资格" } as Record<string, string>)[value] ?? value) },
        { title: t("变更原因"), dataIndex: "reason" }, { title: t("操作人"), dataIndex: "actorId" },
        { title: t("时间"), dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString(locale) }
      ]} /></QueryState>}
    </Modal>
  </>;
}

export function CategoryCapabilityCatalogPage() {
  const { t } = useLocale();
  const catalog = useQuery({ queryKey: ["platform-category-capability-catalog"], queryFn: categoryGovernanceApi.catalog });
  const capabilityFilter = useListFilter(catalog.data?.capabilities, { fields: row => [row.label, row.code] });
  return <>
    <PageHeader title="内核能力目录" />
    <QueryState loading={catalog.isLoading} error={catalog.error}>
      <ListSection controls={<ListFilters filter={capabilityFilter} placeholder="能力名称或编码" />}><Table rowKey="code" onRefresh={() => catalog.refetch()} loading={catalog.isFetching} dataSource={capabilityFilter.rows} pagination={capabilityFilter.pagination} scroll={{ x: 1100 }} columns={[
        { title: t("能力"), dataIndex: "label" }, { title: t("编码"), dataIndex: "code" },
        { title: t("实现版本"), dataIndex: "implementationVersion", render: (value?: string) => value ?? "—" },
        { title: t("实现状态"), render: (_, row) => <Tag color={row.implemented ? "success" : "warning"}>{t(row.implemented ? "已登记实现" : "未实现")}</Tag> },
        { title: t("适用品类"), render: (_, row) => row.applicableCategories === "all" ? t("全部品类") : row.applicableCategories.join(" / ") },
        { title: t("依赖能力"), render: (_, row) => row.dependsOn.join(" / ") || "—" },
        { title: t("互斥能力"), render: (_, row) => row.conflictsWith.join(" / ") || "—" },
        { title: t("配置字段"), render: (_, row) => row.configSchema.map((field) => `${field.label} (${field.type}${field.required ? `, ${t("必填")}` : ""})`).join("；") || "—" }
      ]} /></ListSection>
    </QueryState>
  </>;
}

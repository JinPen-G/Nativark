import type { RentalCategoryDefinition, RentalRuleVersion } from "@rental-os/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Form, Input, Space, Steps, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { rentalCoreApi } from "@/api/rentalCore";
import { useLocale } from "@/app/locale";
import { RULE_SECTIONS, formToConfig, seedFormFromRule, type RuleForm } from "./ruleSections";
import { errorText, type GovernancePermissions } from "./shared";

/**
 * 「新建规则向导」：把 RulesTab 的整表编辑器按 RULE_SECTIONS 的业务顺序拆成 7 步，
 * 每步顶部先给一句「何时生效」的引导，再渲染该分区**原样**的表单字段，最后一步发布。
 *
 * 复用而非另起炉灶：字段来自 RULE_SECTIONS、seed-in 走 `seedFormFromRule`、
 * map-out 走 `formToConfig`、保存/发布走 `rentalCoreApi.saveRuleVersion` /
 * `publishRuleVersion`，与 RulesTab 完全同一条链路，押金/预授权派生不重复实现。
 *
 * 首次开业没有任何规则版本时**不在前端伪造默认值**（默认值归服务端）：
 * 「发布」会先把当前表单存成草稿，由服务端补齐/校验默认值并返回该版本，再对其发布；
 * 服务端拒绝则原样透出错误，用户据此改正。
 */
export function RuleSetupWizard({
  category,
  permissions,
  seed,
  onClose,
}: {
  category: RentalCategoryDefinition;
  permissions: GovernancePermissions;
  /** 已有的当前草稿或已生效版本；用于回填。首次开业无版本时为 undefined，表单留空。 */
  seed?: RentalRuleVersion;
  /** 发布成功后关闭向导并回到「品类与业务规则」。 */
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const { canEditRules, canPublishRules } = permissions;
  const [form] = Form.useForm<RuleForm>();
  const [current, setCurrent] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  /** 已存到服务端的草稿。存在则后续保存与发布都针对同一版本，不再新开草稿。 */
  const [draft, setDraft] = useState<RentalRuleVersion | undefined>(
    seed?.status === "draft" ? seed : undefined,
  );
  const lastStep = RULE_SECTIONS.length - 1;

  // 仅挂载时按 seed 回填一次；seed 引用会随查询刷新变化，用 ref 防止把用户改动冲掉。
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !seed) return;
    seedFormFromRule(form, seed, category);
    seeded.current = true;
  }, [seed, category, form]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-versions"] });
    await queryClient.invalidateQueries({ queryKey: ["rental-core", "rule-version-audits"] });
  }

  const saveDraft = useMutation({
    mutationFn: async () => {
      const values = form.getFieldsValue(true) as RuleForm;
      // 变更原因随每次保存写入审计；向导里未单列输入时给一条与 RulesTab 一致的兜底文案。
      const changeReason = values.changeReason?.trim() || t("通过新建规则向导配置");
      return rentalCoreApi.saveRuleVersion({
        config: formToConfig(values, category),
        changeReason,
        versionId: draft?.id,
      });
    },
    onSuccess: (row) => setDraft(row),
  });

  const publish = useMutation({
    mutationFn: (version: string) =>
      // 立即生效：向导面向首次开业，不预约未来时点（effectiveFrom 留空即立即生效）。
      rentalCoreApi.publishRuleVersion(version, { reason: t("通过新建规则向导发布") }),
  });

  async function handleSaveDraft() {
    try {
      const row = await saveDraft.mutateAsync();
      await invalidate();
      message.success(`${t("草稿已保存")}（v${row.version}），${t("仍需具备发布权限的人发布后才对客户生效")}`);
    } catch (error) {
      message.error(errorText(error, t("草稿保存失败，请检查品类能力和租户设置")));
    }
  }

  async function handleNext() {
    try {
      // 只校验当前步已挂载的字段：后面步骤未填不该拦住往下走。
      await form.validateFields();
    } catch {
      return;
    }
    const next = Math.min(current + 1, lastStep);
    setCurrent(next);
    setMaxVisited((value) => Math.max(value, next));
  }

  async function handlePublish() {
    try {
      await form.validateFields();
    } catch {
      return;
    }
    try {
      // 先存草稿拿到版本，再对该版本发布：保证发布的正是当前表单内容，
      // 且首次开业时由服务端补齐默认值后才发布。
      const row = await saveDraft.mutateAsync();
      await publish.mutateAsync(row.version);
      await invalidate();
      message.success(t("规则已发布并对客户生效"));
      onClose();
    } catch (error) {
      message.error(errorText(error, t("发布失败")));
    }
  }

  const section = RULE_SECTIONS[current];
  const pending = saveDraft.isPending || publish.isPending;

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        {t("按业务顺序逐段配置这套租赁规则，每步只需关注当前一组。可随时「保存草稿」中途退出，最后一步发布后立即对客户生效。")}
      </Typography.Paragraph>
      <Steps
        size="small"
        current={current}
        items={RULE_SECTIONS.map((item) => ({ title: t(item.title) }))}
        onChange={(value) => {
          // 只允许回到已经过的步骤；向前必须走「下一步」以逐段校验。
          if (value <= maxVisited) setCurrent(value);
        }}
      />
      <Card size="small" title={`${t("步骤")} ${current + 1} / ${RULE_SECTIONS.length} · ${t(section.title)}`}>
        <Alert type="info" showIcon title={t(section.title)} description={t(section.description)} style={{ marginBottom: 16 }} />
        <Form form={form} layout="vertical">
          {section.render({ form, category, t })}
          {current === lastStep && (
            <Form.Item
              name="changeReason"
              label={t("变更原因")}
              rules={[{ required: true, message: t("变更原因必填并写入审计") }]}
              style={{ marginTop: 16 }}
            >
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
          )}
        </Form>
      </Card>
      {current === lastStep && !canPublishRules && (
        <Alert
          type="warning"
          showIcon
          title={t("当前账号没有发布权限")}
          description={t("可保存草稿，但需要具备 rules:publish 权限的人发布后才对客户生效。")}
        />
      )}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Button disabled={current === 0 || pending} onClick={() => setCurrent((value) => Math.max(0, value - 1))}>
          {t("上一步")}
        </Button>
        <Space>
          <Button disabled={!canEditRules} loading={saveDraft.isPending} onClick={handleSaveDraft}>
            {t("保存草稿")}
          </Button>
          {current < lastStep ? (
            <Button type="primary" disabled={pending} onClick={handleNext}>
              {t("下一步")}
            </Button>
          ) : (
            <Button
              type="primary"
              disabled={!canPublishRules}
              loading={pending}
              onClick={handlePublish}
            >
              {t("发布")}
            </Button>
          )}
        </Space>
      </div>
    </Space>
  );
}

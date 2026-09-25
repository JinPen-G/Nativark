import type { RentalCategoryDefinition, RentalRuleVersion, SaveRentalRuleVersionRequest } from "@rental-os/shared";
import { Alert, Col, Form as AntdForm, Input, InputNumber, Row, Select, Switch, Typography } from "antd";
import type { FormInstance, FormItemProps } from "antd";
import type { ReactNode } from "react";
import { useLocale } from "@/app/locale";
import { defaultRentalNoShowRule } from "@rental-os/shared";
import { normalizeSecurityRules } from "@/features/settings/securityRuleForm";
import {
  lateFeeTypeLabels,
  overdueFeeModeLabels,
  paymentTimingLabels,
} from "./ruleOptionLabels";
import { preauthorizationRuleLabels, ruleSecurityGroups, securityRuleLabels } from "./shared";

/** 规则草稿表单值：规则配置 + 变更原因。RulesTab 与后续向导都从这里取同一份类型。 */
export type RuleForm = RentalRuleVersion["config"] & { changeReason: string };

/**
 * 每个规则分区渲染时能拿到的上下文：与 RulesTab 已持有的完全一致。
 * 抽出来是为了让后续的「新建规则向导」可以复用 RULE_SECTIONS，逐段渲染同一批字段，
 * 不必把 RulesTab 里的表单结构再抄一遍。
 */
export interface RuleSectionContext {
  form: FormInstance<RuleForm>;
  category: RentalCategoryDefinition;
  t: (value: string) => string;
}

export interface RuleSection {
  key: string;
  /** 分区标题（antd Card title）。 */
  title: string;
  /** 一句话说明这组规则「什么时候生效」。 */
  description: string;
  /** 返回分区内的表单内容；由调用方套上 Card 外壳。 */
  render: (context: RuleSectionContext) => ReactNode;
}

const selectOptions = (labels: Record<string, string>, order: string[], t: (value: string) => string) =>
  order.map((value) => ({ value, label: t(labels[value] ?? value) }));

const securityRiskLevelOptions = (t: (value: string) => string) => [
  { value: "low", label: t("低风险") },
  { value: "standard", label: t("一般风险") },
  { value: "high", label: t("高风险") }
];

/** 规则表单的字段标签、说明与校验提示统一走管理后台词典。 */
function LocalizedFormItem({ label, tooltip, extra, rules, ...props }: FormItemProps) {
  const { t } = useLocale();
  return (
    <AntdForm.Item
      {...props}
      label={typeof label === "string" ? t(label) : label}
      tooltip={typeof tooltip === "string" ? t(tooltip) : tooltip}
      extra={typeof extra === "string" ? t(extra) : extra}
      rules={rules?.map((rule) =>
        typeof rule === "object" && rule && "message" in rule && typeof rule.message === "string"
          ? { ...rule, message: t(rule.message) }
          : rule,
      )}
    />
  );
}

// 该文件只使用 Form.Item；保留原来的调用形态，同时让所有规则字段统一经过词典。
const Form = { ...AntdForm, Item: LocalizedFormItem };

/**
 * 「业务规则」抽屉的 7 个分区，**按录入顺序**排列。RulesTab 直接 map 这份清单渲染，
 * 后续向导也复用它，所以每段 render 都是 `RuleSectionContext` 的纯函数。
 *
 * 只调整分组、标题、字段标签、tooltip 与下拉中文；**不改**任何 Form.Item 的 `name`，
 * 不增删字段，也不改保存/发布链路。
 */
export const RULE_SECTIONS: RuleSection[] = [
  {
    key: "pricing-basis",
    title: "计价基础",
    description: "决定按什么时间单位计费。",
    render: ({ t }) => (
      <>
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item
              name={["pricing", "shiftHours"]}
              label="班次时长（小时）"
              tooltip="仅按班次计价时生效。留空按 8 小时。"
            >
              <InputNumber min={0.5} max={24} step={0.5} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={16}>
            <Form.Item
              name={["pricing", "shiftStartHours"]}
              label="班次起始小时"
              tooltip="按营业时区的当地小时，例如 0、8、16 表示三班制。填了边界就按「跨过几个班次窗口」计费；留空则按班次时长整除。"
            >
              <Select
                mode="multiple"
                allowClear
                placeholder={t("留空表示不按边界计费")}
                options={Array.from({ length: 24 }, (_, hour) => ({
                  value: hour,
                  label: `${String(hour).padStart(2, "0")}:00`,
                }))}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name={["pricing", "hourToDayEnabled"]}
              label="启用时租转日租"
              tooltip="作用：时租时长达到阈值后改按日价封顶。默认关闭；关闭时不做时转日。"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name={["pricing", "hourToDayThresholdHours"]}
              label="超过多少小时转日租"
              tooltip="大于 0 且不超过 24 小时。未超过阈值但小时金额达到日价，也按日价封顶。仅在上面开关开启时生效。"
            >
              <InputNumber min={0.01} max={24} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>
        <Typography.Text type="secondary">
          {t("按连续 24 小时分段，不按午夜切日。使用同一定价分组、同一价格版本的 24 小时日价；未配置日价不能使用。发布后随新订单规则固定，不改变已有订单。")}
        </Typography.Text>
      </>
    ),
  },
  {
    key: "fulfillment",
    title: "领取与归还",
    description: "领取和归还时的检查与缓冲要求。",
    render: ({ t }) => (
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item
            name={["fulfillment", "pickupBufferMinutes"]}
            label="领取前准备缓冲（分钟）"
            tooltip="只占用库存，不计租金；留空按 0。随规则版本固化到订单。"
          >
            <InputNumber min={0} max={43200} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name={["fulfillment", "returnBufferMinutes"]}
            label="归还后周转缓冲（分钟）"
            tooltip="用于检查、清洁、运输等周转；续租与后续订单必须连同双方缓冲一起检查。留空按 0。"
          >
            <InputNumber min={0} max={43200} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["fulfillment", "pickupInspectionRequired"]}
            label="领取必检"
            tooltip="作用：开启后领取环节必须完成检查才能放行。默认关闭，关闭时检查可跳过。"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["fulfillment", "returnInspectionRequired"]}
            label="归还必检"
            tooltip="作用：开启后归还环节必须完成检查才能收货。默认关闭，关闭时检查可跳过。"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["fulfillment", "evidenceRequired"]}
            label="必须影像证据"
            tooltip="作用：开启后领取/归还检查必须上传照片或视频。默认关闭，关闭时证据可选。"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["fulfillment", "allowDifferentReturnLocation"]}
            label="允许异地归还"
            tooltip="作用：开启后客户可在非领取地点归还。默认关闭，关闭时必须原地归还。"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Col>
      </Row>
    ),
  },
  {
    key: "payment-deposit",
    title: "收款与押金",
    description: "何时收款、押金与预授权怎么算。",
    render: ({ form, category, t }) => (
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item
            name={["payment", "timing"]}
            label="支付时点"
            tooltip="作用：决定客户在流程哪一步付款。默认下单时；线下账期指企业月结等先用后付。"
          >
            <Select options={selectOptions(paymentTimingLabels, ["order", "confirmation", "pickup", "offline_terms"], t)} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["payment", "unpaidHoldMinutes"]}
            label="下单后多久未支付自动释放（分钟）"
            tooltip="作用：下单后超过该时长仍未支付则自动取消并释放占用。默认按品类，最少 1 分钟。"
          >
            <InputNumber min={1} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["payment", "quoteValidityMinutes"]}
            label="报价有效期（分钟）"
            tooltip="报价可被提交订单的时长，不等于下单后的未支付库存保留时长。旧规则未设置时沿用原保留时长。"
          >
            <InputNumber min={1} max={1440} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Form.Item name={["payment", "depositMode"]} hidden><Input /></Form.Item>
        <Form.Item name={["payment", "preauthorizationRequired"]} valuePropName="checked" hidden><Switch /></Form.Item>
        <Col span={8}>
          <Form.Item
            name={["deposit", "mode"]}
            label="押金规则"
            tooltip="作用：决定是否收押金以及怎么算。默认不需要；「每单固定金额」需另填固定押金。"
            rules={[{ required: true }]}
          >
            <Select
              options={Object.entries(securityRuleLabels).map(([value, label]) => ({ value, label: t(label) }))}
              onChange={(mode) => {
                if (mode !== "order_fixed") form.resetFields([["deposit", "fixedAmount"]]);
              }}
            />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name={["deposit", "maxAmount"]} label="订单押金上限" tooltip="留空表示不设上限；0 表示免押。">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.deposit?.mode !== current.deposit?.mode}>
            {({ getFieldValue }) => getFieldValue(["deposit", "mode"]) === "order_fixed" ? <Form.Item name={["deposit", "fixedAmount"]} label="每单固定押金" tooltip="仅在押金规则选择“每单固定金额”时使用。">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item> : null}
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["preauthorization", "mode"]}
            label="预授权规则"
            tooltip="作用：决定是否冻结预授权额度以及怎么算。默认不需要；不支持预授权的品类只能选不需要。"
            rules={[{ required: true }]}
          >
            <Select
              options={(category.businessModel.supportsPreauthorization
                ? Object.entries(preauthorizationRuleLabels)
                : [["none", securityRuleLabels.none]]
              ).map(([value, label]) => ({ value, label: t(label) }))}
              onChange={(mode) => {
                if (mode !== "order_fixed") form.resetFields([["preauthorization", "fixedAmount"]]);
                if (mode !== "risk_surcharge") form.resetFields([["preauthorization", "riskSurchargeAmount"]]);
              }}
            />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item name={["preauthorization", "maxAmount"]} label="订单预授权上限" tooltip="留空表示不设上限；预授权只冻结额度，不计入实收。">
            <InputNumber min={0} disabled={!category.businessModel.supportsPreauthorization} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.preauthorization?.mode !== current.preauthorization?.mode}>
            {({ getFieldValue }) => getFieldValue(["preauthorization", "mode"]) === "order_fixed" ? <Form.Item name={["preauthorization", "fixedAmount"]} label="订单固定预授权" tooltip="仅在预授权规则选择“每单固定金额”时使用。">
              <InputNumber min={0} disabled={!category.businessModel.supportsPreauthorization} style={{ width: "100%" }} />
            </Form.Item> : null}
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item noStyle shouldUpdate={(previous, current) => previous.preauthorization?.mode !== current.preauthorization?.mode}>
            {({ getFieldValue }) => getFieldValue(["preauthorization", "mode"]) === "risk_surcharge" ? <Form.Item name={["preauthorization", "riskSurchargeAmount"]} label="风险附加额度" tooltip="仅在预授权规则选择“租金倍数 + 风险附加”时使用。">
              <InputNumber min={0} disabled={!category.businessModel.supportsPreauthorization} style={{ width: "100%" }} />
            </Form.Item> : null}
          </Form.Item>
        </Col>
        <Col span={24}>
          <Alert
            type="warning"
            showIcon
            title={t("会员押金/预授权减免默认关闭")}
            description={t("启用后仅对仍有效且无未关闭风险记录的会员生效；商品必须已设置风控等级并被下方规则允许。每笔减免同时受比例上限和金额上限约束，未分级商品不参与。")}
          />
        </Col>
        <Col span={12}>
          <Form.Item
            name={["membershipSecurityReduction", "deposit", "enabled"]}
            label="允许会员减免押金"
            tooltip="默认关闭。启用不代表所有会员自动免押，还需填写允许的商品风险等级和双重上限。"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Col>
        <Form.Item noStyle shouldUpdate={(previous, current) => previous.membershipSecurityReduction?.deposit?.enabled !== current.membershipSecurityReduction?.deposit?.enabled}>
          {({ getFieldValue }) => getFieldValue(["membershipSecurityReduction", "deposit", "enabled"]) ? <>
            <Col span={8}>
              <Form.Item name={["membershipSecurityReduction", "deposit", "allowedRiskLevels"]} label="押金减免允许的商品风险等级" rules={[{ required: true, message: t("至少选择一个商品风险等级") }]}>
                <Select mode="multiple" options={securityRiskLevelOptions(t)} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={["membershipSecurityReduction", "deposit", "maxReductionPercent"]} label="押金减免比例上限（%）" rules={[{ required: true, message: t("请填写大于0且不超过100的比例") }]}>
                <InputNumber min={0.01} max={100} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={["membershipSecurityReduction", "deposit", "maxReductionAmount"]} label="押金单笔减免金额上限" rules={[{ required: true, message: t("请填写单笔减免金额上限") }]}>
                <InputNumber min={0.01} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </> : null}
        </Form.Item>
        <Col span={12}>
          <Form.Item
            name={["membershipSecurityReduction", "preauthorization", "enabled"]}
            label="允许会员降低预授权"
            tooltip="默认关闭。预授权是冻结额度，不是已收款；不支持预授权的品类无法启用。"
            valuePropName="checked"
          >
            <Switch disabled={!category.businessModel.supportsPreauthorization} />
          </Form.Item>
        </Col>
        <Form.Item noStyle shouldUpdate={(previous, current) => previous.membershipSecurityReduction?.preauthorization?.enabled !== current.membershipSecurityReduction?.preauthorization?.enabled}>
          {({ getFieldValue }) => category.businessModel.supportsPreauthorization && getFieldValue(["membershipSecurityReduction", "preauthorization", "enabled"]) ? <>
            <Col span={8}>
              <Form.Item name={["membershipSecurityReduction", "preauthorization", "allowedRiskLevels"]} label="预授权减免允许的商品风险等级" rules={[{ required: true, message: t("至少选择一个商品风险等级") }]}>
                <Select mode="multiple" options={securityRiskLevelOptions(t)} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={["membershipSecurityReduction", "preauthorization", "maxReductionPercent"]} label="预授权减免比例上限（%）" rules={[{ required: true, message: t("请填写大于0且不超过100的比例") }]}>
                <InputNumber min={0.01} max={100} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name={["membershipSecurityReduction", "preauthorization", "maxReductionAmount"]} label="预授权单笔减免金额上限" rules={[{ required: true, message: t("请填写单笔减免金额上限") }]}>
                <InputNumber min={0.01} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </> : null}
        </Form.Item>
      </Row>
    ),
  },
  {
    key: "cancellation-overdue",
    title: "取消、爽约与逾期",
    description: "客户提前取消、过期未取、逾期归还时如何计费；金额按下单时的规则版本冻结。",
    render: ({ t }) => (
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item
            name={["cancellation", "freeBeforeHours"]}
            label="领取前多少小时内取消开始收费"
            tooltip="作用：领取时间前超过该小时数取消免费，之内取消按下面规则收费。默认 0 表示随时可免费取消。"
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["cancellation", "lateFeeType"]}
            label="晚取消收费"
            tooltip="作用：进入收费区间后按哪种方式计取消费。默认不收取。"
          >
            <Select options={selectOptions(lateFeeTypeLabels, ["none", "fixed_amount", "percentage"], t)} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["cancellation", "lateFeeValue"]}
            label="取消费金额或比例（随收费方式）"
            tooltip="作用：固定金额按结算币种填写；应付金额百分比填 0-100。默认 0 表示不收取消费。"
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["cancellation", "weatherExceptionEnabled"]}
            label="天气例外"
            tooltip="作用：开启后天气或不可抗力可按例外免收取消费并留痕。默认关闭。"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["cancellation", "noShow", "enabled"]}
            label="启用爽约处理"
            tooltip="领取超过宽限后先进入待确认爽约；通知客户并达到最终时限后，才能确认爽约并释放占用。未配置时默认关闭。"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["cancellation", "noShow", "pickupGraceMinutes"]}
            label="领取宽限（分钟）"
            tooltip="作用：超过约定领取时间后的等待窗口，超过才进入待确认爽约。0 表示到点即计。"
            rules={[{ required: true, message: "请填写领取宽限" }]}
          >
            <InputNumber min={0} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["cancellation", "noShow", "finalizationMinutes"]}
            label="通知后最终确认（分钟）"
            tooltip="作用：通知客户后到可判定爽约的等待时长，到点或人工确认后才释放占用。最少 1 分钟。"
            rules={[{ required: true, message: "请填写最终确认时限" }]}
          >
            <InputNumber min={1} precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["cancellation", "noShow", "feeType"]}
            label="爽约费用类型"
            tooltip="作用：判定爽约后按哪种方式收费。默认不收取。"
          >
            <Select options={selectOptions(lateFeeTypeLabels, ["none", "fixed_amount", "percentage"], t)} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["cancellation", "noShow", "feeValue"]}
            label="爽约费用值"
            tooltip="固定金额按结算币种填写；百分比填写 0-100。"
            rules={[{ required: true, message: "请填写爽约费用值" }]}
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["overdue", "graceMinutes"]}
            label="逾期宽限分钟"
            tooltip="作用：超过归还时间后的免费宽限时长，超过才开始计逾期费。0 表示到点即计。"
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["overdue", "feeMode"]}
            label="逾期收费"
            tooltip="不收取＝不计逾期费；按小时＝按已购单位折算小时价；按下一计费周期＝按逾期占用的计价周期数；租金倍数＝原租金固定倍率；人工核定＝转人工处理；按小时折日＝宽限后按小时比例、超过阈值转日费。"
          >
            <Select options={selectOptions(overdueFeeModeLabels, ["none", "hourly", "next_period", "multiplier", "manual_review", "hourly_to_daily"], t)} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["overdue", "feeMultiplier"]}
            label="逾期倍率"
            tooltip="作用：逾期收费选「租金倍数」时，按原租金乘以该倍率计费。默认 0。"
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["overdue", "maximumFee"]}
            label="逾期封顶"
            tooltip="作用：单笔逾期费的上限。留空表示不封顶。"
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Form.Item noStyle shouldUpdate={(previous, current) => previous.overdue?.feeMode !== current.overdue?.feeMode}>
          {({ getFieldValue }) => getFieldValue(["overdue", "feeMode"]) === "hourly_to_daily" ? <>
            <Col span={12}><Form.Item name={["overdue", "hourlyRatePercent"]} label="逾期每小时按日租金的百分比收取" rules={[{ required: true, message: "请填写每小时比例" }]} tooltip="例如 10 表示每小时收原版本对应日价的 10%；不重复享受营销优惠。"><InputNumber min={0.01} max={100} suffix="%" style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={12}><Form.Item name={["overdue", "dailyAfterHours"]} label="逾期超过多少小时按整天计" rules={[{ required: true, message: "请填写逾时转日阈值" }]} tooltip="先扣除一次宽限；每连续 24 小时内，余段超过该阈值或小时费达到日费，改收一天，不叠加小时费。"><InputNumber min={0.01} max={24} style={{ width: "100%" }} /></Form.Item></Col>
          </> : null}
        </Form.Item>
      </Row>
    ),
  },
  {
    key: "extension-early-return",
    title: "续租与提前归还",
    description: "允许续租/提前归还时的计费。",
    render: ({ t }) => (
      <>
        <Alert
          type="info"
          showIcon
          title={t("选择本空间的续租计费方式")}
          description={t("单独计费保留原租期金额，新增时段按申请时价格计算；完整重算沿用原价格与原优惠，再扣此前已计金额。两种方式都检查后续占用及缓冲。发布后新订单固定所选方式，改设置不影响旧订单。")}
          style={{ marginBottom: 12 }}
        />
        <Row gutter={12}>
          <Col span={24}>
            <Form.Item
              name={["extension", "pricingMode"]}
              label="续租计费方式"
              tooltip="作用：续租新增时段怎么计价。默认单独计费；完整重算会按原价格与原优惠重算整租期再扣已计金额。"
              rules={[{ required: true }]}
            >
              <Select options={[{ value: "incremental", label: t("新增时段单独计费（原方式）") }, { value: "original_total", label: t("按原价格重算完整租期，只补差价") }]} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name={["extension", "enabled"]}
              label="允许续租"
              tooltip="作用：关闭后客户不能对订单续租。默认开启。"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name={["extension", "maxTimes"]} label="最多续租次数" tooltip="留空表示不限">
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name={["extension", "maxTotalDays"]} label="累计延长天数上限" tooltip="留空表示不限">
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name={["extension", "forceImmediateWhenOverdue"]}
              label="逾期后续租必须先付款"
              tooltip="沿用新增时段计费时，企业月结订单逾期后可强制先付。原价全租期补差暂不自动处理逾期订单，须先人工核价。默认开启。"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name={["earlyReturn", "mode"]}
              label="提前归还退款"
              tooltip="作用：提前归还是否退剩余租金以及怎么退。默认不退租金。"
            >
              <Select
                options={[
                  { value: "none", label: t("不退租金") },
                  { value: "auto", label: t("按规则自动退") },
                  { value: "manual_review", label: t("人工审批后退") },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name={["earlyReturn", "minAdvanceHours"]}
              label="最少提前小时数"
              tooltip="汽车租赁惯例填 24：提前不足一天不退。0 表示不设提前门槛。"
            >
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name={["earlyReturn", "refundPercent"]}
              label="提前归还退还剩余租金比例(%)"
              tooltip="作用：达到退款条件时，剩余未使用租金按该比例退还。填 0-100，默认 0 表示不退。"
            >
              <InputNumber min={0} max={100} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name={["earlyReturn", "maxRefundAmount"]} label="单笔退款上限" tooltip="留空表示不封顶">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              name={["earlyReturn", "refundUndeliveredServices"]}
              label="退未发生的服务费"
              tooltip="作用：开启后提前归还会一并退还尚未发生的增值服务费。默认关闭。"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Col>
        </Row>
      </>
    ),
  },
  {
    key: "damage-qualification",
    title: "损坏与资质",
    description: "损坏定责与下单前的资质门槛。",
    render: ({ t }) => (
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item
            name={["damage", "manualReviewRequired"]}
            label="损坏人工核定"
            tooltip="作用：开启后损坏费用须人工核定才能计入，不自动收取。默认关闭。"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["damage", "chargeLimit"]}
            label="损坏收费封顶"
            tooltip="作用：单笔损坏费用的上限。留空表示不封顶。"
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["qualification", "required"]}
            label="必须审核资质"
            tooltip="作用：开启后客户须通过资质审核才能下单。默认关闭。"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["qualification", "documentTypes"]}
            label="证件类型"
            tooltip="作用：下单前需要提交并审核的证件类型；回车添加多个。留空表示不限定具体证件。"
          >
            <Select mode="tags" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={["qualification", "minimumValidityDays"]}
            label="证件到期前至少还需剩余天数"
            tooltip="作用：证件在租期开始时的最短剩余有效天数，不足则不能下单。0 表示只要未过期即可。"
          >
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Col>
      </Row>
    ),
  },
  {
    key: "tax",
    title: "税",
    description: "开票与计税展示。",
    render: ({ t }) => (
      <>
        <Alert
          type="info"
          showIcon
          title={t("标价即含税，客户看到的应付金额不变")}
          description={t("税额由含税额反算（含税额 × 税率 ÷ (1 + 税率)），只进报表与开票，不改变报价与订单的应付金额。押金不计税。香港等无增值税的空间填 0 即可。")}
          style={{ marginBottom: 12 }}
        />
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item
              name={["tax", "rate"]}
              label="税率"
              tooltip="小数形式：13% 填 0.13，6% 填 0.06，不计税填 0"
            >
              <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name={["tax", "label"]} label="票面税种" tooltip="仅用于展示与开票参考，不参与计算">
              <Input placeholder={t("例如：增值税 13%")} />
            </Form.Item>
          </Col>
          {/* inclusive 恒为 true：价外税还没实现，给个只读开关比留一个能拨错的选项安全。 */}
          <Col span={8}>
            <Form.Item name={["tax", "inclusive"]} label="价内税" valuePropName="checked" tooltip="当前只支持价内税">
              <Switch disabled />
            </Form.Item>
          </Col>
        </Row>
      </>
    ),
  },
];

/**
 * 把某个规则版本的内容回填进规则草稿表单。RulesTab 的「编辑/新建草稿」与「新建规则向导」
 * 共用这一份 seed-in 逻辑：押金/预授权由 `ruleSecurityGroups` 派生成两组独立规则，
 * 后加的可选块（续租、提前归还、税、爽约）缺省时补上与服务端一致的默认值，
 * 避免表单只填一半、提交出过不了校验的半成品。不支持预授权的品类强制回落 `none`。
 *
 * 与旧的内联实现逐字一致：任何一处改动都会同时作用于两个入口，不再各自漂移。
 */
export function seedFormFromRule(
  form: FormInstance<RuleForm>,
  source: RentalRuleVersion,
  category: RentalCategoryDefinition,
): void {
  const config = structuredClone(source.config);
  const security = ruleSecurityGroups(config);
  if (category.businessModel.supportsPreauthorization === false) {
    security.preauthorization = { mode: "none" };
  }
  form.resetFields();
  form.setFieldsValue({
    ...config,
    ...security,
    extension: { pricingMode: "incremental", ...(config.extension ?? { enabled: true, forceImmediateWhenOverdue: true }) },
    earlyReturn: config.earlyReturn ?? { mode: "none", minAdvanceHours: 24, refundPercent: 0, refundUndeliveredServices: false },
    tax: config.tax ?? { rate: 0, inclusive: true },
    cancellation: {
      ...(config.cancellation ?? {}),
      // 与服务端及新空间初始化共用默认值；打开旧草稿不能悄悄带入 100% 爽约费。
      noShow: config.cancellation?.noShow ?? defaultRentalNoShowRule(),
    },
    changeReason: source.status === "draft" ? source.changeReason : "调整租赁业务规则",
  } as RuleForm);
}

/**
 * 把规则草稿表单值映射回 `saveRuleVersion` 的 `config`。RulesTab 与向导共用这一份 map-out：
 * 押金/预授权经 `normalizeSecurityRules` 按当前模式裁掉隐藏字段，`payment.depositMode` 与
 * `payment.preauthorizationRequired` 由两组独立规则派生——不支持预授权的品类只会得到 `none`。
 */
export function formToConfig(
  values: RuleForm,
  category: RentalCategoryDefinition,
): SaveRentalRuleVersionRequest["config"] {
  const { changeReason: _changeReason, ...config } = values;
  const security = normalizeSecurityRules(
    config,
    category.businessModel.supportsPreauthorization !== false,
  );
  const deposit = security.deposit;
  const preauthorization = security.preauthorization;
  return {
    ...config,
    deposit,
    preauthorization,
    payment: {
      ...config.payment,
      depositMode:
        deposit.mode !== "none"
          ? deposit.mode === "order_fixed" ? "fixed" : deposit.mode
          : preauthorization.mode !== "none"
            ? "preauthorization"
            : "none",
      preauthorizationRequired: preauthorization.mode !== "none",
    },
  };
}

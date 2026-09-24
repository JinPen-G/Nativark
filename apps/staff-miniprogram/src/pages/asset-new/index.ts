import type { RentalAsset, RentalAttributeDefinition, RentalFulfillmentLocation, SaveRentalAssetRequest } from "@rental-os/shared";
import { getAsset, saveAsset } from "../../api/assets";
import { listItemGroups } from "../../api/context";
import { loadContext, terms } from "../../core/context";
import { describeError } from "../../core/errors";
import { blockedState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { can, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, relaunch, toast } from "../../core/ui";

interface FieldRow { code: string; label: string; type: string; required: boolean; options: string[]; value: string; checked: boolean; }

Page({
  behaviors: [themeBehavior],
  data: { view: loadingState() as ViewState, id: "", assetLabel: "物品", serialLabel: "序列号", itemGroupId: "", itemGroupName: "", assetNo: "", serialNo: "", supportsSerialNo: false, requiresSerialNo: false, locationId: "", locationName: "", status: "available", groups: [] as Array<{ id: string; name: string }>, locations: [] as Array<{ id: string; name: string }>, fields: [] as FieldRow[], busy: false, error: "" },
  asset: undefined as RentalAsset | undefined,
  definitions: [] as RentalAttributeDefinition[],
  onLoad(query: Record<string, string>) { this.setData({ id: query.id ?? "" }); },
  onShow() { if (!isSignedIn()) { relaunch(ROUTES.login); return; } void this.load(); },
  async load() {
    if (!can("rental-core:asset:manage")) { this.setData({ view: blockedState("无编辑权限", "请联系租户管理员授权库存管理权限", "联系管理员", "contact") }); return; }
    this.setData({ view: loadingState() });
    try {
      const [context, groups, asset] = await Promise.all([loadContext(), listItemGroups(), this.data.id ? getAsset(this.data.id) : Promise.resolve(undefined)]);
      if (this.data.id && !asset) { this.setData({ view: blockedState("记录不可用", "该物品不在当前经营空间") }); return; }
      this.asset = asset;
      // serialNo 是独立顶层字段；同一字段不应再渲染为 attributes 表单项。
      this.definitions = context.assetFields.filter((field) => field.scope === "asset" && field.code !== "serialNo");
      const fields = this.definitions.map((field) => ({ code: field.code, label: field.label, type: field.type, required: Boolean(field.required), options: field.options ?? [], value: String(asset?.attributes[field.code] ?? ""), checked: Boolean(asset?.attributes[field.code]) }));
      const availableGroups = groups.filter((row) => row.status === "enabled" && row.inventoryMode === "serialized").map((row) => ({ id: row.id, name: row.name }));
      const locations = context.locations.map((row: RentalFulfillmentLocation) => ({ id: row.id, name: row.name }));
      this.setData({ view: readyState(), assetLabel: terms().assetLabel, serialLabel: terms().serialLabel, itemGroupId: asset?.itemGroupId ?? "", itemGroupName: asset?.itemGroupName ?? "", assetNo: asset?.assetNo ?? "", serialNo: asset?.serialNo ?? "", supportsSerialNo: context.assetFields.some((field) => field.scope === "asset" && field.code === "serialNo"), requiresSerialNo: context.assetFields.some((field) => field.scope === "asset" && field.code === "serialNo" && field.required), locationId: asset?.locationId ?? context.currentLocationId, locationName: asset?.locationName ?? locations.find((row) => row.id === context.currentLocationId)?.name ?? "", status: asset?.status ?? "available", groups: availableGroups, locations, fields });
    } catch (error) { this.setData({ view: errorState(error) }); }
  },
  onInput(event: WechatMiniprogram.Input) { const key = String(event.currentTarget.dataset.field); this.setData({ [key]: String(event.detail.value ?? ""), error: "" }); },
  onGroupChange(event: WechatMiniprogram.PickerChange) { const row = this.data.groups[Number(event.detail.value)]; if (row) this.setData({ itemGroupId: row.id, itemGroupName: row.name, error: "" }); },
  onLocationChange(event: WechatMiniprogram.PickerChange) { const row = this.data.locations[Number(event.detail.value)]; if (row) this.setData({ locationId: row.id, locationName: row.name, error: "" }); },
  onFieldInput(event: WechatMiniprogram.Input) { const i = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${i}].value`]: String(event.detail.value ?? ""), error: "" }); },
  onFieldSelect(event: WechatMiniprogram.PickerChange) { const i = Number(event.currentTarget.dataset.index); const value = this.data.fields[i]?.options[Number(event.detail.value)] ?? ""; this.setData({ [`fields[${i}].value`]: value, error: "" }); },
  onFieldDate(event: WechatMiniprogram.PickerChange) { const i = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${i}].value`]: String(event.detail.value ?? ""), error: "" }); },
  onFieldBool(event: WechatMiniprogram.SwitchChange) { const i = Number(event.currentTarget.dataset.index); this.setData({ [`fields[${i}].checked`]: Boolean(event.detail.value), error: "" }); },
  async onSave() {
    if (this.data.busy) return;
    if (!this.data.itemGroupId || !this.data.assetNo.trim() || !this.data.locationId) { this.setData({ error: `请填写${this.data.assetLabel}型号、编号和所在地点` }); return; }
    if (this.data.requiresSerialNo && !this.data.serialNo.trim()) { this.setData({ error: `请填写${this.data.serialLabel}` }); return; }
    const attributes: Record<string, unknown> = {};
    for (const field of this.data.fields) {
      const value = field.type === "boolean" ? field.checked : field.type === "number" && field.value.trim() ? Number(field.value) : field.value.trim();
      if (field.required && (value === "" || value === undefined)) { this.setData({ error: `请填写${field.label}` }); return; }
      if (field.type === "number" && field.value.trim() && !Number.isFinite(value)) { this.setData({ error: `${field.label}必须是数字` }); return; }
      if (value !== "") attributes[field.code] = value;
    }
    const input: SaveRentalAssetRequest = { id: this.data.id || undefined, itemGroupId: this.data.itemGroupId, assetNo: this.data.assetNo.trim(), serialNo: this.data.serialNo.trim() || undefined, locationId: this.data.locationId, status: this.asset?.status, attributes };
    this.setData({ busy: true, error: "" });
    try { const saved = await saveAsset(input); toast("已保存", { icon: "success" }); relaunch(buildUrl(ROUTES.asset, { id: saved.id })); }
    catch (error) { this.setData({ error: describeError(error).message }); }
    finally { this.setData({ busy: false }); }
  },
  onViewAction() { if (!handleCommonViewAction(this.data.view, { redirect: buildUrl(ROUTES.assetNew, { id: this.data.id }) })) void this.load(); }
});

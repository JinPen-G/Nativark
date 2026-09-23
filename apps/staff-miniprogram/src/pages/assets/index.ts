import type { RentalAsset, RentalItemGroup, RentalStockBalance } from "@rental-os/shared";
import { listAssets, listStockBalances } from "../../api/assets";
import { listItemGroups } from "../../api/context";
import { cachedContext, categoryIcon, contextEvents, currentLocationLabel, inCurrentLocation, loadContext, setCurrentLocation, type WorkspaceContext } from "../../core/context";
import { resolveImage } from "../../core/images";
import { assetStatusLabel, assetStatusTone, type Tone } from "../../core/labels";
import { blockedState, emptyState, errorState, handleCommonViewAction, loadingState, readyState, type ViewState } from "../../core/page";
import { indexItemGroups, itemGroupCover } from "../../core/presenters";
import { can, contextVersion, isSignedIn } from "../../core/session";
import { themeBehavior } from "../../core/theme-behavior";
import { ROUTES, buildUrl, navigate, relaunch } from "../../core/ui";

/**
 * {资产}列表 / 库存查询：搜索（编号/序列号/型号名，本地）+ 状态筛选 + 当前地点范围。
 * 序列化资产逐条列卡；数量类库存（余额）在顶部折叠区按型号 × 地点展示。
 * 名词全部经 terms() 取，状态文案经 labels；本页不出现任何品类词。
 */
interface AssetCard {
  id: string;
  itemGroupName: string;
  assetNo: string;
  serialNo: string;
  statusLabel: string;
  statusTone: Tone;
  locationName: string;
  imageSource: string;
  imagePath: string;
}

interface BalanceRow {
  key: string;
  itemGroupName: string;
  locationName: string;
  onHand: number;
  reserved: number;
  available: number;
}

interface StatusChip {
  key: string;
  label: string;
}

interface AssetsData {
  view: ViewState;
  context?: WorkspaceContext;
  locationLabel: string;
  keyword: string;
  status: string;
  itemGroupId: string;
  itemGroupName: string;
  chips: StatusChip[];
  cards: AssetCard[];
  total: number;
  balances: BalanceRow[];
  balancesOpen: boolean;
  canManage: boolean;
  placeholderIcon: string;
  showLocationSheet: boolean;
}

const STATUS_KEYS = ["available", "reserved", "rented", "inspection", "maintenance", "disabled"];

Page({
  behaviors: [themeBehavior],
  data: {
    view: loadingState(),
    locationLabel: "",
    keyword: "",
    status: "all",
    itemGroupId: "",
    itemGroupName: "",
    chips: [{ key: "all", label: "全部" }, ...STATUS_KEYS.map((key) => ({ key, label: assetStatusLabel(key) }))],
    cards: [],
    total: 0,
    balances: [],
    balancesOpen: false,
    canManage: false,
    placeholderIcon: "box",
    showLocationSheet: false
  } as AssetsData,
  all: [] as RentalAsset[],
  allBalances: [] as RentalStockBalance[],
  groups: new Map<string, RentalItemGroup>(),
  offContext: undefined as (() => void) | undefined,
  requestVersion: 0,

  onLoad(query: Record<string, string>) {
    this.setData({
      status: query.status && STATUS_KEYS.includes(query.status) ? query.status : "all",
      itemGroupId: query.itemGroupId ?? ""
    });
    this.offContext = contextEvents.on(() => {
      this.setData({ context: cachedContext(), locationLabel: currentLocationLabel(), placeholderIcon: categoryIcon() });
      this.applyFilter();
    });
  },

  onUnload() {
    this.offContext?.();
  },

  onShow() {
    if (!isSignedIn()) {
      relaunch(ROUTES.login);
      return;
    }
    void this.load();
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh());
  },

  async load(force = false) {
    const token = ++this.requestVersion;
    const version = contextVersion();
    if (!can("rental-core:asset:view", "rental-core:asset:manage")) {
      this.setData({ view: blockedState("暂无查看权限", "当前账号没有查看库存的权限，请联系租户管理员", "联系管理员", "contact") });
      return;
    }
    if (!this.all.length) this.setData({ view: loadingState() });
    try {
      const context = await loadContext();
      this.setData({ context, locationLabel: currentLocationLabel(), canManage: can("rental-core:asset:manage"), placeholderIcon: categoryIcon(context.categoryCode) });
      const [assets, groups, balances] = await Promise.all([listAssets(force), listItemGroups().catch(() => [] as RentalItemGroup[]), listStockBalances().catch(() => [] as RentalStockBalance[])]);
      if (token !== this.requestVersion || version !== contextVersion()) return;
      this.all = assets;
      this.allBalances = balances;
      this.groups = indexItemGroups(groups);
      this.setData({ itemGroupName: this.data.itemGroupId ? this.groups.get(this.data.itemGroupId)?.name ?? "" : "" });
      this.applyFilter();
    } catch (error) {
      if (token !== this.requestVersion) return;
      this.setData({ view: errorState(error) });
    }
  },

  applyFilter() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const filtered = this.all
      .filter((asset) => inCurrentLocation(asset.locationId))
      .filter((asset) => !this.data.itemGroupId || asset.itemGroupId === this.data.itemGroupId)
      .filter((asset) => this.data.status === "all" || asset.status === this.data.status)
      .filter((asset) => !keyword || [asset.assetNo, asset.serialNo ?? "", asset.itemGroupName, asset.itemGroupCode].some((text) => text.toLowerCase().includes(keyword)))
      .sort((a, b) => a.itemGroupName.localeCompare(b.itemGroupName) || a.assetNo.localeCompare(b.assetNo));
    const cards: AssetCard[] = filtered.map((asset) => {
      const previous = this.data.cards.find((row) => row.id === asset.id);
      return {
        id: asset.id,
        itemGroupName: asset.itemGroupName,
        assetNo: asset.assetNo,
        serialNo: asset.serialNo ?? "",
        statusLabel: assetStatusLabel(asset.status),
        statusTone: assetStatusTone(asset.status),
        locationName: asset.locationName,
        imageSource: itemGroupCover(this.groups.get(asset.itemGroupId)),
        imagePath: previous?.imagePath ?? ""
      };
    });
    const balances: BalanceRow[] = this.allBalances
      .filter((row) => inCurrentLocation(row.locationId))
      .filter((row) => !this.data.itemGroupId || row.itemGroupId === this.data.itemGroupId)
      .filter((row) => !keyword || row.itemGroupName.toLowerCase().includes(keyword) || row.itemGroupCode.toLowerCase().includes(keyword))
      .map((row) => ({ key: row.id, itemGroupName: row.itemGroupName, locationName: row.locationName, onHand: row.onHandQuantity, reserved: row.reservedQuantity, available: row.availableQuantity }));
    const t = this.data.context?.terminology;
    const hasAny = cards.length > 0 || balances.length > 0;
    this.setData({
      cards,
      total: cards.length,
      balances,
      view: hasAny ? readyState() : emptyState(`没有符合条件的${t?.assetLabel ?? "物品"}`, keyword ? "换个关键字试试" : `当前${t?.fulfillmentLabel ?? "门店"}范围内暂无记录`)
    });
    const version = contextVersion();
    cards.forEach((card, index) => {
      if (!card.imageSource || card.imagePath) return;
      resolveImage(card.imageSource).then((path) => {
        if (path && contextVersion() === version && this.data.cards[index]?.id === card.id) this.setData({ [`cards[${index}].imagePath`]: path });
      });
    });
  },

  onKeyword(event: WechatMiniprogram.Input) {
    this.setData({ keyword: String(event.detail.value ?? "") });
    this.applyFilter();
  },

  onClearKeyword() {
    this.setData({ keyword: "" });
    this.applyFilter();
  },

  onChip(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.key ?? "all");
    if (status === this.data.status) return;
    this.setData({ status });
    this.applyFilter();
  },

  onClearGroup() {
    this.setData({ itemGroupId: "", itemGroupName: "" });
    this.applyFilter();
  },

  onToggleBalances() {
    this.setData({ balancesOpen: !this.data.balancesOpen });
  },

  onOpenLocation() {
    if (!this.data.context?.locations.length) return;
    this.setData({ showLocationSheet: true });
  },

  onCloseLocation() {
    this.setData({ showLocationSheet: false });
  },

  onPickLocation(event: WechatMiniprogram.TouchEvent) {
    setCurrentLocation(String(event.currentTarget.dataset.id ?? ""));
    this.setData({ showLocationSheet: false, locationLabel: currentLocationLabel() });
    this.applyFilter();
  },

  onAsset(event: WechatMiniprogram.TouchEvent) {
    navigate(buildUrl(ROUTES.asset, { id: String(event.currentTarget.dataset.id ?? "") }));
  },

  onLedger() {
    navigate(buildUrl(ROUTES.assetLedger, { itemGroupId: this.data.itemGroupId || undefined }));
  },

  onCreate() {
    if (!can("rental-core:asset:manage")) return;
    navigate(ROUTES.assetNew);
  },

  onViewAction() {
    if (handleCommonViewAction(this.data.view, { redirect: ROUTES.assets })) return;
    void this.load(true);
  }
});

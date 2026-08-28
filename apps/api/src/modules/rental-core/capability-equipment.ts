import { BadRequestException } from "@nestjs/common";
import type {
  RentalAsset,
  RentalCapabilityEquipmentLine,
  RentalInventoryMode
} from "@store-rental/shared";

/** 富化只需要商品组的这几项，因此收窄接口而不是依赖完整的 RentalItemGroup。 */
export interface CapabilityEquipmentGroup {
  id: string;
  name: string;
  inventoryMode: RentalInventoryMode;
  attributes?: Record<string, unknown>;
}

export interface CapabilityEquipmentLineInput {
  itemGroupId: string;
  quantity: number;
}

/**
 * P2-1：报价、订单与配货**共用**的器材富化。
 *
 * 早前报价侧自行组装（`inventoryMode as never`、找不到商品就用 id 冒充名称），
 * 订单侧走另一份实现（找不到商品直接抛），两者对同一条脏数据给出不同结果——
 * 于是「报价能出、下单却报错」这类不一致只能靠运气发现。
 *
 * 这里是与品类无关的**数据透传**：只把 itemGroupId 展开成名称、库存模式与属性，
 * 让能力看得到卡口/画幅/供电等信息。Core 自身不读这些属性、不做任何品类判断。
 *
 * 找不到商品一律明确报错：用 id 顶替名称会把「数据缺失」伪装成「商品叫这个名字」，
 * 而能力随后基于空属性得出「无风险」，等于把缺失静默转成放行。
 */
export function buildCapabilityEquipment(
  groups: Map<string, CapabilityEquipmentGroup>,
  lines: CapabilityEquipmentLineInput[]
): RentalCapabilityEquipmentLine[] {
  return lines.map((line) => {
    const group = groups.get(line.itemGroupId);
    if (!group) {
      throw new BadRequestException(`商品 ${line.itemGroupId} 不存在，无法进行能力兼容性判定`);
    }
    return {
      itemGroupId: group.id,
      itemGroupName: group.name,
      inventoryMode: group.inventoryMode,
      quantity: line.quantity,
      attributes: { ...(group.attributes ?? {}) }
    };
  });
}

/**
 * P1-8：把**实际分配到的资产**解析成器材行。
 *
 * 报价阶段只能按商品组判定（那时还没选到具体资产）；配货阶段必须按真正挑中的机身、
 * 镜头、电池判定，否则同一商品组下「某台资产的属性被单独覆盖」「型号有差异」
 * 这类问题一个都发现不了。
 *
 * 属性合并顺序是「商品组属性 → 资产属性」：资产上显式登记的值覆盖商品组的默认值，
 * 未登记的沿用商品组。资产维度的差异正是本节点要看的东西。
 */
export function buildCapabilityEquipmentFromAssets(
  groups: Map<string, CapabilityEquipmentGroup>,
  assets: Array<Pick<RentalAsset, "id" | "assetNo" | "itemGroupId" | "attributes">>
): RentalCapabilityEquipmentLine[] {
  return assets.map((asset) => {
    const group = groups.get(asset.itemGroupId);
    if (!group) {
      throw new BadRequestException(`资产 ${asset.assetNo} 的商品 ${asset.itemGroupId} 不存在，无法进行能力兼容性判定`);
    }
    return {
      itemGroupId: group.id,
      itemGroupName: group.name,
      inventoryMode: group.inventoryMode,
      quantity: 1,
      assetId: asset.id,
      assetNo: asset.assetNo,
      attributes: { ...(group.attributes ?? {}), ...(asset.attributes ?? {}) }
    };
  });
}

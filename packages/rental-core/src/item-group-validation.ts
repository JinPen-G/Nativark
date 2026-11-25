/** Rental 专业商品属性约束，保存流程在通用字段校验后调用已登记的品类规则。 */
import { BadRequestException } from "@nestjs/common";
import { RentalCategoryCode } from "./contracts";

type ItemGroupAttributesValidator = (attributes: Record<string, unknown>) => void;

const validators: Partial<Record<RentalCategoryCode, ItemGroupAttributesValidator>> = {
  [RentalCategoryCode.Camping]: (attributes) => {
    const capacity = attributes.capacity;
    if (capacity !== undefined && capacity !== null && capacity !== "" && (!Number.isFinite(Number(capacity)) || Number(capacity) <= 0)) {
      throw new BadRequestException("露营装备容量必须大于0升");
    }
  },
  [RentalCategoryCode.Construction]: (attributes) => {
    const ratedLoad = attributes.ratedLoad;
    const ratedLoadUnit = attributes.ratedLoadUnit;
    if ((ratedLoad === undefined || ratedLoad === null || ratedLoad === "") !== (ratedLoadUnit === undefined || ratedLoadUnit === null || ratedLoadUnit === "")) {
      throw new BadRequestException("填写额定载荷时必须同时选择 kg 或 t 单位");
    }
    if (ratedLoad !== undefined && ratedLoad !== null && Number(ratedLoad) <= 0) {
      throw new BadRequestException("额定载荷必须大于0");
    }
  }
};

export function validateCategoryItemGroupAttributes(categoryCode: RentalCategoryCode, attributes: Record<string, unknown>): void {
  validators[categoryCode]?.(attributes);
}

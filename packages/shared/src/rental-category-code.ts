/** Rental-owned stable identity. Format is not evidence of registration, publication or adoption authority. */
export const RentalCategoryCode = Object.freeze({
  Vehicle: "vehicle",
  Camera: "camera",
  Camping: "camping",
  Construction: "construction"
} as const);
export type RentalCategoryCode = string;
export type BuiltinRentalCategoryCode = typeof RentalCategoryCode[keyof typeof RentalCategoryCode];

/** 内置常量不是合法编码全集；存在性及当前采用资格由 Core 持久化目录决定。 */
// Strict end-of-input also rejects the final newline that JavaScript's `$` anchor would permit.
export const RENTAL_CATEGORY_CODE_PATTERN = /^(?!(?:constructor|prototype)$)[a-z][a-z0-9_]{1,63}(?![\s\S])/u;
export function isRentalCategoryCode(value: unknown): value is RentalCategoryCode {
  return typeof value === "string" && RENTAL_CATEGORY_CODE_PATTERN.test(value);
}

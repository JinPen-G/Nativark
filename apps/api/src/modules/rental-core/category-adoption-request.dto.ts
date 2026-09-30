import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsObject, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
import type { CategoryEntityPreparationPatch, SaveCategoryPreparationRequest } from "@rental-os/shared";

export class CategoryEntityPreparationPatchDto implements CategoryEntityPreparationPatch {
  @IsIn(["item_group", "asset"]) entityType!: "item_group" | "asset";
  @IsString() @Matches(/\S/u) @MaxLength(191) entityId!: string;
  @IsString() @MaxLength(32) expectedUpdatedAt!: string;
  @IsObject() values!: CategoryEntityPreparationPatch["values"];
}
export class SaveCategoryPreparationDto implements SaveCategoryPreparationRequest {
  @IsString() @Matches(/\S/u) @MaxLength(191) expectedSourceVersionId!: string;
  @IsInt() @Min(0) expectedSourceRevision!: number;
  @IsInt() @Min(0) expectedPreparationRevision!: number;
  @IsIn(["upgrade", "restore"]) operation!: "upgrade" | "restore";
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => CategoryEntityPreparationPatchDto) patches!: CategoryEntityPreparationPatchDto[];
  @IsString() @Matches(/\S/u) @MaxLength(512) reason!: string;
}

import { plainToInstance } from "class-transformer";
import { validateSync, type ValidationError } from "class-validator";
import { RentalRuleConfigInputDto } from "./rental-config-request.dto";

/** Reuse the real rule input contract, including renewal, early-return and tax.
 * Validate a detached projection without coercion, stripping unknown fields,
 * filling defaults or rewriting stored/historical JSON. */
export function categoryAdoptionRuleStructureErrors(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return ["规则必须为对象"];
  try {
    // The transformer deliberately drops prototype-related keys. Reject them
    // BEFORE projection so unsafe/unknown stored fields cannot disappear and
    // accidentally turn an invalid candidate into a validated one.
    const visiting = new WeakSet<object>();
    const safeTree = (node: unknown, depth = 0): boolean => {
      if (node === null || typeof node !== "object") return true;
      if (depth > 50 || visiting.has(node)) return false;
      visiting.add(node);
      const safe = Object.entries(node).every(([key, child]) => !["__proto__", "constructor", "prototype"].includes(key) && safeTree(child, depth + 1));
      visiting.delete(node);
      return safe;
    };
    if (!safeTree(value)) return ["规则含不安全字段或无法读取的嵌套结构，请通过规则发布机制修复"];
    const projection = plainToInstance(RentalRuleConfigInputDto, value, { enableImplicitConversion: false });
    const errors = validateSync(projection, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, validationError: { target: false, value: false } });
    const paths: string[] = [];
    const collect = (rows: ValidationError[], parent = "") => {
      for (const row of rows) {
        const path = parent ? `${parent}.${row.property}` : row.property;
        if (row.constraints) paths.push(path);
        if (row.children?.length) collect(row.children, path);
      }
    };
    collect(errors);
    return [...new Set(paths)].map((path) => `规则字段 ${path} 不符合当前执行契约，请通过规则发布机制修复`);
  } catch {
    return ["规则结构无法安全读取，请通过规则发布机制修复"];
  }
}

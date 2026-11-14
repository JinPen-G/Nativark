/**
 * Core页面的单源路由/菜单描述与类型化动作绑定；具体React组件由受控宿主传入。
 * 本包不渲染按钮、不执行动作或裁定权限，框架适配消费原UI/表单与当前授权。
 */
import { z } from "zod";
import { corePermissionCode, type CoreManifest } from "./manifest";

const localId = z.string().min(1).max(80).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$(?![\s\S])/);
const label = z.string().min(1).max(200);
export const CorePageTextSchema = z.union([
  label,
  z.object({ default: label, translations: z.record(label).optional() }).strict()
]);
export type CorePageText = z.infer<typeof CorePageTextSchema>;

const pagePath = z.string().min(1).max(240).refine(path => {
  if (path === "/") return true;
  const segments = path.split("/");
  return segments.shift() === "" && segments.every(segment => /^(?:[a-z0-9][a-z0-9-]*|:[a-z][a-zA-Z0-9]*)$(?![\s\S])/.test(segment))
    && new Set(segments.filter(segment => segment.startsWith(":"))).size === segments.filter(segment => segment.startsWith(":")).length;
}, "使用Core内路径，如/tickets或/tickets/:ticketId；禁止外部URL、通配及重复参数");

export const CorePageDescriptorSchema = z.object({
  id: localId,
  path: pagePath,
  title: CorePageTextSchema,
  parent: localId.optional(),
  /** 配置页面在Core已获权但尚未绑定/就绪时仍可进入，自己的动作权限照常核验。 */
  purpose: z.literal("configuration").optional(),
  /** 空集合仍须租户Core授权与成员分配；这里仅声明附加业务权限。 */
  permissions: z.array(z.object({ resource: localId, action: localId }).strict()),
  menu: z.object({ group: CorePageTextSchema.optional(), order: z.number().int().optional() }).strict().optional()
}).strict();
export type CorePageDescriptor = z.infer<typeof CorePageDescriptorSchema>;

/** 组件/懒加载值来自受控代码引用；不得将包路径、JSON或远端URL当组件加载器。 */
export type CoreAdminPage<TComponent> = CorePageDescriptor & { component: TComponent };
export interface CoreAdminContribution<TComponent> {
  coreId: string;
  implementationVersion: string;
  pages: readonly CoreAdminPage<TComponent>[];
}
export interface CoreRegisteredPage<TComponent> {
  coreId: string;
  key: string;
  path: string;
  definition: CoreAdminPage<TComponent>;
}
export interface CoreAdminIssue { coreId: string; field: string; message: string }
export type CoreAdminRegistrationResult<TComponent> =
  | { ok: true; pages: ReadonlyMap<string, CoreRegisteredPage<TComponent>> }
  | { ok: false; issues: CoreAdminIssue[] };

export const corePageKey = (coreId: string, pageId: string) => `${coreId}:${pageId}`;
export function corePageText(text: CorePageText, locale: string): string {
  return typeof text === "string" ? text : text.translations?.[locale] ?? text.default;
}

/** 注册仅核元数据/引用；菜单及页面仍须宿主依据当前授权过滤，不能从注册表推断读权。 */
export function registerCoreAdminPages<TComponent>(sources: readonly {
  manifest: CoreManifest; contribution: CoreAdminContribution<TComponent>;
}[]): CoreAdminRegistrationResult<TComponent> {
  const issues: CoreAdminIssue[] = [], pages = new Map<string, CoreRegisteredPage<TComponent>>(), ids = new Set<string>();
  for (const { manifest, contribution } of sources) {
    const add = (field: string, message: string) => issues.push({ coreId: manifest.id, field, message });
    if (ids.has(manifest.id)) add("coreId", "同一组合不能重复登记Core页面");
    ids.add(manifest.id);
    if (!manifest.entries.admin) add("entries.admin", "清单未声明后台入口");
    if (contribution.coreId !== manifest.id || contribution.implementationVersion !== manifest.version)
      add("contribution", "后台贡献的Core标识/版本与清单不同");
    const permissions = new Set(manifest.permissions.map(permission => corePermissionCode(manifest.id, permission)));
    const paths = new Set<string>(), parents = new Map<string, string | undefined>();
    for (const [index, page] of contribution.pages.entries()) {
      const { component, ...metadata } = page;
      const parsed = CorePageDescriptorSchema.safeParse(metadata);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) add(`pages.${index}.${issue.path.join(".")}`, issue.message);
        continue;
      }
      if (component === undefined || component === null) add(`pages.${index}.component`, "页面缺少受控组件引用");
      const key = corePageKey(manifest.id, page.id), normalized = page.path.replace(/:[a-z][a-zA-Z0-9]*/g, ":parameter");
      if (pages.has(key)) add(`pages.${index}.id`, "页面标识重复");
      if (paths.has(normalized)) add(`pages.${index}.path`, "页面路径与已有页面同形");
      paths.add(normalized);
      for (const permission of page.permissions) if (!permissions.has(corePermissionCode(manifest.id, permission)))
        add(`pages.${index}.permissions`, "页面引用了清单未声明的业务权限");
      parents.set(page.id, page.parent);
      pages.set(key, { coreId: manifest.id, key, path: `/cores/${manifest.id}${page.path === "/" ? "" : page.path}`, definition: page });
    }
    for (const [id, parent] of parents) {
      if (parent && !parents.has(parent)) add(`pages.${id}.parent`, "上级页面必须在本Core登记");
      const chain = new Set([id]);
      let ancestor = parent;
      while (ancestor && parents.has(ancestor)) {
        if (chain.has(ancestor)) { add(`pages.${id}.parent`, "面包屑上级页面存在循环"); break; }
        chain.add(ancestor); ancestor = parents.get(ancestor);
      }
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, pages };
}

export interface CorePageLocation { coreId: string; pageId: string; params?: Readonly<Record<string, string>> }
/** 按已登记目标生成路径；只定位页面，访问权仍由路由与后端独立核对。 */
export function resolveCorePageLocation<TComponent>(pages: ReadonlyMap<string, CoreRegisteredPage<TComponent>>, location: CorePageLocation): string {
  const page = pages.get(corePageKey(location.coreId, location.pageId));
  if (!page) throw new Error("页面目标未登记");
  const required = [...page.path.matchAll(/:([a-z][a-zA-Z0-9]*)/g)].map(match => match[1]);
  const params = location.params ?? {};
  if (Object.keys(params).length !== required.length || required.some(key => !Object.hasOwn(params, key)))
    throw new Error("页面参数与登记路径不一致");
  return page.path.replace(/:([a-z][a-zA-Z0-9]*)/g, (_match, key: string) => {
    const value = params[key];
    if (typeof value !== "string" || !value || value === "." || value === ".." || /[\u0000-\u001f\u007f]/.test(value))
      throw new Error("页面参数不是有效对象标识");
    return encodeURIComponent(value);
  });
}

export interface CorePageActionBase {
  id: string;
  label: CorePageText;
  emphasis?: "primary" | "secondary";
  /** 附加于页面访问要求；宿主取当前权限判显示，服务端仍复核实际动作授权。 */
  permissions?: CorePageDescriptor["permissions"];
  /** 当前受权页面的展示条件，不是业务授权证据。 */
  disabled?: boolean;
  disabledReason?: CorePageText;
}
/** 页面自行提供字段类型；实际Form绑定由React适配器保存，不能序列化为可执行JSON。 */
export type CorePageAction<TForm, TValues> = CorePageActionBase & (
  | { kind: "navigate"; to: CorePageLocation }
  | { kind: "open"; open: () => void }
  | { kind: "command"; execute: () => Promise<unknown>; confirmation?: CorePageText }
  | { kind: "save"; form: TForm; onSave: (values: TValues) => Promise<unknown> }
);

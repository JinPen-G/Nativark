/** 公共字典/编号服务。原会话与当前角色授权后读取本租户生效配置，同事务写入和审计。
 * 父租户锁串行化规则保存及取号，提交前复验主体，失败整体回滚，冲突由调用方重读。 */
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { GeneratePlatformNumberRequest, PlatformDictionaryGroup, PlatformNumberRule, SavePlatformDictionaryGroupRequest,
  SavePlatformNumberRuleRequest, SystemUserRow } from "@rental-os/platform-contracts";
import { hasEffectivePermission } from "../../permission-match";
import { PLATFORM_AUTH_DATA_STORE } from "../platform/platform-auth-data-store";
import { PlatformIdentityRepository } from "../platform/platform-identity.repository";
import { PlatformPrincipalAuthority } from "../platform/platform-principal.authority";
import { PLATFORM_DICTIONARIES_MODULE, PLATFORM_NUMBER_RULES_MODULE, PlatformToolsRepository } from "./platform-tools.repository";
import type { PlatformToolsDatabase, PlatformToolsTransaction } from "./platform-tools.store";
import { advanceNumberRule, createDictionaryGroup, createNumberRule, formatPlatformNumber } from "./platform-tools.values";

@Injectable()
export class PlatformToolsService {
  private readonly repository = new PlatformToolsRepository();
  private readonly principals: PlatformPrincipalAuthority<PlatformToolsTransaction>;
  constructor(@Inject(PLATFORM_AUTH_DATA_STORE) private readonly database: PlatformToolsDatabase) {
    this.principals = new PlatformPrincipalAuthority(new PlatformIdentityRepository(database));
  }

  private run<T>(permission: string, work: (tx: PlatformToolsTransaction, user: SystemUserRow) => Promise<T>) {
    const actor = this.principals.current();
    const allowed = (user: SystemUserRow) => !user.isSaasAdmin && (user.isPlatformAdmin || hasEffectivePermission(user.permissions, permission));
    return this.database.$transaction(async tx => {
      const lease = await this.principals.lock(tx, actor, actor.tenantId);
      if (!allowed(lease.user)) throw new ForbiddenException("缺少当前租户工具权限");
      const result = await work(tx, lease.user);
      if (!allowed(await lease.revalidate())) throw new ForbiddenException("公共工具提交前当前权限已变化");
      return result;
    }, { isolationLevel: "Serializable" }).catch(error => {
      if (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code)))
        throw new ConflictException("公共工具配置在提交期间变化，请重新读取核对");
      throw error;
    });
  }

  private audit(tx: PlatformToolsTransaction, user: SystemUserRow, action: string, targetType: string,
    targetId: string, operator: string, detail: string) {
    return tx.operationLog.create({ data: { tenantId: user.tenantId, userId: user.id, action,
      detail: { operator, targetType, targetId, detail } } });
  }

  /** Rental 默认资料仅由原可信适配传入。公共宿主使用空缺省。 */
  listDictionaries(defaults: PlatformDictionaryGroup[] = []) {
    return this.run("system:dictionary:manage", async (tx, user) => {
      const { content } = await this.repository.read(tx, user.tenantId, PLATFORM_DICTIONARIES_MODULE);
      return this.repository.dictionaries(content, defaults);
    });
  }

  saveDictionaryGroup(input: SavePlatformDictionaryGroupRequest) {
    return this.run("system:dictionary:manage", async (tx, user) => {
      const group = createDictionaryGroup(input);
      const { row, content } = await this.repository.read(tx, user.tenantId, PLATFORM_DICTIONARIES_MODULE);
      const groups = this.repository.dictionaries(content).filter(item => item.code !== group.code);
      groups.unshift(group);
      await this.repository.save(tx, user.tenantId, PLATFORM_DICTIONARIES_MODULE, row, { ...content, groups: JSON.parse(JSON.stringify(groups)) });
      await this.audit(tx, user, "dictionary.update", "dictionary", group.code, group.updatedBy, `更新数据字典：${group.name}`);
      return group;
    });
  }

  listNumberRules(defaults: PlatformNumberRule[] = []) {
    return this.run("system:number-rule:manage", async (tx, user) => {
      const { content } = await this.repository.read(tx, user.tenantId, PLATFORM_NUMBER_RULES_MODULE);
      const now = new Date();
      return this.repository.numberRules(content, defaults).map(rule => ({ ...rule, sample: formatPlatformNumber(rule, rule.currentSequence + 1, now) }));
    });
  }

  saveNumberRule(input: SavePlatformNumberRuleRequest) {
    return this.run("system:number-rule:manage", async (tx, user) => {
      const { row, content } = await this.repository.read(tx, user.tenantId, PLATFORM_NUMBER_RULES_MODULE);
      const current = this.repository.numberRules(content), code = input.code.trim().toUpperCase();
      const rule = createNumberRule(input, current.find(item => item.code === code));
      const rules = current.filter(item => item.code !== code);
      rules.unshift(rule);
      await this.repository.save(tx, user.tenantId, PLATFORM_NUMBER_RULES_MODULE, row, { ...content, rules: JSON.parse(JSON.stringify(rules)) });
      await this.audit(tx, user, "number-rule.update", "number-rule", rule.code, rule.updatedBy, `更新编号规则：${rule.name}`);
      return rule;
    });
  }

  generateNumber(input: GeneratePlatformNumberRequest) {
    return this.run("system:number-rule:manage", async (tx, user) => {
      const { row, content } = await this.repository.read(tx, user.tenantId, PLATFORM_NUMBER_RULES_MODULE);
      const rules = this.repository.numberRules(content), index = rules.findIndex(rule => rule.code === input.code);
      if (index < 0) throw new NotFoundException("编号规则不存在");
      const { rule, result } = advanceNumberRule(rules[index], input.operator);
      rules[index] = rule;
      await this.repository.save(tx, user.tenantId, PLATFORM_NUMBER_RULES_MODULE, row, { ...content, rules: JSON.parse(JSON.stringify(rules)) });
      await this.audit(tx, user, "number.generate", "number-rule", rule.code, rule.updatedBy, `生成编号：${result.generatedNo}`);
      return result;
    });
  }
}

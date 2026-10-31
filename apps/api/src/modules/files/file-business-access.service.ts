import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { FileAssetSummary } from '@rental-os/shared';
import { getRequestIdentity, type RequestIdentity } from '../../common/request-identity';
import { PrismaService } from '../database/prisma.service';
import { CustomerOperationsService } from '../platform/customer-operations.service';
import { RentalCoreFactRepository } from '../rental-core/rental-core-fact.repository';
import { RentalBusinessFactRepository } from '../rental-core/rental-business-fact.repository';
import { assertQuoteReadAccess } from '../rental-core/rental-quote-access';

type FileBinding = Pick<FileAssetSummary, 'id' | 'businessType' | 'uploadScene'> & { businessId?: string | null; metadata?: unknown };
type FileActor = Partial<RequestIdentity>;

/** File metadata is a locator, not authority. Lists and signed reads follow the
 * original business object's current scope; unknown bindings and knowledge files
 * stay closed. Public access is limited to an actually published catalogue image. */
@Injectable()
export class FileBusinessAccessService {
  constructor(private readonly prisma: PrismaService,
    private readonly facts: RentalCoreFactRepository,
    private readonly businessFacts: RentalBusinessFactRepository,
    private readonly customers: CustomerOperationsService) {}

  private actor(tenantId: string): FileActor {
    const identity = getRequestIdentity();
    if (!identity || identity.tenantId !== tenantId || identity.isSaasAdmin || !identity.workspaceId) {
      throw new ForbiddenException('文件访问身份或经营空间未就绪');
    }
    return { ...identity, permissions: identity.permissions ? [...identity.permissions] : undefined,
      locationScope: identity.locationScope && { ...identity.locationScope, locationIds: [...identity.locationScope.locationIds] } };
  }

  authorityKey(tenantId: string): string {
    const actor = this.actor(tenantId);
    return JSON.stringify({ tenantId: actor.tenantId, workspaceId: actor.workspaceId, userId: actor.userId,
      audience: actor.audience, isSaasAdmin: actor.isSaasAdmin, isPlatformAdmin: actor.isPlatformAdmin,
      permissions: actor.permissions, dataScope: actor.dataScope, organizationId: actor.organizationId,
      locationScope: actor.locationScope, staffApi: actor.staffApi, staffLocationScope: actor.staffLocationScope });
  }

  private has(actor: FileActor, permissions: string[]) {
    return actor.isPlatformAdmin || actor.permissions?.includes('*') || permissions.some(code => actor.permissions?.includes(code));
  }

  private requireOperator(actor: FileActor, permissions: string[]) {
    if (!actor.userId || !['operator', 'staff'].includes(actor.audience ?? '') || !actor.dataScope || !actor.locationScope
      || (actor.dataScope === 'organization' && actor.locationScope.mode !== 'selected')
      || !this.has(actor, permissions)) throw new ForbiddenException('缺少原业务附件读取权限');
  }

  async filterReadable(tenantId: string, files: FileAssetSummary[]): Promise<FileAssetSummary[]> {
    const key = this.authorityKey(tenantId);
    this.requireOperator(this.actor(tenantId), ['system:integration:manage']);
    const visible: FileAssetSummary[] = [];
    const originals = await this.prisma.fileAsset.findMany({ where: { tenantId, id: { in: files.map(file => file.id) } } });
    const byId = new Map(originals.map(file => [file.id, file]));
    for (const file of files) {
      // Knowledge and credential metadata do not belong in the generic ledger,
      // even for operators who can read them through their dedicated business UI.
      if (['ai_knowledge_document', 'customer', 'customer_profile', 'membership_review'].includes(file.businessType)) continue;
      const original = byId.get(file.id);
      if (!original || original.businessType !== file.businessType || original.businessId !== (file.businessId ?? null)
        || original.uploadScene !== file.uploadScene || original.status !== file.status) continue;
      try {
        await this.assertRead(tenantId, original, true);
        const safe = { ...file };
        delete safe.storageKey;
        delete safe.publicUrl;
        visible.push(safe);
      } catch (error) {
        if (!(error instanceof ForbiddenException) && !(error instanceof NotFoundException)) throw error;
      }
    }
    if (this.authorityKey(tenantId) !== key) throw new ForbiddenException('文件读取期间授权范围已变化');
    return visible;
  }

  async assertRead(tenantId: string, file: FileBinding, genericLedger = false): Promise<void> {
    const key = this.authorityKey(tenantId), actor = this.actor(tenantId);
    const type = file.businessType, id = file.businessId;
    if (!id || !file.id || type === 'ai_knowledge_document') throw new ForbiddenException('文件缺少可读取的原业务绑定');
    if (['item_group', 'rental_item_group'].includes(type) && file.uploadScene === 'item-group-image'
      && (!actor.userId || actor.audience === 'client')) {
      await this.assertPublishedImage(tenantId, actor.workspaceId!, id, file.id);
    } else {
      if (actor.audience === 'client') {
        if (!actor.userId || !['customer', 'customer_profile'].includes(type) || id !== actor.userId
          || file.uploadScene !== 'client-qualification') throw new ForbiddenException('文件不属于当前客户可读范围');
        const customer = await this.prisma.customerProfile.findFirst({ where: { tenantId, id }, select: { id: true } });
        if (!customer) throw new NotFoundException('文件关联客户不存在');
      } else {
        if (!actor.userId || !['operator', 'staff'].includes(actor.audience ?? '') || !actor.dataScope) {
          throw new ForbiddenException('缺少原业务附件读取身份');
        }
        await this.assertOperatorBinding(tenantId, file, actor, new Set(), genericLedger);
      }
    }
    if (this.authorityKey(tenantId) !== key) throw new ForbiddenException('文件读取期间授权范围已变化');
  }

  private async assertPublishedImage(tenantId: string, workspaceId: string, itemGroupId: string, fileId: string) {
    const published = await this.prisma.businessWorkspace.findFirst({ where: { id: workspaceId, tenantId, status: 'ACTIVE',
      tenant: { status: 'ACTIVE' }, clientChannelPublications: { some: { tenantId, enabled: true } } }, select: { id: true } });
    const group = published && await this.prisma.rentalItemGroup.findFirst({ where: { id: itemGroupId, tenantId, workspaceId, status: 'enabled' },
      select: { attributes: true } });
    const attributes = group?.attributes;
    const media = attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes.__itemGroupMedia : null;
    const images = media && typeof media === 'object' && !Array.isArray(media) ? media.images : null;
    if (!Array.isArray(images) || !images.some(image => image && typeof image === 'object' && !Array.isArray(image)
      && image.fileAssetId === fileId)) throw new NotFoundException('文件不是当前已发布商品图片');
  }

  private async assertOperatorBinding(tenantId: string, file: FileBinding, actor: FileActor, seen: Set<string>, genericLedger: boolean): Promise<void> {
    const id = file.businessId!, type = file.businessType, binding = `${type}:${id}`;
    if (genericLedger && ['customer', 'customer_profile', 'membership_review', 'ai_knowledge_document'].includes(type)) {
      throw new ForbiddenException('客户资格或知识附件不进入通用台账');
    }
    if (seen.size >= 4 || seen.has(binding)) throw new ForbiddenException('文件原业务引用不能解析');
    seen.add(binding);
    switch (type) {
      case 'order': case 'rental_order': case 'order_contract': {
        if (!['order-contract', 'contract_mock', 'pickup-evidence', 'return-evidence', 'handover-signature',
          'offline-payment-proof', 'carrier-shipment-evidence', 'print_mock'].includes(file.uploadScene)) {
          throw new ForbiddenException('订单附件场景没有受控读取规则');
        }
        const stage = file.uploadScene === 'pickup-evidence' ? 'pickup' : file.uploadScene === 'return-evidence' ? 'return' : undefined;
        const scenePermissions = stage === 'pickup' ? ['rental-os:order:pickup'] : stage === 'return' ? ['rental-os:order:return']
          : file.uploadScene === 'handover-signature' ? ['rental-os:order:pickup', 'rental-os:order:return'] : [];
        this.requireOperator(actor, ['rental-os:order:view', ...scenePermissions,
          ...(file.uploadScene === 'offline-payment-proof' ? ['rental-os:order:offline-payment'] : [])]);
        const metadata = file.metadata && typeof file.metadata === 'object' && !Array.isArray(file.metadata)
          ? file.metadata as Record<string, unknown> : {};
        const documentType = typeof metadata.documentType === 'string' ? metadata.documentType : '';
        if (file.uploadScene === 'print_mock' && !['pickup_sheet', 'return_sheet', 'rental_contract', 'invoice',
          'quote', 'delivery', 'return', 'settlement'].includes(documentType)) throw new ForbiddenException('文件缺少受控原单据类型');
        if (file.uploadScene === 'offline-payment-proof' || ['invoice', 'settlement'].includes(documentType)) {
          this.requireOperator(actor, ['rental-os:finance:view', 'rental-os:finance:reconcile',
            ...(actor.audience === 'staff' && file.uploadScene === 'offline-payment-proof' ? ['rental-os:order:offline-payment'] : [])]);
        }
        let evidenceStage: 'pickup' | 'return' | undefined = stage;
        if (file.uploadScene === 'handover-signature') {
          const metadata = file.metadata;
          const boundStage = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>).handoverStage : undefined;
          if (boundStage !== 'pickup' && boundStage !== 'return') throw new ForbiddenException('交接凭证缺少原阶段绑定');
          evidenceStage = boundStage;
        }
        await this.facts.assertFileOrderReadAccess(tenantId, id, evidenceStage);
        return;
      }
      case 'quote': case 'rental_quote': {
        this.requireOperator(actor, ['rental-os:order:view']);
        const quote = await this.businessFacts.findQuote(tenantId, id);
        if (!quote) throw new NotFoundException('文件关联报价不在当前经营空间');
        assertQuoteReadAccess(quote);
        return;
      }
      case 'asset': case 'rental_asset':
        this.requireOperator(actor, ['rental-core:asset:view', 'rental-core:asset:manage']);
        await this.facts.assertFileAssetReadAccess(tenantId, id);
        return;
      case 'work_order': case 'rental_work_order':
        this.requireOperator(actor, ['rental-core:maintenance:view',
          ...(file.uploadScene === 'work-order-evidence' ? ['rental-core:maintenance:manage'] : [])]);
        await this.facts.assertFileWorkOrderReadAccess(tenantId, id);
        return;
      case 'item_group': case 'rental_item_group': {
        this.requireOperator(actor, ['rental-core:catalog:view', 'rental-core:catalog:manage', 'rental-os:order:view', 'rental-os:order:create']);
        const group = await this.prisma.rentalItemGroup.findFirst({ where: { tenantId, workspaceId: actor.workspaceId, id }, select: { id: true } });
        if (!group) throw new NotFoundException('文件关联型号不在当前经营空间');
        return;
      }
      case 'customer': case 'customer_profile':
        await this.customers.assertCustomerFileReadAccess(tenantId, id);
        return;
      case 'membership_review': {
        const review = await this.prisma.customerMembershipReview.findFirst({ where: { tenantId, id }, select: { customerId: true } });
        if (!review) throw new NotFoundException('文件关联审核不存在');
        await this.customers.assertCustomerFileReadAccess(tenantId, review.customerId);
        return;
      }
      case 'customer_contract': case 'corporate_contract': case 'customer_invoice_profile': case 'invoice_profile': case 'customer_credit': case 'credit': {
        const where = { tenantId, id }, select = { customerId: true };
        const row = ['customer_contract', 'corporate_contract'].includes(type)
          ? await this.prisma.customerCorporateContract.findFirst({ where, select })
          : ['customer_invoice_profile', 'invoice_profile'].includes(type)
            ? await this.prisma.customerCorporateInvoiceProfile.findFirst({ where, select })
            : await this.prisma.customerCorporateCredit.findFirst({ where, select });
        if (!row) throw new NotFoundException('文件关联企业资料不存在');
        await this.customers.assertCustomerFileReadAccess(tenantId, row.customerId, true);
        return;
      }
      case 'async_job': case 'document_print_job': {
        this.requireOperator(actor, ['system:integration:manage']);
        const row = type === 'async_job'
          ? await this.prisma.asyncJob.findFirst({ where: { tenantId, id }, select: { businessType: true, businessId: true } })
          : await this.prisma.documentPrintJob.findFirst({ where: { tenantId, id }, select: { businessType: true, businessId: true } });
        if (!row?.businessType || !row.businessId) throw new NotFoundException('文件任务没有可读取的原业务对象');
        await this.assertOperatorBinding(tenantId, { ...file, businessType: row.businessType, businessId: row.businessId }, actor, seen, genericLedger);
        return;
      }
      default: throw new ForbiddenException('文件业务类型没有受控读取规则');
    }
  }
}

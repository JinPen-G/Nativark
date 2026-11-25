/** Server-private observations for fixed original navigation targets. These
 * shapes grant no Action, Task, route, execution or permission; the public
 * application binds and signs the original resource observation separately. */
import { z } from 'zod';
import { RentalCoreOrderStatus, type AiExecutionContext } from '@rental-os/shared';

export const ENTRY_ACTION_RESOURCE_CODES = ['OPEN_ORDER', 'OPEN_CUSTOMER', 'OPEN_PRODUCT', 'OPEN_DISPATCH'] as const;
export const entryActionTargetIdSchema = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const entryActionOrderTargetIdSchema = entryActionTargetIdSchema.refine(value =>
  !['expire-pending', 'reconcile-pickup-overdue'].includes(value.toLowerCase()));
export const entryActionResourceReadSchema = z.object({
  actionCode: z.enum(ENTRY_ACTION_RESOURCE_CODES), targetId: entryActionTargetIdSchema
}).strict().superRefine((value, context) => {
  if ((value.actionCode === 'OPEN_ORDER' || value.actionCode === 'OPEN_DISPATCH')
    && !entryActionOrderTargetIdSchema.safeParse(value.targetId).success
    || value.actionCode === 'OPEN_CUSTOMER' && ['search', 'merge'].includes(value.targetId.toLowerCase())) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Original target route required' });
  }
});
export type EntryActionResourceRead = z.infer<typeof entryActionResourceReadSchema>;
export type EntryActionResourceContext = Extract<AiExecutionContext, { actor: { kind: 'user' } }>;
export interface EntryActionResourceObservation {
  context: EntryActionResourceContext;
  resource: {
    kind: 'order' | 'customer' | 'item_group' | 'order_allocation'; id: string; resourceVersion: string;
    /** Present only for customers, from the validated original profile. */
    customerType?: 'personal' | 'corporate';
  };
  label: string;
  observedAt: string;
}
export interface EntryActionOrderTargets {
  context: EntryActionResourceContext;
  order: { id: string; version: string; resourceVersion: string; assignmentRevision: number | null };
  customer: { id: string; type: 'personal' | 'corporate' } | null;
  productIds: string[];
  observedAt: string;
}

// Original domain responses have other legitimate fields. Strip them here;
// navigation never projects contacts, prices, leases or the full assignment.
export const entryActionOrderFactsSchema = z.object({
  id: entryActionOrderTargetIdSchema, tenantId: entryActionTargetIdSchema, workspaceId: entryActionTargetIdSchema,
  orderNo: z.string().min(1).max(191), status: z.nativeEnum(RentalCoreOrderStatus),
  updatedAt: z.string().max(40).datetime({ offset: true })
});
export const entryActionCustomerFactsSchema = z.object({
  id: entryActionTargetIdSchema, tenantId: entryActionTargetIdSchema, name: z.string().min(1).max(191),
  customerType: z.enum(['personal', 'corporate']), ordinaryRevision: z.number().int().min(1).max(4294967295)
}).strict();
export const entryActionOrderAssociationSchema = z.object({
  id: entryActionOrderTargetIdSchema, tenantId: entryActionTargetIdSchema, workspaceId: entryActionTargetIdSchema,
  customerId: entryActionTargetIdSchema.nullable(), customerType: z.enum(['personal', 'corporate']), updatedAt: z.date()
}).strict();
export const entryActionAssignmentRowSchema = z.object({
  id: entryActionOrderTargetIdSchema, tenantId: entryActionTargetIdSchema, workspaceId: entryActionTargetIdSchema,
  updatedAt: z.date(), assignmentType: z.string().nullable(), revisionType: z.string().nullable(),
  assignmentRevision: z.unknown()
}).strict();
export const entryActionProductAssociationSchema = z.object({
  itemGroupId: entryActionTargetIdSchema, itemTenantId: entryActionTargetIdSchema, itemWorkspaceId: entryActionTargetIdSchema
}).strict();

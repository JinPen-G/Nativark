import { Module, type DynamicModule } from '@nestjs/common';
import type { FormalApprovedOrderReprepareConfiguration } from '../approval-execution/formal-approved-order-reprepare.composition';
import type { QuoteRequestReissueConfiguration } from '../scenes/quote-reissue.composition';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from './prisma-quote-selection.repository';
import { composeHumanQuoteOrder, type HumanQuoteOrderDependencies, type SelectedQuoteTaskConfiguration } from '../scenes/human-quote-order.composition';
import { AI_HUMAN_QUOTE_SELECTIONS, AI_HUMAN_QUOTE_SELECTION_REQUESTS, AiHumanQuoteSelectionController,
  AI_HUMAN_QUOTE_ORDER_REQUESTS, AiHumanQuoteOrderController, AI_SELECTED_QUOTE_TASK_REQUESTS, AiSelectedQuoteTaskController } from './human-quote-selection.controller';
import { composeRequestBoundQuoteSelections, composeRequestBoundHumanQuoteOrder, composeRequestBoundSelectedQuoteTask, type RequestBoundQuoteSelectionDependencies,
  type RequestBoundQuoteOrderDependencies, type AiSceneRequestOptions } from '../scenes/request-bound-scenes.application';

export { AI_HUMAN_QUOTE_SELECTIONS } from './human-quote-selection.controller';
export const AI_HUMAN_QUOTE_ORDER = Symbol('AI_HUMAN_QUOTE_ORDER');
export { AI_HUMAN_QUOTE_ORDER_REQUESTS } from './human-quote-selection.controller';
@Module({})
export class AiHumanQuoteSelectionModule {
  static registerHttpTask(dependencies: RequestBoundQuoteOrderDependencies, options: AiSceneRequestOptions,
    task: SelectedQuoteTaskConfiguration, reprepare?: FormalApprovedOrderReprepareConfiguration, reissue?: QuoteRequestReissueConfiguration): DynamicModule {
    const human = this.registerHttpApplication(dependencies, options, reprepare, reissue);
    const serverOptions = { ...options }, serverTask = { ...task, host: structuredClone(task.host), limits: structuredClone(task.limits) };
    return { ...human,
      providers: [...(human.providers ?? []), { provide: AI_SELECTED_QUOTE_TASK_REQUESTS,
        useFactory: () => composeRequestBoundSelectedQuoteTask(dependencies, serverOptions, serverTask) }],
      exports: [...(human.exports ?? []), AI_SELECTED_QUOTE_TASK_REQUESTS],
      controllers: [...(human.controllers ?? []), AiSelectedQuoteTaskController] };
  }
  static registerHttpApplication(dependencies: RequestBoundQuoteOrderDependencies, options: AiSceneRequestOptions,
    reprepare?: FormalApprovedOrderReprepareConfiguration, reissue?: QuoteRequestReissueConfiguration): DynamicModule {
    const serverOptions = { ...options };
    const configuration = reprepare ? { holderId: reprepare.holderId,
      creationRules: structuredClone(reprepare.creationRules), memberships: reprepare.memberships } : undefined;
    return { module: AiHumanQuoteSelectionModule, providers: [
      { provide: AI_HUMAN_QUOTE_SELECTION_REQUESTS, useFactory: () => composeRequestBoundQuoteSelections(dependencies, serverOptions) },
      { provide: AI_HUMAN_QUOTE_ORDER_REQUESTS, useFactory: () => composeRequestBoundHumanQuoteOrder(dependencies, serverOptions, configuration, reissue) }
    ], exports: [AI_HUMAN_QUOTE_SELECTION_REQUESTS, AI_HUMAN_QUOTE_ORDER_REQUESTS],
      controllers: [AiHumanQuoteSelectionController, AiHumanQuoteOrderController] };
  }
  static registerApplication(dependencies: HumanQuoteOrderDependencies): DynamicModule {
    return { module: AiHumanQuoteSelectionModule,
      providers: [{ provide: AI_HUMAN_QUOTE_ORDER, useFactory: () => composeHumanQuoteOrder(dependencies) }],
      exports: [AI_HUMAN_QUOTE_ORDER] };
  }
  static register(dependencies: HumanQuoteSelectionDependencies): DynamicModule {
    return { module: AiHumanQuoteSelectionModule,
      providers: [{ provide: AI_HUMAN_QUOTE_SELECTIONS, useFactory: () => new PrismaQuoteSelectionRepository(dependencies) }],
      exports: [AI_HUMAN_QUOTE_SELECTIONS] };
  }
  static registerHttp(dependencies: RequestBoundQuoteSelectionDependencies, options: AiSceneRequestOptions): DynamicModule {
    return { module: AiHumanQuoteSelectionModule,
      providers: [{ provide: AI_HUMAN_QUOTE_SELECTION_REQUESTS, useFactory: () => composeRequestBoundQuoteSelections(dependencies, options) }],
      exports: [AI_HUMAN_QUOTE_SELECTION_REQUESTS], controllers: [AiHumanQuoteSelectionController] };
  }
  static registerRequestBoundApplication(dependencies: RequestBoundQuoteOrderDependencies, options: AiSceneRequestOptions,
    reprepare?: FormalApprovedOrderReprepareConfiguration, reissue?: QuoteRequestReissueConfiguration): DynamicModule {
    return { module: AiHumanQuoteSelectionModule,
      providers: [{ provide: AI_HUMAN_QUOTE_ORDER_REQUESTS, useFactory: () => composeRequestBoundHumanQuoteOrder(dependencies, options, reprepare, reissue) }],
      exports: [AI_HUMAN_QUOTE_ORDER_REQUESTS] };
  }
}

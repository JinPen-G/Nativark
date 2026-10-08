import { Module, type DynamicModule } from '@nestjs/common';
import type { FormalApprovedOrderReprepareConfiguration } from '../approval-execution/formal-approved-order-reprepare.composition';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from './prisma-quote-selection.repository';
import { composeHumanQuoteOrder, type HumanQuoteOrderDependencies } from '../scenes/human-quote-order.composition';
import { AI_HUMAN_QUOTE_SELECTIONS, AI_HUMAN_QUOTE_SELECTION_REQUESTS, AiHumanQuoteSelectionController } from './human-quote-selection.controller';
import { composeRequestBoundQuoteSelections, composeRequestBoundHumanQuoteOrder, type RequestBoundQuoteSelectionDependencies,
  type RequestBoundQuoteOrderDependencies, type AiSceneRequestOptions } from '../scenes/request-bound-scenes.application';

export { AI_HUMAN_QUOTE_SELECTIONS } from './human-quote-selection.controller';
export const AI_HUMAN_QUOTE_ORDER = Symbol('AI_HUMAN_QUOTE_ORDER');
export const AI_HUMAN_QUOTE_ORDER_REQUESTS = Symbol('AI_HUMAN_QUOTE_ORDER_REQUESTS');
@Module({})
export class AiHumanQuoteSelectionModule {
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
    reprepare?: FormalApprovedOrderReprepareConfiguration): DynamicModule {
    return { module: AiHumanQuoteSelectionModule,
      providers: [{ provide: AI_HUMAN_QUOTE_ORDER_REQUESTS, useFactory: () => composeRequestBoundHumanQuoteOrder(dependencies, options, reprepare) }],
      exports: [AI_HUMAN_QUOTE_ORDER_REQUESTS] };
  }
}

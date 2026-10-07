import { Module, type DynamicModule } from '@nestjs/common';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from './prisma-quote-selection.repository';
import { composeHumanQuoteOrder, type HumanQuoteOrderDependencies } from '../scenes/human-quote-order.composition';
import { AI_HUMAN_QUOTE_SELECTIONS, AiHumanQuoteSelectionController } from './human-quote-selection.controller';

export { AI_HUMAN_QUOTE_SELECTIONS } from './human-quote-selection.controller';
export const AI_HUMAN_QUOTE_ORDER = Symbol('AI_HUMAN_QUOTE_ORDER');
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
  static registerHttp(dependencies: HumanQuoteSelectionDependencies): DynamicModule {
    return { ...this.register(dependencies), controllers: [AiHumanQuoteSelectionController] };
  }
}

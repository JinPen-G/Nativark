import { Module, type DynamicModule } from '@nestjs/common';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from './prisma-quote-selection.repository';

export const AI_HUMAN_QUOTE_SELECTIONS = Symbol('AI_HUMAN_QUOTE_SELECTIONS');
@Module({})
export class AiHumanQuoteSelectionModule {
  static register(dependencies: HumanQuoteSelectionDependencies): DynamicModule {
    return { module: AiHumanQuoteSelectionModule,
      providers: [{ provide: AI_HUMAN_QUOTE_SELECTIONS, useFactory: () => new PrismaQuoteSelectionRepository(dependencies) }],
      exports: [AI_HUMAN_QUOTE_SELECTIONS] };
  }
}

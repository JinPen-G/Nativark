/** 显式恢复原 Agent 工作台、导航与 Copilot 面板，页面结构和交互由原组件单源提供。 */
import type { ComponentProps, ComponentType } from "react";
import { createRentalAssistantContext, RentalAssistantHost, type RentalAssistantOptions } from "./host";
import { AiOperatorPage } from "./ai-operator/AiOperatorPage";
import { AiOperatorNavigation, OperatorModeSwitch } from "./ai-operator/AiOperatorNavigation";
import { OperatorProvider } from "./ai-operator/OperatorContext";
import { CopilotProvider } from "./copilot/CopilotProvider";
import { CopilotLayout } from "./copilot/CopilotLayout";
import { CopilotSection } from "./copilot/CopilotSection";
import { CalendarSourceEntry } from "./ai-native/CalendarSourceEntry";
import { RuleSourceEntry } from "./ai-native/RuleSourceEntry";
import { CategoryAssistFlow } from "./ai-native/CategoryAssistFlow";
import { NotificationDraftFlow } from "./ai-native/NotificationDraftFlow";

export function createRentalAssistant(options: RentalAssistantOptions) {
  const context = createRentalAssistantContext(options);
  function bind<Props extends object>(Component: ComponentType<Props>) {
    return function RentalAssistantComponent(props: Props) {
      return <RentalAssistantHost value={context}><Component {...props} /></RentalAssistantHost>;
    };
  }
  return {
    Provider: (props: Omit<ComponentProps<typeof RentalAssistantHost>, "value">) => <RentalAssistantHost value={context} {...props} />,
    AiOperatorPage: bind(AiOperatorPage), AiOperatorNavigation: bind(AiOperatorNavigation), OperatorModeSwitch,
    OperatorProvider: bind(OperatorProvider), CopilotProvider: bind(CopilotProvider), CopilotLayout: bind(CopilotLayout), CopilotSection,
    CalendarSourceEntry: bind(CalendarSourceEntry), RuleSourceEntry: bind(RuleSourceEntry), NotificationDraftFlow: bind(NotificationDraftFlow),
    CategoryAssistFlow: bind(CategoryAssistFlow),
  };
}

export { useOperator } from "./ai-operator/OperatorContext";
export { useCopilot } from "./copilot/CopilotProvider";
export type { RentalAssistantOptions, RentalAssistantNavigation, RentalAssistantRoute } from "./host";

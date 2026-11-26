/** Original full host contributions around the shared model settings view. */
import { PlatformModelSettingsView } from './PlatformModelSettingsView';
import { PlatformBudgetSettings } from './PlatformBudgetSettings';
import { PlatformAiCreditSettings } from './AiCreditSettings';
import { PlatformPriceReview } from './PlatformPriceReview';

export { PlatformModelDirectory } from './PlatformModelSettingsView';
export function PlatformModelSettingsPage() {
  return <PlatformModelSettingsView views={{
    budget: identity => <PlatformBudgetSettings identity={identity} />,
    credits: identity => <PlatformAiCreditSettings identity={identity} />,
    prices: input => <PlatformPriceReview {...input} />,
  }} />;
}

/** Adds existing financial request ports to the same verified model settings session. */
import { useMemo } from 'react';
import { useAiAdminHost } from '../host';
import { usePlatformModelRuntime } from './model-runtime';
import { createAiBudgetSettingsApi } from './aiBudgetSettings';
import { createAiCreditApi } from './aiCredit';

export function usePlatformModelSettingsRuntime() {
  const host = useAiAdminHost();
  const session = usePlatformModelRuntime();
  const finance = useMemo(() => ({ aiBudgetSettingsApi: createAiBudgetSettingsApi(host),
    aiCreditApi: createAiCreditApi(host) }), [host]);
  return { ...session, ...finance };
}

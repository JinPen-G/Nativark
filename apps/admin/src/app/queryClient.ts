import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000
    },
    mutations: { retry: false }
  }
});

/**
 * Tenant data must never survive an authenticated session boundary.
 * Cancelling first prevents a request started by the previous tenant from
 * repopulating the cache after the next tenant has signed in.
 */
export function clearSessionQueryCache() {
  void queryClient.cancelQueries();
  queryClient.clear();
}

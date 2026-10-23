/** Dedicated business-view IPC. No provider keys, bearer tokens or arbitrary URLs are accepted. */
export const RENTAL_IPC = {
  connect: 'rental:connect', report: 'rental:report', complete: 'rental:complete', command: 'rental:command', read: 'rental:read',
  changed: 'rental:changed', request: 'rental:request', present: 'rental:present', retry: 'rental:retry',
} as const

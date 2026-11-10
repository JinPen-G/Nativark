/** Navigation intent only. These fields never authorize stock, prices or orders. */
export function rentalQuery(params: URLSearchParams, selection: { start: string; end: string; quantity?: number; fulfillment?: string }) {
  const query = new URLSearchParams();
  for (const key of ['pickup', 'return', 'city']) if (params.get(key)) query.set(key, params.get(key)!);
  if (selection.start) query.set('start', selection.start);
  if (selection.end) query.set('end', selection.end);
  if (selection.quantity) query.set('qty', String(selection.quantity));
  if (selection.fulfillment) query.set('fulfillment', selection.fulfillment);
  return query;
}

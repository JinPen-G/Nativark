/** Retain chart choices across report refreshes without hiding every remaining category. */
export function retainedHiddenSegments(segments: readonly { id: string; value: number }[], hidden: readonly string[]): readonly string[] {
  const available = new Set(segments.filter(segment => segment.value > 0).map(segment => segment.id));
  const retained = [...new Set(hidden)].filter(id => available.has(id));
  // A filter can remove the only visible category; show the new result instead of an empty diagram.
  return retained.length === available.size ? [] : retained;
}

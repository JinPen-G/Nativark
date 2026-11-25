import type { ReactNode } from "react";
export interface SpotlightGridCard {
  id: string;
  title: string;
  blurb: string;
  wide?: boolean;
}
export interface SpotlightGridProps<Card extends SpotlightGridCard> {
  cards: readonly Card[];
  renderMini: (card: Card, active: boolean) => ReactNode;
  renderDetail: (card: Card) => ReactNode;
  label: string;
  closeLabel: string;
}
export function SpotlightGrid<Card extends SpotlightGridCard>(props: SpotlightGridProps<Card>): ReactNode;

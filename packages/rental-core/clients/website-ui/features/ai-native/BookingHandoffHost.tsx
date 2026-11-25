import { createContext, useContext } from 'react';
import type { BookingHandoffHost } from './booking-handoff';

// No global instance, URL switch, storage or default transport. A future trusted
// request host may explicitly provide this only after server capability delivery.
const Context = createContext<BookingHandoffHost | null>(null);
// A local continuation intent can pause the ordinary form, never enable a host.
const PendingContext = createContext(false);
export const BookingHandoffHostProvider = Context.Provider;
export const BookingHandoffPendingProvider = PendingContext.Provider;
export const useBookingHandoffHost = () => useContext(Context);
export const useBookingHandoffPending = () => useContext(PendingContext);

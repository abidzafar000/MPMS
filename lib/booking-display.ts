import type { Reservation } from "./pms-types";

/** Read-only summary of the agreed room charge; excludes extras and payments. */
export function getBookingRateSummary(booking: Pick<Reservation, "arrival" | "departure" | "roomTotalPaisa" | "nightlyPricesPaisa">) {
  const count = (Date.parse(booking.departure) - Date.parse(booking.arrival)) / 86_400_000;
  const nights = Number.isInteger(count) && count > 0 ? count : 0;
  const prices = Object.entries(booking.nightlyPricesPaisa)
    .filter(([date]) => date >= booking.arrival && date < booking.departure)
    .map(([, price]) => price);
  const completeSnapshot = prices.length === nights && prices.reduce((sum, price) => sum + price, 0) === booking.roomTotalPaisa;
  return {
    nights,
    nightlyPaisa: nights ? Math.round(booking.roomTotalPaisa / nights) : 0,
    isAverage: nights > 1 && (!completeSnapshot || new Set(prices).size > 1),
  };
}

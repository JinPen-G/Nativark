export interface CalendarDateCell {
  date: string;
  day: number;
  weekday: number;
}

export function calendarYearMonths(year: number) {
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const start = new Date(Date.UTC(year, monthIndex, 1));
    const offset = (start.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const cells = Array.from({ length: 42 }, (_, cellIndex): CalendarDateCell | null => {
      const day = cellIndex - offset + 1;
      if (day < 1 || day > count) return null;
      return { date: `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, day, weekday: cellIndex % 7 };
    });
    return { month: monthIndex + 1, cells };
  });
}

export function moveCalendarDate(date: string, key: string, year: number): string | undefined {
  const [dateYear, month, day] = date.split("-").map(Number);
  const current = new Date(Date.UTC(dateYear, month - 1, day));
  const offset = (current.getUTCDay() + 6) % 7;
  const dayChange = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -offset, End: 6 - offset }[key];
  if (dayChange !== undefined) current.setUTCDate(day + dayChange);
  else if (key === "PageUp" || key === "PageDown") {
    const targetMonth = month - 1 + (key === "PageUp" ? -1 : 1);
    const lastDay = new Date(Date.UTC(dateYear, targetMonth + 1, 0)).getUTCDate();
    current.setUTCFullYear(dateYear, targetMonth, Math.min(day, lastDay));
  } else return undefined;
  if (current.getUTCFullYear() !== year) return undefined;
  return current.toISOString().slice(0, 10);
}

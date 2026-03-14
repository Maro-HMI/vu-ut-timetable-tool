export interface Week {
  weekNumber: number;
  startDate: Date; // Monday
  endDate: Date;   // Friday
  days: Date[];    // Mon–Fri
}

/**
 * Derive an array of weeks from a module's first Monday + number of weeks.
 */
export function deriveWeeks(startDateStr: string, numWeeks: number): Week[] {
  const start = new Date(startDateStr + 'T00:00:00');

  // Snap to Monday (in case startDate isn't exactly a Monday)
  const monday = new Date(start);
  const dow = monday.getDay(); // 0=Sun, 1=Mon ...
  if (dow !== 1) {
    const diff = dow === 0 ? -6 : 1 - dow;
    monday.setDate(monday.getDate() + diff);
  }

  const weeks: Week[] = [];
  const current = new Date(monday);

  for (let w = 1; w <= numWeeks; w++) {
    const weekStart = new Date(current);
    const days: Date[] = [];
    for (let d = 0; d < 5; d++) {
      const day = new Date(current);
      day.setDate(day.getDate() + d);
      days.push(day);
    }
    const weekEnd = new Date(current);
    weekEnd.setDate(weekEnd.getDate() + 4);

    weeks.push({ weekNumber: w, startDate: weekStart, endDate: weekEnd, days });
    current.setDate(current.getDate() + 7);
  }

  return weeks;
}

/** Format a date as "Mon 5" */
export function formatShortDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[date.getDay()]} ${date.getDate()}`;
}

/** Format a date as "Jan 5" */
export function formatMonthDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/** Format minutes since midnight as HH:MM */
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export const TRAVEL_ID = '__travel__';
export const TRAVEL_COLOR = '#94a3b8';
export const TRAVEL_NAME = 'Travel';

export type Location = 'VU' | 'UT';

export interface Module {
  id: string;
  name: string;
  startDate: string; // ISO date (YYYY-MM-DD), should be a Monday
  numWeeks: number;
}

export interface Course {
  id: string;
  name: string;
  color: string; // hex
}

export interface TimeBlock {
  id: string;
  courseId: string; // course id or TRAVEL_ID
  location: Location;
  weekNumber: number; // 1-based
  dayOfWeek: number;  // 0=Mon, 4=Fri
  startMinute: number; // minutes from midnight
  endMinute: number;
  notes?: string;
  place?: string;     // free-text room/building label shown on the block
  syncGroupId?: string;
  atTwente?: boolean; // VU blocks only: student is attending at UT campus
}

export interface AppData {
  module: Module | null;
  courses: Course[];
  timeBlocks: TimeBlock[];
  dayNotes?: Record<string, string>; // key: "${location}-w${weekNumber}-d${dayOfWeek}"
}

import { useState, useCallback } from 'react';
import type { AppData, LocationData, CourseExportData } from './types';

const STORAGE_KEY = 'vu-ut-timetable-v1';

const defaultData: AppData = {
  module: null,
  courses: [],
  timeBlocks: [],
  dayNotes: {},
  cabinBookings: [],
  unschedulableDays: {},
};

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData;
    const parsed = JSON.parse(raw) as Partial<AppData>;
    return {
      module: parsed.module ?? null,
      courses: parsed.courses ?? [],
      timeBlocks: parsed.timeBlocks ?? [],
      dayNotes: parsed.dayNotes ?? {},
      cabinBookings: parsed.cabinBookings ?? [],
      unschedulableDays: parsed.unschedulableDays ?? {},
    };
  } catch {
    return defaultData;
  }
}

function persist(data: AppData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('localStorage save failed', e);
  }
}

function triggerDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeName(name: string) {
  return name.replace(/[^a-z0-9_-]/gi, '_');
}

interface HistoryState {
  present: AppData;
  undo: AppData | null;
  redo: AppData | null;
}

export function useAppData() {
  const [hist, setHist] = useState<HistoryState>(() => ({
    present: load(),
    undo: null,
    redo: null,
  }));

  const data = hist.present;

  const update = useCallback((updater: (prev: AppData) => AppData) => {
    setHist(prev => {
      const next = updater(prev.present);
      persist(next);
      return { present: next, undo: prev.present, redo: null };
    });
  }, []);

  const undo = useCallback(() => {
    setHist(prev => {
      if (!prev.undo) return prev;
      persist(prev.undo);
      return { present: prev.undo, undo: null, redo: prev.present };
    });
  }, []);

  const redo = useCallback(() => {
    setHist(prev => {
      if (!prev.redo) return prev;
      persist(prev.redo);
      return { present: prev.redo, undo: prev.present, redo: null };
    });
  }, []);

  // ── Full data export/import ────────────────────────────

  const exportToFile = useCallback((d: AppData) => {
    const name = sanitizeName(d.module?.name ?? 'timetable');
    triggerDownload(`${name}.json`, JSON.stringify(d, null, 2));
  }, []);

  const importFromFile = useCallback((file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const parsed = JSON.parse(e.target?.result as string) as Partial<AppData>;
          const normalized: AppData = {
            module: parsed.module ?? null,
            courses: parsed.courses ?? [],
            timeBlocks: parsed.timeBlocks ?? [],
            dayNotes: parsed.dayNotes ?? {},
            cabinBookings: parsed.cabinBookings ?? [],
            unschedulableDays: parsed.unschedulableDays ?? {},
          };
          setHist({ present: normalized, undo: null, redo: null });
          persist(normalized);
          resolve();
        } catch {
          reject(new Error('Invalid file format'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }, []);

  const reset = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setHist({ present: defaultData, undo: null, redo: null });
  }, []);

  // ── Location-specific export/import ───────────────────

  const exportLocationToFile = useCallback((d: AppData, location: 'VU' | 'UT') => {
    const prefix = `${location}-`;
    const blocks = d.timeBlocks.filter(b => b.location === location);
    const courseIds = new Set(blocks.map(b => b.courseId));
    const locationData: LocationData = {
      location,
      courses: d.courses.filter(c => courseIds.has(c.id)),
      timeBlocks: blocks,
      dayNotes: Object.fromEntries(
        Object.entries(d.dayNotes ?? {}).filter(([k]) => k.startsWith(prefix))
      ),
      cabinBookings: location === 'VU' ? (d.cabinBookings ?? []) : [],
      unschedulableDays: Object.fromEntries(
        Object.entries(d.unschedulableDays ?? {}).filter(([k]) => k.startsWith(prefix))
      ),
    };
    const moduleName = sanitizeName(d.module?.name ?? 'timetable');
    triggerDownload(`${moduleName}_${location}.json`, JSON.stringify(locationData, null, 2));
  }, []);

  const importLocationFromFile = useCallback((file: File): Promise<LocationData> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const parsed = JSON.parse(e.target?.result as string) as Partial<LocationData>;
          if (!parsed.location || (parsed.location !== 'VU' && parsed.location !== 'UT')) {
            reject(new Error('File does not appear to be a location export (missing or invalid "location" field)'));
            return;
          }
          const normalized: LocationData = {
            location: parsed.location,
            courses: parsed.courses ?? [],
            timeBlocks: parsed.timeBlocks ?? [],
            dayNotes: parsed.dayNotes ?? {},
            cabinBookings: parsed.cabinBookings ?? [],
            unschedulableDays: parsed.unschedulableDays ?? {},
          };
          resolve(normalized);
        } catch {
          reject(new Error('Invalid file format'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }, []);

  // ── Course-specific export/import ─────────────────────

  const exportCourseToFile = useCallback((d: AppData, courseId: string) => {
    const course = d.courses.find(c => c.id === courseId);
    if (!course) return;
    const courseData: CourseExportData = {
      course,
      timeBlocks: d.timeBlocks.filter(b => b.courseId === courseId),
    };
    const courseName = sanitizeName(course.name);
    triggerDownload(`course_${courseName}.json`, JSON.stringify(courseData, null, 2));
  }, []);

  const importCourseFromFile = useCallback((file: File): Promise<CourseExportData> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const parsed = JSON.parse(e.target?.result as string) as Partial<CourseExportData>;
          if (!parsed.course?.id || !parsed.course?.name) {
            reject(new Error('File does not appear to be a course export (missing "course" field)'));
            return;
          }
          const normalized: CourseExportData = {
            course: parsed.course,
            timeBlocks: parsed.timeBlocks ?? [],
          };
          resolve(normalized);
        } catch {
          reject(new Error('Invalid file format'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }, []);

  return {
    data, update, reset,
    undo, redo,
    canUndo: hist.undo !== null,
    canRedo: hist.redo !== null,
    exportToFile, importFromFile,
    exportLocationToFile, importLocationFromFile,
    exportCourseToFile, importCourseFromFile,
  };
}

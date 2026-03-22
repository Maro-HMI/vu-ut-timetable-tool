import { useState, useCallback } from 'react';
import type { AppData } from './types';

const STORAGE_KEY = 'vu-ut-timetable-v1';

const defaultData: AppData = {
  module: null,
  courses: [],
  timeBlocks: [],
  dayNotes: {},
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

export function useAppData() {
  const [data, setData] = useState<AppData>(load);

  const update = useCallback((updater: (prev: AppData) => AppData) => {
    setData(prev => {
      const next = updater(prev);
      persist(next);
      return next;
    });
  }, []);

  const exportToFile = useCallback((d: AppData) => {
    const name = (d.module?.name ?? 'timetable').replace(/[^a-z0-9_-]/gi, '_');
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const importFromFile = useCallback((file: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const imported = JSON.parse(e.target?.result as string) as AppData;
          setData(imported);
          persist(imported);
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
    setData(defaultData);
  }, []);

  return { data, update, exportToFile, importFromFile, reset };
}

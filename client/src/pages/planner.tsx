import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useAppData } from '@/lib/storage';
import type { Location, TimeBlock, AppData, Module } from '@/lib/types';
import { TRAVEL_ID, TRAVEL_COLOR, TRAVEL_NAME } from '@/lib/types';
import { deriveWeeks, formatTime, formatMonthDate, DAY_LABELS, type Week } from '@/lib/weeks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  FiEye, FiEyeOff, FiLock, FiUnlock, FiPlus, FiTrash2, FiSettings,
  FiDownload, FiUpload, FiLink2, FiX, FiCalendar, FiSend, FiEdit2, FiPrinter, FiHelpCircle,
} from 'react-icons/fi';

/* ── Constants ─────────────────────────────────────────── */
const GRID_START  = 480;  // 08:00 in minutes
const GRID_END    = 1080; // 18:00 in minutes
const HOUR_HEIGHT = 30;   // px per hour
const PX_PER_MIN  = HOUR_HEIGHT / 60;
const GRID_HEIGHT = (GRID_END - GRID_START) * PX_PER_MIN; // 300px
const SNAP_MIN    = 15;
const LOCATIONS: Location[] = ['VU', 'UT'];
const TIME_AXIS_W = 28; // px
const GAP_W       = 44; // px – gap between VU and UT sections
const SIDEBAR_W   = 220; // px

const COURSE_COLORS = [
  '#9B59B6', '#E67E22', '#3498DB', '#27AE60', '#F06292',
  '#E74C3C', '#1ABC9C', '#F39C12', '#2980B9', '#8E44AD',
  '#16A085', '#D35400', '#2ECC71', '#E91E63', '#00BCD4',
];

/* ── Helpers ───────────────────────────────────────────── */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const snap  = (v: number, s: number) => Math.round(v / s) * s;
const uid   = () => crypto.randomUUID();
const roundHalf = (h: number) => Math.round(h * 2) / 2;

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function minutesToTimeStr(min: number): string {
  return `${Math.floor(min / 60).toString().padStart(2, '0')}:${(min % 60).toString().padStart(2, '0')}`;
}
function timeStrToMinutes(str: string): number {
  const [h, m] = str.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minFromClientY(colEl: HTMLElement, clientY: number): number {
  const rect = colEl.getBoundingClientRect();
  const y = clamp(clientY - rect.top, 0, GRID_HEIGHT);
  return clamp(snap(GRID_START + y / PX_PER_MIN, SNAP_MIN), GRID_START, GRID_END);
}

function colKey(location: Location, weekNumber: number, dayOfWeek: number) {
  return `${location}-w${weekNumber}-d${dayOfWeek}`;
}

function parseDayKey(key: string): { location: Location; weekNumber: number; dayOfWeek: number } | null {
  const m = key.match(/^(VU|UT)-w(\d+)-d(\d+)$/);
  if (!m) return null;
  return { location: m[1] as Location, weekNumber: Number(m[2]), dayOfWeek: Number(m[3]) };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function nextMonday(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function computeLayout(
  blocks: TimeBlock[]
): Map<string, { leftPct: number; widthPct: number }> {
  const out = new Map<string, { leftPct: number; widthPct: number }>();
  if (!blocks.length) return out;
  const sorted = [...blocks].sort(
    (a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id)
  );
  const colEnds: number[] = [];
  const colOf = new Map<string, number>();
  for (const b of sorted) {
    let c = colEnds.findIndex(e => e <= b.startMinute);
    if (c < 0) c = colEnds.length;
    colEnds[c] = b.endMinute;
    colOf.set(b.id, c);
  }
  for (const b of blocks) {
    const c = colOf.get(b.id) ?? 0;
    const concurrent = blocks.filter(
      o => o.startMinute < b.endMinute && o.endMinute > b.startMinute
    );
    const n = Math.max(c + 1, ...concurrent.map(o => (colOf.get(o.id) ?? 0) + 1));
    out.set(b.id, { leftPct: (c / n) * 100, widthPct: (1 / n) * 100 });
  }
  return out;
}

/* ── Drag State ────────────────────────────────────────── */
type DragCreate = {
  type: 'create';
  location: Location; weekNumber: number; dayOfWeek: number;
  startMin: number; currentMin: number;
};
type DragMove = {
  type: 'move';
  blockId: string; courseId: string; location: Location; weekNumber: number; dayOfWeek: number;
  startMin: number; endMin: number; duration: number; offsetMin: number;
};
type DragResize = {
  type: 'resize-top' | 'resize-bottom';
  blockId: string; location: Location; weekNumber: number; dayOfWeek: number;
  startMin: number; endMin: number;
};
type DragState = DragCreate | DragMove | DragResize;

/* ── Module Dialog ─────────────────────────────────────── */
function ModuleDialog({
  open, initial, onSave, onCancel,
}: {
  open: boolean; initial?: Module | null;
  onSave: (m: Omit<Module, 'id'>) => void; onCancel: () => void;
}) {
  const [name, setName]           = useState(initial?.name ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? nextMonday());
  const [numWeeks, setNumWeeks]   = useState(initial?.numWeeks ?? 10);
  useEffect(() => {
    if (open) {
      setName(initial?.name ?? ''); setStartDate(initial?.startDate ?? nextMonday());
      setNumWeeks(initial?.numWeeks ?? 10);
    }
  }, [open, initial]);
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{initial ? 'Module Settings' : 'Create Module'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Module Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. M1 Foundations of CreaTe" className="h-8 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">First Monday</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-8 text-sm" />
              <p className="text-[10px] text-muted-foreground">Week 1 start.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Number of Weeks</Label>
              <Input type="number" min={1} max={52} value={numWeeks} onChange={e => setNumWeeks(Number(e.target.value))} className="h-8 text-sm" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          {initial && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
          <Button size="sm" onClick={() => { if (name.trim() && startDate) onSave({ name: name.trim(), startDate, numWeeks }); }} disabled={!name.trim() || !startDate}>
            {initial ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Main Planner ──────────────────────────────────────── */
export default function Planner() {
  const { data, update, exportToFile, importFromFile } = useAppData();

  const [activeCourseId, setActiveCourseId]   = useState<string | null>(null);
  const [hiddenCourseIds, setHiddenCourseIds] = useState<Set<string>>(new Set());
  const [lockedLocations, setLockedLocations] = useState<Set<Location>>(new Set());
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [dragState, setDragState]             = useState<DragState | null>(null);
  const [syncMode, setSyncMode]               = useState<{
    blockId: string; courseId: string; fromLocation: Location;
  } | null>(null);

  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [editCourseName, setEditCourseName]   = useState('');
  const [editCourseColor, setEditCourseColor] = useState('#3b82f6');
  const [addingCourse, setAddingCourse]       = useState(false);
  const [newCourseName, setNewCourseName]     = useState('');
  const [newCourseColor, setNewCourseColor]   = useState(COURSE_COLORS[0]);

  const [dragCourseIdx, setDragCourseIdx] = useState<number | null>(null);

  const [showModuleSetup, setShowModuleSetup]       = useState(!data.module);
  const [showModuleSettings, setShowModuleSettings] = useState(false);
  const [showHelp, setShowHelp]                     = useState(false);
  const [editNotes, setEditNotes]                   = useState('');
  const [editPlace, setEditPlace]                   = useState('');

  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [editDayNote, setEditDayNote]       = useState('');

  /* Refs */
  const colRefs              = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragStateRef         = useRef<DragState | null>(null);
  const activeCourseRef      = useRef<string | null>(null);
  const dataRef              = useRef<AppData>(data);
  const updateRef            = useRef(update);
  const selectedIdRef        = useRef<string | null>(null);
  const selectedBlockIdRef   = useRef<string | null>(null);
  const deleteBlockRef       = useRef<(id: string) => void>(() => {});
  const fileInputRef         = useRef<HTMLInputElement>(null);

  useEffect(() => { dragStateRef.current = dragState; },           [dragState]);
  useEffect(() => { activeCourseRef.current = activeCourseId; },   [activeCourseId]);
  useEffect(() => { dataRef.current = data; },                     [data]);
  useEffect(() => { updateRef.current = update; },                 [update]);
  useEffect(() => { selectedIdRef.current = selectedBlockId; },    [selectedBlockId]);
  useEffect(() => { selectedBlockIdRef.current = selectedBlockId; }, [selectedBlockId]);

  /* Derived */
  const weeks = useMemo(() => {
    if (!data.module) return [];
    return deriveWeeks(data.module.startDate, data.module.numWeeks);
  }, [data.module]);

  const selectedBlock = useMemo(
    () => data.timeBlocks.find(b => b.id === selectedBlockId) ?? null,
    [data.timeBlocks, selectedBlockId]
  );

  useEffect(() => {
    if (selectedBlock) {
      setEditNotes(selectedBlock.notes ?? '');
      setEditPlace(selectedBlock.place ?? '');
    }
  }, [selectedBlockId]);

  useEffect(() => {
    if (selectedDayKey) setEditDayNote(data.dayNotes?.[selectedDayKey] ?? '');
  }, [selectedDayKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncPairBlock = useMemo(() => {
    if (!selectedBlock?.syncGroupId) return null;
    return data.timeBlocks.find(
      b => b.syncGroupId === selectedBlock.syncGroupId && b.id !== selectedBlock.id
    ) ?? null;
  }, [selectedBlock, data.timeBlocks]);

  /* Hours per course per location */
  const courseHours = useMemo(() => {
    const map = new Map<string, { VU: number; UT: number }>();
    for (const b of data.timeBlocks) {
      if (!map.has(b.courseId)) map.set(b.courseId, { VU: 0, UT: 0 });
      const h = (b.endMinute - b.startMinute) / 60;
      const entry = map.get(b.courseId)!;
      if (b.location === 'VU') entry.VU += h;
      else entry.UT += h;
    }
    return map;
  }, [data.timeBlocks]);

  /* Deselect block when its location becomes locked */
  useEffect(() => {
    if (selectedBlock && lockedLocations.has(selectedBlock.location)) {
      setSelectedBlockId(null);
    }
  }, [lockedLocations]);

  /* Document-level drag handlers */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;

      // For move drags, detect which day column the mouse is over (same location/week)
      let targetDay = ds.dayOfWeek;
      if (ds.type === 'move') {
        for (let d = 0; d < 5; d++) {
          const el = colRefs.current.get(colKey(ds.location, ds.weekNumber, d));
          if (el) {
            const rect = el.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right) {
              targetDay = d;
              break;
            }
          }
        }
      }

      const colEl = colRefs.current.get(colKey(ds.location, ds.weekNumber, targetDay));
      if (!colEl) return;
      const min = minFromClientY(colEl, e.clientY);
      setDragState(prev => {
        if (!prev) return null;
        if (prev.type === 'create') return { ...prev, currentMin: min };
        if (prev.type === 'resize-top') {
          const newStart = clamp(snap(min, SNAP_MIN), GRID_START, prev.endMin - SNAP_MIN);
          return { ...prev, startMin: newStart };
        }
        if (prev.type === 'resize-bottom') {
          const newEnd = clamp(snap(min, SNAP_MIN), prev.startMin + SNAP_MIN, GRID_END);
          return { ...prev, endMin: newEnd };
        }
        const newStart = clamp(snap(min - prev.offsetMin, SNAP_MIN), GRID_START, GRID_END - prev.duration);
        return { ...prev, startMin: newStart, endMin: newStart + prev.duration, dayOfWeek: targetDay };
      });
    };

    const onUp = () => {
      const ds = dragStateRef.current;
      if (!ds) return;
      if (ds.type === 'create') {
        const startMin = Math.min(ds.startMin, ds.currentMin);
        const endMin   = Math.max(ds.startMin, ds.currentMin);
        if (endMin - startMin < SNAP_MIN) {
          setSelectedBlockId(null);
        } else {
          const courseId = activeCourseRef.current;
          if (courseId) {
            updateRef.current(prev => ({
              ...prev,
              timeBlocks: [...prev.timeBlocks, {
                id: uid(), courseId,
                location: ds.location,
                weekNumber: ds.weekNumber,
                dayOfWeek: ds.dayOfWeek,
                startMinute: startMin,
                endMinute: endMin,
              }],
            }));
          }
        }
      } else if (ds.type === 'move') {
        updateRef.current(prev => ({
          ...prev,
          timeBlocks: prev.timeBlocks.map(b =>
            b.id === ds.blockId
              ? { ...b, dayOfWeek: ds.dayOfWeek, startMinute: ds.startMin, endMinute: ds.endMin }
              : b
          ),
        }));
      } else {
        // resize-top or resize-bottom
        updateRef.current(prev => ({
          ...prev,
          timeBlocks: prev.timeBlocks.map(b =>
            b.id === ds.blockId
              ? { ...b, startMinute: ds.startMin, endMinute: ds.endMin }
              : b
          ),
        }));
      }
      setDragState(null);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
  }, []);

  /* Global keyboard shortcuts */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        setSelectedBlockId(null);
        setSelectedDayKey(null);
        setActiveCourseId(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedBlockIdRef.current) {
        e.preventDefault();
        deleteBlockRef.current(selectedBlockIdRef.current);
        setSelectedBlockId(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  /* Actions */
  const deleteBlock = useCallback((id: string) => {
    update(prev => {
      const block = prev.timeBlocks.find(b => b.id === id);
      let blocks = prev.timeBlocks.filter(b => b.id !== id);
      if (block?.syncGroupId) {
        blocks = blocks.map(b =>
          b.syncGroupId === block.syncGroupId ? { ...b, syncGroupId: undefined } : b
        );
      }
      return { ...prev, timeBlocks: blocks };
    });
    if (selectedBlockId === id) setSelectedBlockId(null);
  }, [update, selectedBlockId]);
  useEffect(() => { deleteBlockRef.current = deleteBlock; }, [deleteBlock]);

  const saveDayNote = useCallback(() => {
    if (!selectedDayKey) return;
    update(prev => {
      const dayNotes = { ...(prev.dayNotes ?? {}) };
      if (editDayNote.trim()) {
        dayNotes[selectedDayKey] = editDayNote;
      } else {
        delete dayNotes[selectedDayKey];
      }
      return { ...prev, dayNotes };
    });
  }, [update, selectedDayKey, editDayNote]);

  const handleSelectDay = useCallback((key: string) => {
    setSelectedDayKey(key);
    setSelectedBlockId(null);
  }, []);

  const saveBlockNotes = useCallback(() => {
    if (!selectedBlock) return;
    update(prev => ({
      ...prev,
      timeBlocks: prev.timeBlocks.map(b =>
        b.id === selectedBlock.id ? { ...b, notes: editNotes || undefined } : b
      ),
    }));
  }, [update, selectedBlock, editNotes]);

  const saveBlockPlace = useCallback(() => {
    if (!selectedBlock) return;
    update(prev => ({
      ...prev,
      timeBlocks: prev.timeBlocks.map(b =>
        b.id === selectedBlock.id ? { ...b, place: editPlace.trim() || undefined } : b
      ),
    }));
  }, [update, selectedBlock, editPlace]);

  const updateBlockPosition = useCallback((
    weekNumber: number, dayOfWeek: number, startMinute: number, endMinute: number
  ) => {
    if (!selectedBlock) return;
    update(prev => ({
      ...prev,
      timeBlocks: prev.timeBlocks.map(b =>
        b.id === selectedBlock.id ? { ...b, weekNumber, dayOfWeek, startMinute, endMinute } : b
      ),
    }));
  }, [update, selectedBlock]);

  const toggleAtTwente = useCallback(() => {
    if (!selectedBlock) return;
    update(prev => ({
      ...prev,
      timeBlocks: prev.timeBlocks.map(b =>
        b.id === selectedBlock.id ? { ...b, atTwente: !b.atTwente } : b
      ),
    }));
  }, [update, selectedBlock]);

  const linkBlocks = useCallback((targetId: string) => {
    if (!syncMode) return;
    const groupId = uid();
    update(prev => ({
      ...prev,
      timeBlocks: prev.timeBlocks.map(b =>
        b.id === syncMode.blockId || b.id === targetId ? { ...b, syncGroupId: groupId } : b
      ),
    }));
    setSyncMode(null);
  }, [update, syncMode]);

  const unlinkBlock = useCallback((blockId: string) => {
    update(prev => {
      const block = prev.timeBlocks.find(b => b.id === blockId);
      if (!block?.syncGroupId) return prev;
      const gid = block.syncGroupId;
      return {
        ...prev,
        timeBlocks: prev.timeBlocks.map(b =>
          b.syncGroupId === gid ? { ...b, syncGroupId: undefined } : b
        ),
      };
    });
  }, [update]);

  const toggleVisibility = useCallback((id: string) => {
    setHiddenCourseIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleLock = useCallback((loc: Location) => {
    setLockedLocations(prev => {
      const next = new Set(prev);
      next.has(loc) ? next.delete(loc) : next.add(loc);
      return next;
    });
  }, []);

  const handleModuleSave = useCallback((fields: Omit<Module, 'id'>) => {
    update(prev => ({
      ...prev,
      module: prev.module ? { ...prev.module, ...fields } : { id: uid(), ...fields },
    }));
    setShowModuleSetup(false);
    setShowModuleSettings(false);
  }, [update]);

  const handleAddCourse = useCallback(() => {
    if (!newCourseName.trim()) return;
    update(prev => ({
      ...prev,
      courses: [...prev.courses, { id: uid(), name: newCourseName.trim(), color: newCourseColor }],
    }));
    setNewCourseName('');
    setAddingCourse(false);
  }, [update, newCourseName, newCourseColor]);

  const handleSaveCourseEdit = useCallback(() => {
    if (!editingCourseId || !editCourseName.trim()) return;
    update(prev => ({
      ...prev,
      courses: prev.courses.map(c =>
        c.id === editingCourseId ? { ...c, name: editCourseName, color: editCourseColor } : c
      ),
    }));
    setEditingCourseId(null);
  }, [update, editingCourseId, editCourseName, editCourseColor]);

  const handleDeleteCourse = useCallback((id: string) => {
    update(prev => ({
      ...prev,
      courses: prev.courses.filter(c => c.id !== id),
      timeBlocks: prev.timeBlocks.filter(b => b.courseId !== id),
    }));
    if (activeCourseId === id) setActiveCourseId(null);
    if (selectedBlock?.courseId === id) setSelectedBlockId(null);
  }, [update, activeCourseId, selectedBlock]);

  const handleCourseReorder = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    update(prev => {
      const courses = [...prev.courses];
      const [item] = courses.splice(fromIdx, 1);
      courses.splice(toIdx, 0, item);
      return { ...prev, courses };
    });
  }, [update]);

  function getCourseColor(courseId: string): string {
    if (courseId === TRAVEL_ID) return TRAVEL_COLOR;
    return data.courses.find(c => c.id === courseId)?.color ?? '#888';
  }
  function getCourseName(courseId: string): string {
    if (courseId === TRAVEL_ID) return TRAVEL_NAME;
    return data.courses.find(c => c.id === courseId)?.name ?? '?';
  }

  const getBlocks = useCallback(
    (location: Location, weekNumber: number, dayOfWeek: number): TimeBlock[] =>
      data.timeBlocks.filter(
        b => b.location === location && b.weekNumber === weekNumber &&
             b.dayOfWeek === dayOfWeek && !hiddenCourseIds.has(b.courseId)
      ),
    [data.timeBlocks, hiddenCourseIds]
  );

  const handleColumnMouseDown = useCallback(
    (e: React.MouseEvent, location: Location, weekNumber: number, dayOfWeek: number) => {
      if (e.button !== 0) return;
      if (lockedLocations.has(location)) return;
      if (!activeCourseRef.current) {
        setSelectedDayKey(null);
        setSelectedBlockId(null);
        return;
      }
      const colEl = colRefs.current.get(colKey(location, weekNumber, dayOfWeek));
      if (!colEl) return;
      const startMin = minFromClientY(colEl, e.clientY);
      setDragState({ type: 'create', location, weekNumber, dayOfWeek, startMin, currentMin: startMin });
    },
    [lockedLocations]
  );

  const handleBlockMouseDown = useCallback(
    (e: React.MouseEvent, block: TimeBlock) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      if (lockedLocations.has(block.location)) return;
      if (syncMode) {
        if (block.courseId === syncMode.courseId && block.location !== syncMode.fromLocation && block.id !== syncMode.blockId) {
          linkBlocks(block.id);
        } else {
          setSyncMode(null);
        }
        return;
      }
      setSelectedBlockId(block.id);
      setSelectedDayKey(null);
      const key = colKey(block.location, block.weekNumber, block.dayOfWeek);
      const colEl = colRefs.current.get(key);
      if (!colEl) return;
      const clickMin = minFromClientY(colEl, e.clientY);
      setDragState({
        type: 'move', blockId: block.id, courseId: block.courseId,
        location: block.location, weekNumber: block.weekNumber, dayOfWeek: block.dayOfWeek,
        startMin: block.startMinute, endMin: block.endMinute,
        duration: block.endMinute - block.startMinute,
        offsetMin: clickMin - block.startMinute,
      });
    },
    [lockedLocations, syncMode, linkBlocks]
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, block: TimeBlock, edge: 'top' | 'bottom') => {
      e.stopPropagation();
      if (e.button !== 0) return;
      if (lockedLocations.has(block.location)) return;
      setSelectedBlockId(block.id);
      setSelectedDayKey(null);
      setDragState({
        type: edge === 'top' ? 'resize-top' : 'resize-bottom',
        blockId: block.id, location: block.location,
        weekNumber: block.weekNumber, dayOfWeek: block.dayOfWeek,
        startMin: block.startMinute, endMin: block.endMinute,
      });
    },
    [lockedLocations]
  );

  if (!data.module) {
    return (
      <>
        {/* Mobile notice */}
        <div className="sm:hidden fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background px-8 text-center gap-4">
          <FiCalendar size={48} className="text-muted-foreground/40" />
          <h1 className="text-lg font-semibold">Desktop only</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This timetable planner is designed for use on a laptop or desktop computer and requires a large screen to work properly.
          </p>
          <p className="text-xs text-muted-foreground">Please open it on a wider display.</p>
        </div>
        <div className="flex items-center justify-center h-screen bg-background">
          <div className="text-center space-y-3">
            <FiCalendar size={48} className="mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No module configured yet.</p>
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" onClick={() => setShowModuleSetup(true)}>Create Module</Button>
              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <FiUpload size={13} className="mr-1.5" /> Load from File
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowHelp(true)}>
                <FiHelpCircle size={13} className="mr-1.5" /> Help
              </Button>
            </div>
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept=".json" className="hidden"
          onChange={async e => { const f = e.target.files?.[0]; if (f) { await importFromFile(f); e.target.value = ''; } }}
        />
        <ModuleDialog open={showModuleSetup} onSave={handleModuleSave} onCancel={() => setShowModuleSetup(false)} />
        <HelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">

      {/* Mobile notice – shown only on small screens */}
      <div className="sm:hidden fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background px-8 text-center gap-4">
        <FiCalendar size={48} className="text-muted-foreground/40" />
        <h1 className="text-lg font-semibold">Desktop only</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This timetable planner is designed for use on a laptop or desktop computer and requires a large screen to work properly.
        </p>
        <p className="text-xs text-muted-foreground">Please open it on a wider display.</p>
      </div>

      {/* ── Sidebar ──────────────────────────────────────── */}
      <div
        style={{ width: SIDEBAR_W, minWidth: SIDEBAR_W }}
        className="flex-shrink-0 border-r flex flex-col overflow-hidden bg-card"
      >
          {/* Course list area */}
          <div className="flex-shrink-0 overflow-y-auto px-2 pt-3 pb-1">
            {/* General section */}
            <div className="mb-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                General
              </p>
            </div>
            <CourseItem
              id={TRAVEL_ID} name={TRAVEL_NAME} color={TRAVEL_COLOR} isTravel
              isActive={activeCourseId === TRAVEL_ID}
              isHidden={hiddenCourseIds.has(TRAVEL_ID)}
              onActivate={() => setActiveCourseId(prev => prev === TRAVEL_ID ? null : TRAVEL_ID)}
              onToggleVisibility={() => toggleVisibility(TRAVEL_ID)}
            />

            <div className="mt-3 mb-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
                Courses
              </p>
            </div>

            {/* User courses – draggable for reorder */}
            {data.courses.map((course, idx) => {
              const hrs = courseHours.get(course.id);
              return editingCourseId === course.id ? (
                <div key={course.id} className="mb-1 border rounded-md p-2 bg-background space-y-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={editCourseColor}
                      onChange={e => setEditCourseColor(e.target.value)}
                      className="h-7 w-7 rounded cursor-pointer border border-border p-0.5 flex-shrink-0"
                    />
                    <Input
                      value={editCourseName}
                      onChange={e => setEditCourseName(e.target.value)}
                      className="h-7 text-xs flex-1"
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveCourseEdit(); if (e.key === 'Escape') setEditingCourseId(null); }}
                    />
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-6 text-[10px] flex-1" onClick={handleSaveCourseEdit}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditingCourseId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div
                  key={course.id}
                  draggable
                  onDragStart={() => setDragCourseIdx(idx)}
                  onDragOver={e => { e.preventDefault(); }}
                  onDrop={() => {
                    if (dragCourseIdx !== null) {
                      handleCourseReorder(dragCourseIdx, idx);
                      setDragCourseIdx(null);
                    }
                  }}
                  onDragEnd={() => setDragCourseIdx(null)}
                  className={cn(dragCourseIdx === idx && 'opacity-40')}
                >
                  <CourseItem
                    id={course.id} name={course.name} color={course.color}
                    isActive={activeCourseId === course.id}
                    isHidden={hiddenCourseIds.has(course.id)}
                    hoursVU={hrs ? roundHalf(hrs.VU) : 0}
                    hoursUT={hrs ? roundHalf(hrs.UT) : 0}
                    onActivate={() => setActiveCourseId(prev => prev === course.id ? null : course.id)}
                    onToggleVisibility={() => toggleVisibility(course.id)}
                    onEdit={() => { setEditingCourseId(course.id); setEditCourseName(course.name); setEditCourseColor(course.color); }}
                    onDelete={() => handleDeleteCourse(course.id)}
                  />
                </div>
              );
            })}

            {/* Add course */}
            {addingCourse ? (
              <div className="mb-1 border rounded-md p-2 bg-background space-y-2">
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={newCourseColor}
                    onChange={e => setNewCourseColor(e.target.value)}
                    className="h-7 w-7 rounded cursor-pointer border border-border p-0.5 flex-shrink-0"
                  />
                  <Input
                    value={newCourseName}
                    onChange={e => setNewCourseName(e.target.value)}
                    placeholder="Course name"
                    className="h-7 text-xs flex-1"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') handleAddCourse(); if (e.key === 'Escape') { setAddingCourse(false); setNewCourseName(''); } }}
                  />
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-6 text-[10px] flex-1" onClick={handleAddCourse} disabled={!newCourseName.trim()}>Add</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setAddingCourse(false); setNewCourseName(''); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setAddingCourse(true); setNewCourseColor(COURSE_COLORS[data.courses.length % COURSE_COLORS.length]); }}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors mt-0.5"
              >
                <FiPlus size={12} /> Add Course
              </button>
            )}

            {!activeCourseId && (
              <p className="text-[10px] text-muted-foreground mt-2 px-1 italic">
                Click a course to activate it, then drag on the calendar to add entries.
              </p>
            )}
            {activeCourseId && (
              <p className="text-[10px] px-1 mt-2 italic" style={{ color: getCourseColor(activeCourseId) }}>
                Active: {getCourseName(activeCourseId)} — drag to create
              </p>
            )}
          </div>

          {/* Divider + block details */}
          <div className="border-t mx-2 mt-1 flex-shrink-0" />
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mt-2 mb-1">
              Current Block
            </p>
            {selectedBlock ? (
              <BlockDetails
                block={selectedBlock}
                courseColor={getCourseColor(selectedBlock.courseId)}
                courseName={getCourseName(selectedBlock.courseId)}
                syncPair={syncPairBlock}
                syncMode={syncMode?.blockId === selectedBlock.id}
                editNotes={editNotes}
                editPlace={editPlace}
                numWeeks={data.module.numWeeks}
                onEditNotes={setEditNotes}
                onSaveNotes={saveBlockNotes}
                onEditPlace={setEditPlace}
                onSavePlace={saveBlockPlace}
                onUpdatePosition={updateBlockPosition}
                onToggleAtTwente={toggleAtTwente}
                onDelete={() => deleteBlock(selectedBlock.id)}
                onStartSync={() => setSyncMode({ blockId: selectedBlock.id, courseId: selectedBlock.courseId, fromLocation: selectedBlock.location })}
                onCancelSync={() => setSyncMode(null)}
                onUnlink={() => unlinkBlock(selectedBlock.id)}
                getSyncPartnerName={() =>
                  syncPairBlock ? `${syncPairBlock.location} W${syncPairBlock.weekNumber} ${DAY_LABELS[syncPairBlock.dayOfWeek]}` : ''
                }
              />
            ) : selectedDayKey ? (
              <DayNoteEditor
                dayKey={selectedDayKey}
                note={editDayNote}
                onChangeNote={setEditDayNote}
                onSaveNote={saveDayNote}
              />
            ) : (
              <p className="text-[10px] text-muted-foreground text-center py-4 italic">
                Click a calendar entry or day to see details.
              </p>
            )}
          </div>
        </div>

        {/* ── Calendar Area ─────────────────────────────── */}
        <div
          className="flex flex-col flex-1 min-w-0"
          onClick={() => { setSelectedBlockId(null); setSelectedDayKey(null); }}
        >
          {/* Module header row */}
          <div className="flex-shrink-0 border-b bg-card z-30 flex items-center h-8 gap-1.5 px-3">
            <FiCalendar size={13} className="text-primary flex-shrink-0" />
            <span className="text-xs font-semibold truncate flex-1 min-w-0">{data.module.name}</span>
            <button title="Module settings" onClick={e => { e.stopPropagation(); setShowModuleSettings(true); }} className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors flex-shrink-0">
              <FiSettings size={12} />
            </button>
            <button title="Help" onClick={e => { e.stopPropagation(); setShowHelp(true); }} className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors flex-shrink-0">
              <FiHelpCircle size={12} />
            </button>
            <button onClick={e => { e.stopPropagation(); exportToFile(data); }} className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded transition-colors flex-shrink-0 flex items-center gap-1">
              <FiDownload size={11} /> Save to File
            </button>
            <button onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }} className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded transition-colors flex-shrink-0 flex items-center gap-1">
              <FiUpload size={11} /> Load from File
            </button>
            <button title="Export PDF" onClick={e => { e.stopPropagation(); generatePDF(data, weeks); }} className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded transition-colors flex-shrink-0 flex items-center gap-1">
              <FiPrinter size={11} /> PDF
            </button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden"
              onChange={async e => { const f = e.target.files?.[0]; if (f) { await importFromFile(f); e.target.value = ''; } }}
            />
          </div>

          {/* VU / UT header row */}
          <div className="flex-shrink-0 border-b bg-card z-30 flex h-8">
            <div style={{ width: TIME_AXIS_W, minWidth: TIME_AXIS_W }} className="flex-shrink-0" />
            <div className="flex-1 flex items-center justify-center gap-2">
              <span className="text-xs font-bold tracking-wider">VU Amsterdam</span>
              <button
                title={lockedLocations.has('VU') ? 'Unlock VU' : 'Lock VU'}
                onClick={e => { e.stopPropagation(); toggleLock('VU'); }}
                className={cn('p-0.5 rounded transition-colors', lockedLocations.has('VU') ? 'text-amber-600' : 'text-muted-foreground hover:text-foreground')}
              >
                {lockedLocations.has('VU') ? <FiLock size={13} /> : <FiUnlock size={13} />}
              </button>
            </div>
            <div style={{ width: GAP_W, minWidth: GAP_W }} className="flex-shrink-0" />
            <div className="flex-1 flex items-center justify-center gap-2">
              <span className="text-xs font-bold tracking-wider">UTwente</span>
              <button
                title={lockedLocations.has('UT') ? 'Unlock UT' : 'Lock UT'}
                onClick={e => { e.stopPropagation(); toggleLock('UT'); }}
                className={cn('p-0.5 rounded transition-colors', lockedLocations.has('UT') ? 'text-amber-600' : 'text-muted-foreground hover:text-foreground')}
              >
                {lockedLocations.has('UT') ? <FiLock size={13} /> : <FiUnlock size={13} />}
              </button>
            </div>
          </div>

          {/* Scrollable weeks */}
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <div className="min-w-[700px]">
              {weeks.map(week => (
                <WeekSection
                  key={week.weekNumber} week={week}
                  getBlocks={getBlocks}
                  selectedBlockId={selectedBlockId}
                  syncMode={syncMode}
                  syncPairId={syncPairBlock?.id ?? null}
                  dragState={dragState}
                  lockedLocations={lockedLocations}
                  colRefs={colRefs}
                  dayNotes={data.dayNotes ?? {}}
                  selectedDayKey={selectedDayKey}
                  hasActiveCourse={activeCourseId !== null}
                  activeSyncGroupId={selectedBlock?.syncGroupId ?? null}
                  activeSyncLocation={selectedBlock?.location ?? null}
                  onSelectDay={handleSelectDay}
                  onColumnMouseDown={handleColumnMouseDown}
                  onBlockMouseDown={handleBlockMouseDown}
                  onResizeMouseDown={handleResizeMouseDown}
                  onSelectBlock={id => { setSelectedBlockId(id); }}
                  getCourseColor={getCourseColor}
                  getCourseName={getCourseName}
                />
              ))}
            </div>
          </div>
        </div>

      {/* Sync banner */}
      {syncMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-primary text-primary-foreground text-xs px-4 py-2 rounded-full shadow-lg">
          <FiLink2 size={13.5} />
          Click a <strong>{syncMode.fromLocation === 'VU' ? 'UT' : 'VU'}</strong> block of the same course to link it
          <button onClick={() => setSyncMode(null)} className="ml-1 hover:opacity-80">
            <FiX size={13.5} />
          </button>
        </div>
      )}

      <ModuleDialog open={showModuleSetup} onSave={handleModuleSave} onCancel={() => setShowModuleSetup(false)} />
      <ModuleDialog open={showModuleSettings} initial={data.module} onSave={handleModuleSave} onCancel={() => setShowModuleSettings(false)} />
      <HelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}

/* ── Help Dialog ───────────────────────────────────────── */
function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg rounded-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <FiHelpCircle size={15} /> How to use the Timetable Planner
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1 text-sm text-muted-foreground">

          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">What is this?</h3>
            <p className="text-xs">A visual timetable tool for students enrolled in a dual-location programme (VU Amsterdam + University of Twente). Plan your weekly schedule across both campuses for an entire module.</p>
          </section>

          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Getting started</h3>
            <ul className="text-xs space-y-1 list-disc list-outside pl-4">
              <li><strong>Create Module</strong> — set a name, the Monday of week 1, and how many weeks the module runs.</li>
              <li><strong>Load from File</strong> — restore a previously saved timetable from a <code>.json</code> file.</li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Courses</h3>
            <ul className="text-xs space-y-1 list-disc list-outside pl-4">
              <li>Click <strong>+ Add Course</strong> in the sidebar to create a course with a name and colour.</li>
              <li><strong>Click</strong> a course to activate it (highlighted) — subsequent drags will create entries for that course.</li>
              <li>Click a course again to deactivate it.</li>
              <li>Double-click a course name to rename or recolour it.</li>
              <li>Drag courses in the sidebar to reorder them.</li>
              <li>Use the eye icon to hide/show a course on the calendar.</li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Creating &amp; editing time blocks</h3>
            <ul className="text-xs space-y-1 list-disc list-outside pl-4">
              <li><strong>Activate a course</strong>, then <strong>drag</strong> on a day column to create a time block.</li>
              <li><strong>Click</strong> an existing block to select it — edit week, day, start/end time in the sidebar.</li>
              <li><strong>Drag</strong> a selected block to move it.</li>
              <li>Use <strong>Delete entry</strong> in the sidebar to remove a block.</li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Travel &amp; "At Twente"</h3>
            <ul className="text-xs space-y-1 list-disc list-outside pl-4">
              <li><strong>Travel</strong> is a built-in course for marking travel time. Activate it from the General section.</li>
              <li>For a VU block, check <strong>At Twente</strong> in the sidebar to indicate you are physically at UT — shown with a coloured left stripe.</li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Linking blocks (sync)</h3>
            <ul className="text-xs space-y-1 list-disc list-outside pl-4">
              <li>Select a block and click <strong>Link to VU/UT block</strong> to link it with a corresponding block at the other location.</li>
              <li>Linked blocks display a <strong>↔</strong> indicator and are highlighted together when selected.</li>
              <li>Click the × next to the link label to unlink.</li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Day notes</h3>
            <ul className="text-xs space-y-1 list-disc list-outside pl-4">
              <li><strong>Click any day header</strong> (Mon, Tue…) in the calendar to open a note editor in the sidebar.</li>
              <li>Days with notes show a <span className="inline-block h-2 w-2 rounded-full bg-blue-600 align-middle" /> blue dot and a tooltip preview on hover.</li>
            </ul>
          </section>

          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Locking a location</h3>
            <p className="text-xs">Click the lock icon next to VU or UT to prevent accidental edits to that side of the calendar.</p>
          </section>

          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Save, load &amp; PDF</h3>
            <ul className="text-xs space-y-1 list-disc list-outside pl-4">
              <li><strong>Save to File</strong> — exports your timetable as a <code>.json</code> file you can share or back up.</li>
              <li><strong>Load from File</strong> — imports a previously saved <code>.json</code> file.</li>
              <li><strong>PDF</strong> — opens a print-ready view in a new tab; use your browser's print function to save as PDF.</li>
              <li>Your timetable is also automatically saved in your browser's local storage.</li>
            </ul>
          </section>

        </div>
        <DialogFooter>
          <Button size="sm" onClick={onClose}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Course Item ───────────────────────────────────────── */
interface CourseItemProps {
  id: string; name: string; color: string; isTravel?: boolean;
  isActive: boolean; isHidden: boolean;
  hoursVU?: number; hoursUT?: number;
  onActivate: () => void; onToggleVisibility: () => void;
  onEdit?: () => void; onDelete?: () => void;
}

function CourseItem({ id, name, color, isTravel, isActive, isHidden, hoursVU, hoursUT, onActivate, onToggleVisibility, onEdit, onDelete }: CourseItemProps) {
  const showHours = !isTravel && (hoursVU !== undefined || hoursUT !== undefined);
  return (
    <div
      className={cn(
        'group flex items-start gap-1.5 px-2 py-1 rounded-md mb-0.5 cursor-pointer transition-colors select-none',
        isActive ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/40'
      )}
      onClick={onActivate}
    >
      <div className={cn('flex-shrink-0', isTravel ? 'mt-[1px]' : 'mt-[3px]')}>
        {isTravel
          ? <FiSend size={11} style={{ color }} />
          : <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        }
      </div>
      <div className="flex-1 min-w-0">
        <span className={cn('text-xs leading-none truncate block', isHidden && 'opacity-40 line-through', isActive && 'font-medium')}
          onDoubleClick={e => { e.stopPropagation(); onEdit?.(); }}>
          {name}
        </span>
        {showHours && (
          <span className="text-[9px] text-muted-foreground leading-none mt-[3px] block" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <strong>VU</strong> {hoursVU ?? 0}h · <strong>UT</strong> {hoursUT ?? 0}h
          </span>
        )}
      </div>
      <button onClick={e => { e.stopPropagation(); onToggleVisibility(); }}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5 rounded transition-opacity"
        title={isHidden ? 'Show' : 'Hide'}>
        {isHidden ? <FiEyeOff size={11} /> : <FiEye size={11} />}
      </button>
      {onEdit && (
        <button onClick={e => { e.stopPropagation(); onEdit(); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5 rounded transition-opacity"
          title="Edit">
          <FiEdit2 size={11} />
        </button>
      )}
      {onDelete && (
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 rounded transition-opacity"
          title="Delete course">
          <FiX size={11} />
        </button>
      )}
    </div>
  );
}

/* ── Block Details Panel ───────────────────────────────── */
interface BlockDetailsProps {
  block: TimeBlock; courseColor: string; courseName: string;
  syncPair: TimeBlock | null; syncMode: boolean;
  editNotes: string; editPlace: string; numWeeks: number;
  onEditNotes: (v: string) => void; onSaveNotes: () => void;
  onEditPlace: (v: string) => void; onSavePlace: () => void;
  onUpdatePosition: (week: number, day: number, start: number, end: number) => void;
  onToggleAtTwente: () => void;
  onDelete: () => void; onStartSync: () => void; onCancelSync: () => void; onUnlink: () => void;
  getSyncPartnerName: () => string;
}

function BlockDetails({
  block, courseColor, courseName, syncPair, syncMode,
  editNotes, editPlace, numWeeks, onEditNotes, onSaveNotes, onEditPlace, onSavePlace, onUpdatePosition,
  onToggleAtTwente,
  onDelete, onStartSync, onCancelSync, onUnlink, getSyncPartnerName,
}: BlockDetailsProps) {
  const [localWeek,  setLocalWeek]  = useState(block.weekNumber);
  const [localDay,   setLocalDay]   = useState(block.dayOfWeek);
  const [localStart, setLocalStart] = useState(block.startMinute);
  const [localEnd,   setLocalEnd]   = useState(block.endMinute);

  useEffect(() => {
    setLocalWeek(block.weekNumber);
    setLocalDay(block.dayOfWeek);
    setLocalStart(block.startMinute);
    setLocalEnd(block.endMinute);
  }, [block.id, block.weekNumber, block.dayOfWeek, block.startMinute, block.endMinute]);

  const commit = (w = localWeek, d = localDay, s = localStart, e = localEnd) => {
    if (e > s) onUpdatePosition(w, d, s, e);
  };

  const canSync    = block.courseId !== TRAVEL_ID;
  const isVUBlock  = block.location === 'VU' && block.courseId !== TRAVEL_ID;

  return (
    <div className="space-y-2 pt-0.5" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: courseColor }} />
        <span className="text-xs font-semibold truncate">{courseName}</span>
      </div>

      {/* Editable position */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">Week</Label>
          <select
            value={localWeek}
            onChange={e => { const w = Number(e.target.value); setLocalWeek(w); commit(w, localDay, localStart, localEnd); }}
            className="w-full h-7 text-xs border border-input rounded px-1.5 bg-background"
          >
            {Array.from({ length: numWeeks }, (_, i) => (
              <option key={i + 1} value={i + 1}>W{i + 1}</option>
            ))}
          </select>
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">Day</Label>
          <select
            value={localDay}
            onChange={e => { const d = Number(e.target.value); setLocalDay(d); commit(localWeek, d, localStart, localEnd); }}
            className="w-full h-7 text-xs border border-input rounded px-1.5 bg-background"
          >
            {DAY_LABELS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">Start</Label>
          <input
            type="time"
            value={minutesToTimeStr(localStart)}
            onChange={e => setLocalStart(timeStrToMinutes(e.target.value))}
            onBlur={() => commit()}
            className="w-full h-7 text-xs border border-input rounded px-1.5 bg-background"
          />
        </div>
        <div className="space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">End</Label>
          <input
            type="time"
            value={minutesToTimeStr(localEnd)}
            onChange={e => setLocalEnd(timeStrToMinutes(e.target.value))}
            onBlur={() => commit()}
            className="w-full h-7 text-xs border border-input rounded px-1.5 bg-background"
          />
        </div>
      </div>

      {/* Place / room label */}
      <div className="space-y-0.5">
        <Label className="text-[10px] text-muted-foreground">Location</Label>
        <Input
          value={editPlace}
          onChange={e => onEditPlace(e.target.value)}
          onBlur={onSavePlace}
          placeholder="e.g. NU-3A22"
          className="h-7 text-xs"
        />
      </div>

      {/* At Twente – VU blocks only */}
      {isVUBlock && (
        <label className="flex items-center gap-2 cursor-pointer select-none py-0.5">
          <input
            type="checkbox"
            checked={!!block.atTwente}
            onChange={onToggleAtTwente}
            className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
          />
          <span className="text-xs text-muted-foreground">At Twente</span>
        </label>
      )}

      {/* Notes */}
      <div className="space-y-1">
        <Label className="text-[10px]">Notes</Label>
        <Textarea value={editNotes} onChange={e => onEditNotes(e.target.value)} onBlur={onSaveNotes}
          placeholder="Add notes…" className="text-xs min-h-[48px] resize-none" rows={2} />
      </div>

      {/* Sync */}
      {canSync && (
        <div className="space-y-1">
          <Label className="text-[10px]">Link to other location</Label>
          {block.syncGroupId ? (
            <div className="flex items-center gap-1.5">
              <div className="flex-1 text-[10px] text-muted-foreground truncate">
                <span className="text-foreground font-medium">↔</span> {getSyncPartnerName()}
              </div>
              <button onClick={onUnlink} className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors" title="Remove link">
                <FiX size={12} />
              </button>
            </div>
          ) : syncMode ? (
            <button onClick={onCancelSync} className="text-[10px] text-primary flex items-center gap-1 animate-pulse">
              <FiX size={12} /> Cancel — waiting for click…
            </button>
          ) : (
            <button onClick={onStartSync} className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1.5 transition-colors">
              <FiLink2 size={12} />
              Link to {block.location === 'VU' ? 'UT' : 'VU'} block
            </button>
          )}
        </div>
      )}

      <Button variant="destructive" size="sm" className="w-full h-7 text-[10px] mt-1" onClick={onDelete}>
        <FiTrash2 size={12} className="mr-1" /> Delete entry
      </Button>
    </div>
  );
}

/* ── Week Section ──────────────────────────────────────── */
interface WeekSectionProps {
  week: Week;
  getBlocks: (location: Location, weekNumber: number, dayOfWeek: number) => TimeBlock[];
  selectedBlockId: string | null;
  syncMode: { blockId: string; courseId: string; fromLocation: Location } | null;
  syncPairId: string | null;
  dragState: DragState | null;
  lockedLocations: Set<Location>;
  colRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  dayNotes: Record<string, string>;
  selectedDayKey: string | null;
  hasActiveCourse: boolean;
  activeSyncGroupId: string | null;
  activeSyncLocation: Location | null;
  onSelectDay: (key: string) => void;
  onColumnMouseDown: (e: React.MouseEvent, loc: Location, wn: number, d: number) => void;
  onBlockMouseDown: (e: React.MouseEvent, block: TimeBlock) => void;
  onResizeMouseDown: (e: React.MouseEvent, block: TimeBlock, edge: 'top' | 'bottom') => void;
  onSelectBlock: (id: string) => void;
  getCourseColor: (id: string) => string;
  getCourseName: (id: string) => string;
}

function WeekSection({
  week, getBlocks, selectedBlockId, syncMode, syncPairId,
  dragState, lockedLocations, colRefs,
  dayNotes, onSelectDay, hasActiveCourse, activeSyncGroupId, activeSyncLocation,
  onColumnMouseDown, onBlockMouseDown, onResizeMouseDown, onSelectBlock,
  getCourseColor, getCourseName,
}: WeekSectionProps) {
  const cw = getISOWeek(week.startDate);
  const [dayHover, setDayHover] = useState<{ note: string; x: number; y: number } | null>(null);

  return (
    <div className="border-b-2">
      {/* Sticky week header */}
      <div className="sticky top-0 z-20 flex bg-white">
        {/* Time axis slot – same bg as grid, no bottom border so it reads as one column */}
        <div style={{ width: TIME_AXIS_W, minWidth: TIME_AXIS_W }} className="flex-shrink-0 border-r bg-slate-100" />
        {/* VU day headers */}
        <div className="flex-1 flex border-r border-b-2">
          {week.days.map((day, di) => {
            const dKey = colKey('VU', week.weekNumber, di);
            const note = dayNotes[dKey];
            return (
              <div
                key={di}
                className={cn('flex-1 text-center py-1 relative cursor-pointer hover:bg-muted/20 transition-colors', di > 0 && 'border-l')}
                onClick={e => { e.stopPropagation(); onSelectDay(dKey); }}
                onMouseMove={note ? e => setDayHover({ note, x: e.clientX, y: e.clientY }) : undefined}
                onMouseLeave={note ? () => setDayHover(null) : undefined}
              >
                {note && <div className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-blue-600" />}
                <div className="text-[9px] text-muted-foreground font-medium">{DAY_LABELS[di]}</div>
                <div className="text-[9px] text-muted-foreground">{formatMonthDate(day)}</div>
              </div>
            );
          })}
        </div>
        {/* Gap W/CW */}
        <div
          style={{ width: GAP_W, minWidth: GAP_W }}
          className="flex-shrink-0 flex flex-col items-center justify-center border-r border-b-2 bg-muted/20 py-0.5"
        >
          <span className="text-[10px] font-bold leading-none text-foreground" style={{ fontVariantNumeric: 'tabular-nums' }}>
            W{week.weekNumber}
          </span>
          <span className="text-[9px] leading-none text-muted-foreground mt-0.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
            CW{cw}
          </span>
        </div>
        {/* UT day headers */}
        <div className="flex-1 flex border-b-2">
          {week.days.map((day, di) => {
            const dKey = colKey('UT', week.weekNumber, di);
            const note = dayNotes[dKey];
            return (
              <div
                key={di}
                className={cn('flex-1 text-center py-1 relative cursor-pointer hover:bg-muted/20 transition-colors', di > 0 && 'border-l')}
                onClick={e => { e.stopPropagation(); onSelectDay(dKey); }}
                onMouseMove={note ? e => setDayHover({ note, x: e.clientX, y: e.clientY }) : undefined}
                onMouseLeave={note ? () => setDayHover(null) : undefined}
              >
                {note && <div className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-blue-600" />}
                <div className="text-[9px] text-muted-foreground font-medium">{DAY_LABELS[di]}</div>
                <div className="text-[9px] text-muted-foreground">{formatMonthDate(day)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Time grid */}
      <div className="flex">
        <div
          style={{ width: TIME_AXIS_W, minWidth: TIME_AXIS_W, height: GRID_HEIGHT }}
          className="flex-shrink-0 border-r relative overflow-visible bg-slate-100"
        >
          {Array.from({ length: 11 }, (_, i) => (
            <div key={i} className="absolute right-1 text-[9px] text-muted-foreground leading-none"
              style={{ top: i * HOUR_HEIGHT + 1, fontVariantNumeric: 'tabular-nums' }}>
              {8 + i}:00
            </div>
          ))}
        </div>

        <div className="flex-1 flex border-r relative">
          <GridLines />
          {Array.from({ length: 5 }, (_, di) => (
            <DayColumn key={di} location="VU" weekNumber={week.weekNumber} dayOfWeek={di}
              blocks={getBlocks('VU', week.weekNumber, di)}
              selectedBlockId={selectedBlockId} syncMode={syncMode} syncPairId={syncPairId}
              dragState={dragState?.location === 'VU' && dragState?.weekNumber === week.weekNumber ? dragState : null}
              locked={lockedLocations.has('VU')} colRefs={colRefs} hasActiveCourse={hasActiveCourse}
              activeSyncGroupId={activeSyncGroupId} activeSyncLocation={activeSyncLocation}
              onMouseDown={onColumnMouseDown} onBlockMouseDown={onBlockMouseDown} onResizeMouseDown={onResizeMouseDown} onSelectBlock={onSelectBlock}
              getCourseColor={getCourseColor} getCourseName={getCourseName}
            />
          ))}
        </div>

        {/* Gap column – plain white */}
        <div
          style={{ width: GAP_W, minWidth: GAP_W, height: GRID_HEIGHT }}
          className="flex-shrink-0 border-r bg-white"
        />

        <div className="flex-1 flex relative">
          <GridLines />
          {Array.from({ length: 5 }, (_, di) => (
            <DayColumn key={di} location="UT" weekNumber={week.weekNumber} dayOfWeek={di}
              blocks={getBlocks('UT', week.weekNumber, di)}
              selectedBlockId={selectedBlockId} syncMode={syncMode} syncPairId={syncPairId}
              dragState={dragState?.location === 'UT' && dragState?.weekNumber === week.weekNumber ? dragState : null}
              locked={lockedLocations.has('UT')} colRefs={colRefs} hasActiveCourse={hasActiveCourse}
              activeSyncGroupId={activeSyncGroupId} activeSyncLocation={activeSyncLocation}
              onMouseDown={onColumnMouseDown} onBlockMouseDown={onBlockMouseDown} onResizeMouseDown={onResizeMouseDown} onSelectBlock={onSelectBlock}
              getCourseColor={getCourseColor} getCourseName={getCourseName}
            />
          ))}
        </div>
      </div>

      {/* Day-note cursor-following popup */}
      {dayHover && (() => {
        const PAD = 12;
        const POP_W = 200;
        const vpW = window.innerWidth;
        const vpH = window.innerHeight;
        const flipX = dayHover.x + PAD + POP_W > vpW;
        const flipY = dayHover.y + PAD + 60 > vpH;
        const x = flipX ? dayHover.x - PAD : dayHover.x + PAD;
        const y = flipY ? dayHover.y - PAD : dayHover.y + PAD;
        const transform = `${flipX ? 'translateX(-100%)' : ''} ${flipY ? 'translateY(-100%)' : ''}`.trim() || undefined;
        return (
          <div
            className="fixed z-[9998] bg-popover text-popover-foreground border rounded-md shadow-md px-2.5 py-1.5 text-xs pointer-events-none max-w-[200px]"
            style={{ left: x, top: y, transform }}
          >
            <p className="whitespace-pre-wrap">{dayHover.note}</p>
          </div>
        );
      })()}
    </div>
  );
}

/* ── Day Note Editor ───────────────────────────────────── */
interface DayNoteEditorProps {
  dayKey: string; note: string;
  onChangeNote: (v: string) => void; onSaveNote: () => void;
}

function DayNoteEditor({ dayKey, note, onChangeNote, onSaveNote }: DayNoteEditorProps) {
  const parsed = parseDayKey(dayKey);
  return (
    <div className="space-y-2 pt-0.5" onClick={e => e.stopPropagation()}>
      {parsed && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">{parsed.location}</span>
          <span className="text-xs text-muted-foreground">W{parsed.weekNumber} · {DAY_LABELS[parsed.dayOfWeek]}</span>
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-[10px]">Day Note</Label>
        <Textarea
          value={note}
          onChange={e => onChangeNote(e.target.value)}
          onBlur={onSaveNote}
          placeholder="Add a note for this day…"
          className="text-xs min-h-[48px] resize-none"
          rows={3}
          autoFocus
        />
      </div>
    </div>
  );
}

/* ── Grid Lines ────────────────────────────────────────── */
function GridLines() {
  return (
    <>
      {Array.from({ length: 11 }, (_, i) => i === 0 ? null : (
        <div key={i} className="absolute left-0 right-0 border-t border-border/50 pointer-events-none z-0" style={{ top: i * HOUR_HEIGHT }} />
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <div key={`h${i}`} className="absolute left-0 right-0 border-t border-border/20 pointer-events-none z-0" style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
      ))}
    </>
  );
}

/* ── Day Column ────────────────────────────────────────── */
interface DayColumnProps {
  location: Location; weekNumber: number; dayOfWeek: number;
  blocks: TimeBlock[];
  selectedBlockId: string | null;
  syncMode: { blockId: string; courseId: string; fromLocation: Location } | null;
  syncPairId: string | null;
  dragState: DragState | null;
  locked: boolean;
  hasActiveCourse: boolean;
  activeSyncGroupId: string | null;
  activeSyncLocation: Location | null;
  colRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onMouseDown: (e: React.MouseEvent, loc: Location, wn: number, d: number) => void;
  onBlockMouseDown: (e: React.MouseEvent, block: TimeBlock) => void;
  onResizeMouseDown: (e: React.MouseEvent, block: TimeBlock, edge: 'top' | 'bottom') => void;
  onSelectBlock: (id: string) => void;
  getCourseColor: (id: string) => string;
  getCourseName: (id: string) => string;
}

function DayColumn({
  location, weekNumber, dayOfWeek, blocks,
  selectedBlockId, syncMode, syncPairId,
  dragState, locked, hasActiveCourse, activeSyncGroupId, activeSyncLocation, colRefs,
  onMouseDown, onBlockMouseDown, onResizeMouseDown, onSelectBlock,
  getCourseColor, getCourseName,
}: DayColumnProps) {
  const key = colKey(location, weekNumber, dayOfWeek);

  /* Cursor-tracking hover popup */
  const [hover, setHover] = useState<{ block: TimeBlock; x: number; y: number } | null>(null);
  const hoverRef = useRef<HTMLDivElement | null>(null);

  const refCallback = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) colRefs.current.set(key, el);
      else colRefs.current.delete(key);
    },
    [colRefs, key]
  );

  const layout = useMemo(() => computeLayout(blocks), [blocks]);

  const dragPreview = useMemo(() => {
    if (!dragState) return null;
    if (dragState.type === 'create') {
      const s = Math.min(dragState.startMin, dragState.currentMin);
      const e = Math.max(dragState.startMin, dragState.currentMin);
      if (e - s < SNAP_MIN) return null;
      return { top: (s - GRID_START) * PX_PER_MIN, height: (e - s) * PX_PER_MIN };
    }
    if (dragState.type === 'move') {
      return { top: (dragState.startMin - GRID_START) * PX_PER_MIN, height: dragState.duration * PX_PER_MIN };
    }
    return null;
  }, [dragState]);

  return (
    <div
      ref={refCallback}
      className={cn('flex-1 relative select-none', dayOfWeek > 0 && 'border-l', !locked && hasActiveCourse && 'cursor-crosshair')}
      style={{ height: GRID_HEIGHT }}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => {
        if (!(e.target as HTMLElement).closest('[data-block]')) {
          onMouseDown(e, location, weekNumber, dayOfWeek);
        }
      }}
    >
      {dragState?.type === 'create' && dragState.dayOfWeek === dayOfWeek && dragPreview && (
        <div className="absolute left-0.5 right-0.5 bg-primary/20 border border-primary/50 rounded-sm pointer-events-none z-20"
          style={{ top: dragPreview.top, height: dragPreview.height }} />
      )}

      {dragState?.type === 'move' && dragState.dayOfWeek === dayOfWeek && dragPreview && (() => {
        const moveColor = getCourseColor(dragState.courseId);
        return (
          <div className="absolute left-0.5 right-0.5 rounded-sm pointer-events-none z-30 opacity-80 shadow-lg"
            style={{ top: dragPreview.top, height: dragPreview.height, backgroundColor: `${moveColor}50`, border: `2px solid ${moveColor}` }} />
        );
      })()}

      {blocks.map(block => {
        const isBeingMoved   = dragState?.type === 'move' && dragState.blockId === block.id;
        const isBeingResized = (dragState?.type === 'resize-top' || dragState?.type === 'resize-bottom') && dragState.blockId === block.id;
        const isDraggedAway  = isBeingMoved && dragState.dayOfWeek !== dayOfWeek;
        const isSelected   = block.id === selectedBlockId;
        const isSyncPair   = block.id === syncPairId;
        const isSyncTarget = syncMode !== null && block.courseId === syncMode.courseId &&
          block.location !== syncMode.fromLocation && !block.syncGroupId;
        const isDimmed     = activeSyncGroupId !== null && activeSyncLocation !== null &&
          block.location !== activeSyncLocation &&
          block.syncGroupId !== activeSyncGroupId;

        const color    = getCourseColor(block.courseId);
        const name     = getCourseName(block.courseId);
        const isTravel = block.courseId === TRAVEL_ID;
        const isSynced = !!block.syncGroupId;
        const showAtTwente = !!block.atTwente && block.location === 'VU' && !isTravel;

        if (isDraggedAway) return null;

        const { leftPct, widthPct } = layout.get(block.id) ?? { leftPct: 0, widthPct: 100 };
        const liveStart = isBeingResized && dragState ? dragState.startMin : isBeingMoved && dragState?.type === 'move' ? dragState.startMin : block.startMinute;
        const liveEnd   = isBeingResized && dragState ? dragState.endMin   : isBeingMoved && dragState?.type === 'move' ? dragState.endMin   : block.endMinute;
        const top    = (liveStart - GRID_START) * PX_PER_MIN;
        const height = (liveEnd - liveStart) * PX_PER_MIN;

        const blockEl = (
          <div
            key={block.id}
            data-block="true"
            className={cn(
              'absolute rounded-sm overflow-hidden z-10 transition-[shadow,opacity]',
              isBeingMoved && 'opacity-80 shadow-lg z-30',
              isSelected && 'ring-2 ring-primary ring-offset-0 z-20',
              isSyncPair && 'ring-2 ring-orange-400 z-20',
              isSyncTarget && 'ring-2 ring-green-500 animate-pulse z-20',
              isTravel && 'opacity-60',
              isDimmed && 'opacity-20',
              !locked && 'cursor-pointer',
            )}
            style={{
              top,
              height: Math.max(height, 12),
              left: `calc(${leftPct}% + 1px)`,
              width: `calc(${widthPct}% - 2px)`,
              backgroundColor: isTravel ? undefined : `${color}${isSelected || isSyncPair ? '50' : '28'}`,
              borderWidth: isSynced ? 3 : 1,
              borderStyle: 'solid',
              borderColor: color,
              backgroundImage: isTravel
                ? `repeating-linear-gradient(45deg, ${TRAVEL_COLOR}22 0px, ${TRAVEL_COLOR}22 4px, ${TRAVEL_COLOR}55 4px, ${TRAVEL_COLOR}55 8px)`
                : undefined,
            }}
            onMouseDown={e => onBlockMouseDown(e, block)}
            onClick={e => {
              e.stopPropagation();
              if (!locked) onSelectBlock(block.id);
            }}
          >
            {/* At Twente inset stripe (10% width) */}
            {showAtTwente && (
              <div
                className="absolute inset-y-0 left-0 pointer-events-none z-10"
                style={{ width: '10%', minWidth: 4, backgroundColor: color, opacity: 0.75 }}
              />
            )}
            <div className="px-0.5 pt-0.5 text-[9px] leading-tight font-semibold truncate" style={{ color, paddingLeft: showAtTwente ? 'calc(10% + 3px)' : undefined }}>
              {isTravel ? '✈' : ''} {name}
            </div>
            {height >= 24 && block.place && (
              <div className="px-0.5 text-[8px] text-muted-foreground truncate leading-tight" style={{ paddingLeft: showAtTwente ? 'calc(10% + 3px)' : undefined }}>
                {block.place}
              </div>
            )}
            {height >= (block.place ? 36 : 24) && (
              <div className="px-0.5 text-[8px] text-muted-foreground truncate leading-tight" style={{ fontVariantNumeric: 'tabular-nums', paddingLeft: showAtTwente ? 'calc(10% + 3px)' : undefined }}>
                {formatTime(liveStart)}
              </div>
            )}
            {isSynced && (
              <div className="absolute top-0.5 right-0.5 pointer-events-none">
                <FiLink2 size={8} className="text-muted-foreground" />
              </div>
            )}
            {block.notes && (
              <div
                className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full pointer-events-none"
                style={{ backgroundColor: color, opacity: 0.8 }}
              />
            )}
            {/* Resize handles — only on selected, unlocked blocks */}
            {isSelected && !locked && (
              <>
                <div
                  className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize z-30"
                  onMouseDown={e => onResizeMouseDown(e, block, 'top')}
                />
                <div
                  className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-30"
                  onMouseDown={e => onResizeMouseDown(e, block, 'bottom')}
                />
              </>
            )}
          </div>
        );

        const hasHoverContent = !!(block.atTwente && block.location === 'VU') || !!block.notes || !!block.place;

        return (
          <div key={block.id}
            onMouseMove={e => { if (!dragState) setHover({ block, x: e.clientX, y: e.clientY }); }}
            onMouseLeave={() => setHover(null)}
          >
            {blockEl}
          </div>
        );
      })}

      {/* Cursor-tracking hover popup – position: fixed escapes overflow clips */}
      {hover && blocks.some(b => b.id === hover.block.id) && (() => {
        const b = hover.block;
        const bName = getCourseName(b.courseId);
        const PAD = 12;
        const POP_W = 180;
        const vpW = window.innerWidth;
        const vpH = window.innerHeight;
        const flipX = hover.x + PAD + POP_W > vpW;
        const flipY = hover.y + PAD + 60 > vpH;
        const x = flipX ? hover.x - PAD : hover.x + PAD;
        const y = flipY ? hover.y - PAD : hover.y + PAD;
        const transform = `${flipX ? 'translateX(-100%)' : ''} ${flipY ? 'translateY(-100%)' : ''}`.trim() || undefined;
        return (
          <div
            ref={hoverRef}
            className="fixed z-[9998] bg-popover text-popover-foreground border rounded-md shadow-md px-2.5 py-1.5 text-xs pointer-events-none"
            style={{ left: x, top: y, maxWidth: POP_W, transform }}
          >
            <p className="font-semibold">{bName}</p>
            {b.syncGroupId && (
              <div className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] font-medium leading-none">
                <FiLink2 size={11} />
                <span>Linked</span>
              </div>
            )}
            {b.place && <p className="text-[10px] text-muted-foreground mt-0.5">{b.place}</p>}
            {b.atTwente && b.location === 'VU' && <p className="text-[10px] text-muted-foreground">At Twente</p>}
            {b.notes && <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{b.notes}</p>}
          </div>
        );
      })()}
    </div>
  );
}

/* ── PDF Export ────────────────────────────────────────── */
function generatePDF(data: AppData, weeks: Week[]) {
  const lines: string[] = [];

  lines.push(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(data.module?.name ?? 'Timetable')}</title><style>`);
  lines.push(`body{font-family:-apple-system,system-ui,sans-serif;font-size:10px;margin:0;padding:16px 24px;color:#111}
h1{font-size:18px;font-weight:700;margin:0 0 20px}
.week{margin-bottom:24px;page-break-inside:avoid;break-inside:avoid}
.wk-hdr{display:flex;align-items:center;gap:8px;padding:5px 10px;background:#f3f4f6;border:1px solid #d1d5db;border-bottom:none;border-radius:4px 4px 0 0;font-size:11px}
.wk-num{font-weight:700}.wk-cw{color:#6b7280}.wk-dates{color:#374151;flex:1;text-align:right}
table{width:100%;border-collapse:collapse;border:1px solid #d1d5db}
th{background:#f9fafb;font-size:9px;font-weight:600;padding:4px 5px;border:1px solid #d1d5db;text-align:left}
td{border:1px solid #e5e7eb;padding:3px 4px;vertical-align:top;min-height:36px}
.loc{font-weight:700;font-size:10px;color:#374151;background:#f9fafb;text-align:center;white-space:nowrap;width:28px}
.blk{display:block;border-radius:3px;padding:2px 4px;margin:1px 0;font-size:8.5px;font-weight:600;box-sizing:border-box;border-left-width:3px;border-left-style:solid}
.blk-time{font-size:8px;font-weight:400;opacity:0.75}
.blk-note{font-size:8px;font-style:italic;opacity:0.8;display:block}
.day-note{font-size:8px;font-style:italic;color:#6b7280;padding:3px 4px;border-top:1px dashed #e5e7eb;margin-top:2px}
@media print{body{padding:8px 16px}@page{margin:15mm}}`);
  lines.push(`</style></head><body>`);
  lines.push(`<h1>${esc(data.module?.name ?? 'Timetable')}</h1>`);

  for (const week of weeks) {
    const cw = getISOWeek(week.startDate);
    const startStr = formatMonthDate(week.startDate);
    const endStr   = formatMonthDate(week.days[4]);

    lines.push(`<div class="week">`);
    lines.push(`<div class="wk-hdr"><span class="wk-num">Week ${week.weekNumber}</span><span class="wk-cw">CW${cw}</span><span class="wk-dates">${startStr} – ${endStr}</span></div>`);
    lines.push(`<table><tr><th></th>`);
    for (let d = 0; d < 5; d++) {
      lines.push(`<th>${DAY_LABELS[d]}<br><span style="font-weight:400;color:#6b7280">${formatMonthDate(week.days[d])}</span></th>`);
    }
    lines.push(`</tr>`);

    for (const loc of ['VU', 'UT'] as Location[]) {
      lines.push(`<tr><td class="loc">${loc}</td>`);
      for (let d = 0; d < 5; d++) {
        const dKey = colKey(loc, week.weekNumber, d);
        const dayNote = data.dayNotes?.[dKey];
        const blocks = data.timeBlocks
          .filter(b => b.location === loc && b.weekNumber === week.weekNumber && b.dayOfWeek === d)
          .sort((a, b) => a.startMinute - b.startMinute);
        lines.push(`<td>`);
        for (const blk of blocks) {
          const color = blk.courseId === TRAVEL_ID ? TRAVEL_COLOR : (data.courses.find(c => c.id === blk.courseId)?.color ?? '#888');
          const name  = blk.courseId === TRAVEL_ID ? TRAVEL_NAME  : (data.courses.find(c => c.id === blk.courseId)?.name  ?? '?');
          const atTag = blk.atTwente && loc === 'VU' ? ' ◀AT' : '';
          lines.push(`<div class="blk" style="background:${color}28;border-left-color:${color};color:${color}">`);
          lines.push(`${esc(name)}${atTag}<br><span class="blk-time">${minutesToTimeStr(blk.startMinute)}–${minutesToTimeStr(blk.endMinute)}</span>`);
          if (blk.notes) lines.push(`<span class="blk-note">${esc(blk.notes)}</span>`);
          lines.push(`</div>`);
        }
        if (dayNote) lines.push(`<div class="day-note">${esc(dayNote)}</div>`);
        lines.push(`</td>`);
      }
      lines.push(`</tr>`);
    }
    lines.push(`</table></div>`);
  }

  lines.push(`</body></html>`);

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(lines.join(''));
  win.document.close();
  setTimeout(() => win.print(), 300);
}

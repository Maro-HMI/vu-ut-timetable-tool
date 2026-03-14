import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useAppData } from '@/lib/storage';
import type { Location, Course, TimeBlock, AppData, Module } from '@/lib/types';
import { TRAVEL_ID, TRAVEL_COLOR, TRAVEL_NAME } from '@/lib/types';
import { deriveWeeks, formatTime, formatMonthDate, DAY_LABELS, type Week } from '@/lib/weeks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  Eye, EyeOff, Lock, Unlock, Plus, Trash2, Settings,
  Download, Upload, Link2, Link2Off, Plane, X, CalendarDays,
} from 'lucide-react';

/* ── Constants ─────────────────────────────────────────── */
const GRID_START  = 480;  // 08:00 in minutes
const GRID_END    = 1080; // 18:00 in minutes
const HOUR_HEIGHT = 30;   // px per hour (half the old 60px)
const PX_PER_MIN  = HOUR_HEIGHT / 60; // 0.5 px/min
const GRID_HEIGHT = (GRID_END - GRID_START) * PX_PER_MIN; // 300px
const SNAP_MIN    = 15;
const LOCATIONS: Location[] = ['VU', 'UT'];
const TIME_AXIS_W = 44; // px

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#6366f1', '#a855f7',
  '#ec4899', '#f43f5e', '#84cc16', '#06b6d4',
];

/* ── Helpers ───────────────────────────────────────────── */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const snap  = (v: number, s: number) => Math.round(v / s) * s;
const uid   = () => crypto.randomUUID();

function minFromClientY(colEl: HTMLElement, clientY: number): number {
  const rect = colEl.getBoundingClientRect();
  const y = clamp(clientY - rect.top, 0, GRID_HEIGHT);
  return clamp(snap(GRID_START + y / PX_PER_MIN, SNAP_MIN), GRID_START, GRID_END);
}

function colKey(location: Location, weekNumber: number, dayOfWeek: number) {
  return `${location}-w${weekNumber}-d${dayOfWeek}`;
}

/** Greedy interval-graph column assignment for overlapping blocks. */
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
  location: Location;
  weekNumber: number;
  dayOfWeek: number;
  startMin: number;
  currentMin: number;
};

type DragMove = {
  type: 'move';
  blockId: string;
  location: Location;
  weekNumber: number;
  dayOfWeek: number;
  startMin: number;
  endMin: number;
  duration: number;
  offsetMin: number;
};

type DragState = DragCreate | DragMove;

/* ── Module Setup / Settings Dialog ───────────────────── */
interface ModuleDialogProps {
  open: boolean;
  initial?: Module | null;
  onSave: (m: Omit<Module, 'id'>) => void;
  onCancel: () => void;
}

function ModuleDialog({ open, initial, onSave, onCancel }: ModuleDialogProps) {
  const [name, setName]         = useState(initial?.name ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [numWeeks, setNumWeeks] = useState(initial?.numWeeks ?? 8);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setStartDate(initial?.startDate ?? '');
      setNumWeeks(initial?.numWeeks ?? 8);
    }
  }, [open, initial]);

  function handleSave() {
    if (!name.trim() || !startDate) return;
    onSave({ name: name.trim(), startDate, numWeeks });
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-sm rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-base">
            {initial ? 'Module Settings' : 'Create Module'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Module Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Design Engineering M4"
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">First Monday</Label>
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="h-8 text-sm"
            />
            <p className="text-[10px] text-muted-foreground">Pick the Monday of week 1.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Number of Weeks</Label>
            <Input
              type="number"
              min={1}
              max={52}
              value={numWeeks}
              onChange={e => setNumWeeks(Number(e.target.value))}
              className="h-8 text-sm"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          {initial && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={!name.trim() || !startDate}>
            {initial ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Color Picker ──────────────────────────────────────── */
interface ColorPickerProps {
  value: string;
  onChange: (c: string) => void;
}
function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-1.5 p-1">
      {PRESET_COLORS.map(c => (
        <button
          key={c}
          className={cn(
            'h-5 w-5 rounded-full border-2 transition-transform hover:scale-110',
            value === c ? 'border-foreground scale-110' : 'border-transparent'
          )}
          style={{ backgroundColor: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

/* ── Main Planner ──────────────────────────────────────── */
export default function Planner() {
  const { data, update, exportToFile, importFromFile } = useAppData();

  /* UI state */
  const [activeCourseId, setActiveCourseId]   = useState<string | null>(null);
  const [hiddenCourseIds, setHiddenCourseIds] = useState<Set<string>>(new Set());
  const [lockedLocations, setLockedLocations] = useState<Set<Location>>(new Set());
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [dragState, setDragState]             = useState<DragState | null>(null);
  const [syncMode, setSyncMode]               = useState<{
    blockId: string; courseId: string; fromLocation: Location;
  } | null>(null);

  /* Inline course editor state */
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [editCourseName, setEditCourseName]   = useState('');
  const [editCourseColor, setEditCourseColor] = useState(PRESET_COLORS[5]);
  const [addingCourse, setAddingCourse]       = useState(false);
  const [newCourseName, setNewCourseName]     = useState('');
  const [newCourseColor, setNewCourseColor]   = useState(PRESET_COLORS[0]);

  /* Module dialogs */
  const [showModuleSetup, setShowModuleSetup]       = useState(!data.module);
  const [showModuleSettings, setShowModuleSettings] = useState(false);

  /* Block detail edit */
  const [editNotes, setEditNotes]   = useState('');
  const [editLocation, setEditLocation] = useState('');

  /* Refs */
  const colRefs        = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragStateRef   = useRef<DragState | null>(null);
  const activeCourseRef = useRef<string | null>(null);
  const dataRef        = useRef<AppData>(data);
  const updateRef      = useRef(update);
  const fileInputRef   = useRef<HTMLInputElement>(null);

  // Keep refs in sync
  useEffect(() => { dragStateRef.current = dragState; },     [dragState]);
  useEffect(() => { activeCourseRef.current = activeCourseId; }, [activeCourseId]);
  useEffect(() => { dataRef.current = data; },               [data]);
  useEffect(() => { updateRef.current = update; },           [update]);

  /* Derived */
  const weeks = useMemo(() => {
    if (!data.module) return [];
    return deriveWeeks(data.module.startDate, data.module.numWeeks);
  }, [data.module]);

  const selectedBlock = useMemo(
    () => data.timeBlocks.find(b => b.id === selectedBlockId) ?? null,
    [data.timeBlocks, selectedBlockId]
  );

  // Populate block detail fields when selection changes
  useEffect(() => {
    if (selectedBlock) {
      setEditNotes(selectedBlock.notes ?? '');
      setEditLocation(selectedBlock.location);
    }
  }, [selectedBlockId]);

  /* Sync pair */
  const syncPairBlock = useMemo(() => {
    if (!selectedBlock?.syncGroupId) return null;
    return data.timeBlocks.find(
      b => b.syncGroupId === selectedBlock.syncGroupId && b.id !== selectedBlock.id
    ) ?? null;
  }, [selectedBlock, data.timeBlocks]);

  /* Document-level drag handlers (registered once, use refs) */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      const key = colKey(ds.location, ds.weekNumber, ds.dayOfWeek);
      const colEl = colRefs.current.get(key);
      if (!colEl) return;
      const min = minFromClientY(colEl, e.clientY);

      setDragState(prev => {
        if (!prev) return null;
        if (prev.type === 'create') {
          return { ...prev, currentMin: min };
        }
        // move
        const newStart = clamp(
          snap(min - prev.offsetMin, SNAP_MIN),
          GRID_START,
          GRID_END - prev.duration
        );
        return { ...prev, startMin: newStart, endMin: newStart + prev.duration };
      });
    };

    const onUp = () => {
      const ds = dragStateRef.current;
      if (!ds) return;

      if (ds.type === 'create') {
        const startMin = Math.min(ds.startMin, ds.currentMin);
        const endMin   = Math.max(ds.startMin, ds.currentMin);
        if (endMin - startMin >= SNAP_MIN) {
          const courseId = activeCourseRef.current;
          if (courseId) {
            const tblocks = dataRef.current.timeBlocks;
            // Travel blocks block any overlap (including other travel)
            const blocked = tblocks.some(
              b =>
                b.courseId === TRAVEL_ID &&
                b.location  === ds.location &&
                b.weekNumber === ds.weekNumber &&
                b.dayOfWeek  === ds.dayOfWeek &&
                b.startMinute < endMin &&
                b.endMinute   > startMin
            );
            if (!blocked || courseId === TRAVEL_ID) {
              const newBlock: TimeBlock = {
                id: uid(), courseId,
                location: ds.location,
                weekNumber: ds.weekNumber,
                dayOfWeek: ds.dayOfWeek,
                startMinute: startMin, endMinute: endMin,
              };
              updateRef.current(prev => ({
                ...prev, timeBlocks: [...prev.timeBlocks, newBlock],
              }));
            }
          }
        }
      } else {
        // move: commit new position
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
  }, []); // intentionally empty – everything via refs

  /* ── Actions ── */
  const deleteBlock = useCallback((id: string) => {
    update(prev => {
      const block = prev.timeBlocks.find(b => b.id === id);
      let blocks = prev.timeBlocks.filter(b => b.id !== id);
      // If synced, remove sync from pair
      if (block?.syncGroupId) {
        blocks = blocks.map(b =>
          b.syncGroupId === block.syncGroupId ? { ...b, syncGroupId: undefined } : b
        );
      }
      return { ...prev, timeBlocks: blocks };
    });
    if (selectedBlockId === id) setSelectedBlockId(null);
  }, [update, selectedBlockId]);

  const saveBlockNotes = useCallback(() => {
    if (!selectedBlock) return;
    update(prev => ({
      ...prev,
      timeBlocks: prev.timeBlocks.map(b =>
        b.id === selectedBlock.id ? { ...b, notes: editNotes || undefined } : b
      ),
    }));
  }, [update, selectedBlock, editNotes]);

  const linkBlocks = useCallback((targetId: string) => {
    if (!syncMode) return;
    const groupId = uid();
    update(prev => ({
      ...prev,
      timeBlocks: prev.timeBlocks.map(b =>
        b.id === syncMode.blockId || b.id === targetId
          ? { ...b, syncGroupId: groupId }
          : b
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
      module: prev.module
        ? { ...prev.module, ...fields }
        : { id: uid(), ...fields },
    }));
    setShowModuleSetup(false);
    setShowModuleSettings(false);
  }, [update]);

  const handleAddCourse = useCallback(() => {
    if (!newCourseName.trim()) return;
    const course: Course = { id: uid(), name: newCourseName.trim(), color: newCourseColor };
    update(prev => ({ ...prev, courses: [...prev.courses, course] }));
    setNewCourseName('');
    setNewCourseColor(PRESET_COLORS[0]);
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

  const handleImport = useCallback(() => fileInputRef.current?.click(), []);

  /* ── Course color helper ── */
  function getCourseColor(courseId: string): string {
    if (courseId === TRAVEL_ID) return TRAVEL_COLOR;
    return data.courses.find(c => c.id === courseId)?.color ?? '#888';
  }
  function getCourseName(courseId: string): string {
    if (courseId === TRAVEL_ID) return TRAVEL_NAME;
    return data.courses.find(c => c.id === courseId)?.name ?? '?';
  }

  /* ── Per-day block getter ── */
  const getBlocks = useCallback(
    (location: Location, weekNumber: number, dayOfWeek: number): TimeBlock[] =>
      data.timeBlocks.filter(
        b =>
          b.location === location &&
          b.weekNumber === weekNumber &&
          b.dayOfWeek === dayOfWeek &&
          !hiddenCourseIds.has(b.courseId)
      ),
    [data.timeBlocks, hiddenCourseIds]
  );

  /* ── Drag start handlers ── */
  const handleColumnMouseDown = useCallback(
    (e: React.MouseEvent, location: Location, weekNumber: number, dayOfWeek: number) => {
      if (e.button !== 0) return;
      if (lockedLocations.has(location)) return;
      if (!activeCourseRef.current) return;
      const key = colKey(location, weekNumber, dayOfWeek);
      const colEl = colRefs.current.get(key);
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
      // In sync mode, clicking a block should link it
      if (syncMode) {
        if (
          block.courseId === syncMode.courseId &&
          block.location !== syncMode.fromLocation &&
          block.id !== syncMode.blockId
        ) {
          linkBlocks(block.id);
        } else {
          setSyncMode(null);
        }
        return;
      }
      // Select
      setSelectedBlockId(block.id);
      const key = colKey(block.location, block.weekNumber, block.dayOfWeek);
      const colEl = colRefs.current.get(key);
      if (!colEl) return;
      const clickMin = minFromClientY(colEl, e.clientY);
      const offsetMin = clickMin - block.startMinute;
      setDragState({
        type: 'move',
        blockId: block.id,
        location: block.location,
        weekNumber: block.weekNumber,
        dayOfWeek: block.dayOfWeek,
        startMin: block.startMinute,
        endMin: block.endMinute,
        duration: block.endMinute - block.startMinute,
        offsetMin,
      });
    },
    [lockedLocations, syncMode, linkBlocks]
  );

  /* ── Render ── */
  if (!data.module) {
    return (
      <>
        <div className="flex items-center justify-center h-screen bg-background">
          <div className="text-center space-y-3">
            <CalendarDays className="h-12 w-12 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No module configured yet.</p>
            <Button size="sm" onClick={() => setShowModuleSetup(true)}>Create Module</Button>
          </div>
        </div>
        <ModuleDialog
          open={showModuleSetup}
          onSave={handleModuleSave}
          onCancel={() => setShowModuleSetup(false)}
        />
      </>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* ── Left Panel ─────────────────────────────────── */}
      <div className="w-[268px] flex-shrink-0 border-r flex flex-col overflow-hidden bg-card">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0">
          <CalendarDays className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-semibold truncate flex-1">{data.module.name}</span>
          <button
            title="Module settings"
            onClick={() => setShowModuleSettings(true)}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            title="Save to file"
            onClick={() => exportToFile(data)}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            title="Load from file"
            onClick={handleImport}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={async e => {
              const f = e.target.files?.[0];
              if (f) { await importFromFile(f); e.target.value = ''; }
            }}
          />
        </div>

        {/* Course list */}
        <div className="flex-shrink-0 overflow-y-auto px-2 pt-2 pb-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">
            Courses
          </p>

          {/* Travel (special) */}
          <CourseItem
            id={TRAVEL_ID}
            name={TRAVEL_NAME}
            color={TRAVEL_COLOR}
            isTravel
            isActive={activeCourseId === TRAVEL_ID}
            isHidden={hiddenCourseIds.has(TRAVEL_ID)}
            onActivate={() => setActiveCourseId(prev => prev === TRAVEL_ID ? null : TRAVEL_ID)}
            onToggleVisibility={() => toggleVisibility(TRAVEL_ID)}
          />

          {/* User courses */}
          {data.courses.map(course => (
            editingCourseId === course.id ? (
              <div key={course.id} className="mb-1 border rounded-md p-2 bg-background space-y-2">
                <Input
                  value={editCourseName}
                  onChange={e => setEditCourseName(e.target.value)}
                  className="h-7 text-xs"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveCourseEdit();
                    if (e.key === 'Escape') setEditingCourseId(null);
                  }}
                />
                <ColorPicker value={editCourseColor} onChange={setEditCourseColor} />
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-6 text-[10px] flex-1" onClick={handleSaveCourseEdit}>Save</Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => setEditingCourseId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <CourseItem
                key={course.id}
                id={course.id}
                name={course.name}
                color={course.color}
                isActive={activeCourseId === course.id}
                isHidden={hiddenCourseIds.has(course.id)}
                onActivate={() => setActiveCourseId(prev => prev === course.id ? null : course.id)}
                onToggleVisibility={() => toggleVisibility(course.id)}
                onEdit={() => {
                  setEditingCourseId(course.id);
                  setEditCourseName(course.name);
                  setEditCourseColor(course.color);
                }}
                onDelete={() => handleDeleteCourse(course.id)}
              />
            )
          ))}

          {/* Add course inline */}
          {addingCourse ? (
            <div className="mb-1 border rounded-md p-2 bg-background space-y-2">
              <Input
                value={newCourseName}
                onChange={e => setNewCourseName(e.target.value)}
                placeholder="Course name"
                className="h-7 text-xs"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddCourse();
                  if (e.key === 'Escape') { setAddingCourse(false); setNewCourseName(''); }
                }}
              />
              <ColorPicker value={newCourseColor} onChange={setNewCourseColor} />
              <div className="flex gap-1.5">
                <Button size="sm" className="h-6 text-[10px] flex-1" onClick={handleAddCourse} disabled={!newCourseName.trim()}>
                  Add
                </Button>
                <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => { setAddingCourse(false); setNewCourseName(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingCourse(true)}
              className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors mt-0.5"
            >
              <Plus className="h-3 w-3" />
              Add Course
            </button>
          )}

          {!activeCourseId && (
            <p className="text-[10px] text-muted-foreground mt-2 px-1 italic">
              Click a course to activate it, then drag on the calendar to add entries.
            </p>
          )}
          {activeCourseId && (
            <p className="text-[10px] px-1 mt-2 italic" style={{ color: getCourseColor(activeCourseId) }}>
              Active: {getCourseName(activeCourseId)} — drag to create entries
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="border-t mx-2 my-1 flex-shrink-0" />

        {/* Block details — always visible when a block is selected */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {selectedBlock ? (
            <BlockDetails
              block={selectedBlock}
              courseColor={getCourseColor(selectedBlock.courseId)}
              courseName={getCourseName(selectedBlock.courseId)}
              syncPair={syncPairBlock}
              syncMode={syncMode?.blockId === selectedBlock.id}
              editNotes={editNotes}
              onEditNotes={setEditNotes}
              onSaveNotes={saveBlockNotes}
              onDelete={() => deleteBlock(selectedBlock.id)}
              onStartSync={() =>
                setSyncMode({
                  blockId: selectedBlock.id,
                  courseId: selectedBlock.courseId,
                  fromLocation: selectedBlock.location,
                })
              }
              onCancelSync={() => setSyncMode(null)}
              onUnlink={() => unlinkBlock(selectedBlock.id)}
              getSyncPartnerName={() =>
                syncPairBlock
                  ? `${syncPairBlock.location} W${syncPairBlock.weekNumber} ${DAY_LABELS[syncPairBlock.dayOfWeek]}`
                  : ''
              }
            />
          ) : (
            <p className="text-[10px] text-muted-foreground text-center py-4 italic">
              Click a calendar entry to see its details.
            </p>
          )}
        </div>
      </div>

      {/* ── Calendar Area ─────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Location header (fixed, not scrollable) */}
        <div className="flex-shrink-0 border-b bg-card z-30 flex">
          {/* time axis spacer */}
          <div style={{ width: TIME_AXIS_W }} className="flex-shrink-0 border-r" />
          {LOCATIONS.map((loc, li) => {
            const locked = lockedLocations.has(loc);
            return (
              <div
                key={loc}
                className={cn(
                  'flex-1 flex items-center gap-2 px-3 h-9',
                  li < LOCATIONS.length - 1 && 'border-r'
                )}
              >
                <span className="text-xs font-bold tracking-wider">{loc}</span>
                <button
                  title={locked ? 'Unlock location' : 'Lock location (no edits)'}
                  onClick={() => toggleLock(loc)}
                  className={cn(
                    'p-0.5 rounded transition-colors',
                    locked ? 'text-amber-600 hover:text-amber-700' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                </button>
                {locked && (
                  <span className="text-[10px] text-amber-600 font-medium">locked</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Scrollable weeks */}
        <div
          className="flex-1 overflow-y-auto overflow-x-auto"
          onMouseLeave={() => {
            // cancel create drags on mouse leave if needed
          }}
        >
          <div className="min-w-[640px]">
            {weeks.map(week => (
              <WeekSection
                key={week.weekNumber}
                week={week}
                getBlocks={getBlocks}
                selectedBlockId={selectedBlockId}
                syncMode={syncMode}
                syncPairId={syncPairBlock?.id ?? null}
                dragState={dragState}
                lockedLocations={lockedLocations}
                colRefs={colRefs}
                onColumnMouseDown={handleColumnMouseDown}
                onBlockMouseDown={handleBlockMouseDown}
                onSelectBlock={setSelectedBlockId}
                getCourseColor={getCourseColor}
                getCourseName={getCourseName}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Sync mode overlay banner */}
      {syncMode && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-primary text-primary-foreground text-xs px-4 py-2 rounded-full shadow-lg"
        >
          <Link2 className="h-3.5 w-3.5" />
          Click a <strong>{syncMode.fromLocation === 'VU' ? 'UT' : 'VU'}</strong> block of the same course to link it
          <button
            onClick={() => setSyncMode(null)}
            className="ml-1 hover:opacity-80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Module dialogs */}
      <ModuleDialog
        open={showModuleSetup}
        onSave={handleModuleSave}
        onCancel={() => setShowModuleSetup(false)}
      />
      <ModuleDialog
        open={showModuleSettings}
        initial={data.module}
        onSave={handleModuleSave}
        onCancel={() => setShowModuleSettings(false)}
      />
    </div>
  );
}

/* ── Course Item ───────────────────────────────────────── */
interface CourseItemProps {
  id: string;
  name: string;
  color: string;
  isTravel?: boolean;
  isActive: boolean;
  isHidden: boolean;
  onActivate: () => void;
  onToggleVisibility: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function CourseItem({
  id, name, color, isTravel, isActive, isHidden,
  onActivate, onToggleVisibility, onEdit, onDelete,
}: CourseItemProps) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 px-2 py-1 rounded-md mb-0.5 cursor-pointer transition-colors select-none',
        isActive ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/40'
      )}
      onClick={onActivate}
    >
      {isTravel ? (
        <Plane className="h-3 w-3 flex-shrink-0" style={{ color }} />
      ) : (
        <div
          className="h-3 w-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className={cn(
          'flex-1 text-xs truncate',
          isHidden && 'opacity-40 line-through',
          isActive && 'font-medium'
        )}
        onDoubleClick={e => { e.stopPropagation(); onEdit?.(); }}
      >
        {name}
      </span>
      <button
        onClick={e => { e.stopPropagation(); onToggleVisibility(); }}
        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5 rounded transition-opacity"
        title={isHidden ? 'Show entries' : 'Hide entries'}
      >
        {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      {onEdit && (
        <button
          onClick={e => { e.stopPropagation(); onEdit(); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground p-0.5 rounded transition-opacity text-[10px]"
          title="Edit"
        >
          ✎
        </button>
      )}
      {onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-0.5 rounded transition-opacity"
          title="Delete course"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

/* ── Block Details Panel ───────────────────────────────── */
interface BlockDetailsProps {
  block: TimeBlock;
  courseColor: string;
  courseName: string;
  syncPair: TimeBlock | null;
  syncMode: boolean;
  editNotes: string;
  onEditNotes: (v: string) => void;
  onSaveNotes: () => void;
  onDelete: () => void;
  onStartSync: () => void;
  onCancelSync: () => void;
  onUnlink: () => void;
  getSyncPartnerName: () => string;
}

function BlockDetails({
  block, courseColor, courseName, syncPair, syncMode,
  editNotes, onEditNotes, onSaveNotes, onDelete,
  onStartSync, onCancelSync, onUnlink, getSyncPartnerName,
}: BlockDetailsProps) {
  const canSync = block.courseId !== TRAVEL_ID;

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: courseColor }} />
        <span className="text-xs font-semibold truncate">{courseName}</span>
      </div>

      <div className="text-[10px] text-muted-foreground space-y-0.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <div className="flex gap-2">
          <span className="font-medium text-foreground">{block.location}</span>
          <span>Week {block.weekNumber}</span>
          <span>{DAY_LABELS[block.dayOfWeek]}</span>
        </div>
        <div>{formatTime(block.startMinute)} – {formatTime(block.endMinute)}</div>
      </div>

      {/* Notes */}
      <div className="space-y-1">
        <Label className="text-[10px]">Notes</Label>
        <Textarea
          value={editNotes}
          onChange={e => onEditNotes(e.target.value)}
          onBlur={onSaveNotes}
          placeholder="Add notes…"
          className="text-xs min-h-[52px] resize-none"
          rows={2}
        />
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
              <button
                onClick={onUnlink}
                className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors"
                title="Remove link"
              >
                <Link2Off className="h-3 w-3" />
              </button>
            </div>
          ) : syncMode ? (
            <button
              onClick={onCancelSync}
              className="text-[10px] text-primary flex items-center gap-1 animate-pulse"
            >
              <X className="h-3 w-3" /> Cancel — waiting for click…
            </button>
          ) : (
            <button
              onClick={onStartSync}
              className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1.5 transition-colors"
            >
              <Link2 className="h-3 w-3" />
              Link to {block.location === 'VU' ? 'UT' : 'VU'} block
            </button>
          )}
        </div>
      )}

      {/* Delete */}
      <Button
        variant="destructive"
        size="sm"
        className="w-full h-7 text-[10px] mt-1"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3 mr-1" />
        Delete entry
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
  onColumnMouseDown: (e: React.MouseEvent, loc: Location, wn: number, d: number) => void;
  onBlockMouseDown: (e: React.MouseEvent, block: TimeBlock) => void;
  onSelectBlock: (id: string) => void;
  getCourseColor: (id: string) => string;
  getCourseName: (id: string) => string;
}

function WeekSection({
  week, getBlocks, selectedBlockId, syncMode, syncPairId,
  dragState, lockedLocations, colRefs,
  onColumnMouseDown, onBlockMouseDown, onSelectBlock,
  getCourseColor, getCourseName,
}: WeekSectionProps) {
  return (
    <div className="border-b">
      {/* Sticky week header */}
      <div className="sticky top-0 z-20 flex border-b bg-white">
        {/* Week label in time axis slot */}
        <div
          style={{ width: TIME_AXIS_W, minWidth: TIME_AXIS_W }}
          className="flex-shrink-0 border-r flex flex-col items-center justify-center py-0.5"
        >
          <span className="text-[10px] font-bold leading-none" style={{ fontVariantNumeric: 'tabular-nums' }}>
            W{week.weekNumber}
          </span>
        </div>
        {/* VU day headers */}
        <div className="flex-1 flex border-r">
          {week.days.map((day, di) => (
            <div key={di} className={cn('flex-1 text-center py-1', di > 0 && 'border-l')}>
              <div className="text-[9px] text-muted-foreground font-medium">{DAY_LABELS[di]}</div>
              <div className="text-[9px] text-muted-foreground">{formatMonthDate(day)}</div>
            </div>
          ))}
        </div>
        {/* UT day headers */}
        <div className="flex-1 flex">
          {week.days.map((day, di) => (
            <div key={di} className={cn('flex-1 text-center py-1', di > 0 && 'border-l')}>
              <div className="text-[9px] text-muted-foreground font-medium">{DAY_LABELS[di]}</div>
              <div className="text-[9px] text-muted-foreground">{formatMonthDate(day)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Time grid */}
      <div className="flex">
        {/* Time axis */}
        <div
          style={{ width: TIME_AXIS_W, minWidth: TIME_AXIS_W, height: GRID_HEIGHT }}
          className="flex-shrink-0 border-r relative overflow-visible"
        >
          {Array.from({ length: 11 }, (_, i) => {
            const hour = 8 + i;
            return (
              <div
                key={hour}
                className="absolute right-1 text-[9px] text-muted-foreground leading-none"
                style={{ top: i * HOUR_HEIGHT, fontVariantNumeric: 'tabular-nums' }}
              >
                {hour}:00
              </div>
            );
          })}
        </div>

        {/* VU columns */}
        <div className="flex-1 flex border-r relative">
          {/* Horizontal gridlines */}
          <GridLines />
          {Array.from({ length: 5 }, (_, di) => (
            <DayColumn
              key={di}
              location="VU"
              weekNumber={week.weekNumber}
              dayOfWeek={di}
              blocks={getBlocks('VU', week.weekNumber, di)}
              selectedBlockId={selectedBlockId}
              syncMode={syncMode}
              syncPairId={syncPairId}
              dragState={
                dragState?.location === 'VU' &&
                dragState?.weekNumber === week.weekNumber &&
                dragState?.dayOfWeek === di
                  ? dragState : null
              }
              locked={lockedLocations.has('VU')}
              colRefs={colRefs}
              onMouseDown={onColumnMouseDown}
              onBlockMouseDown={onBlockMouseDown}
              onSelectBlock={onSelectBlock}
              getCourseColor={getCourseColor}
              getCourseName={getCourseName}
            />
          ))}
        </div>

        {/* UT columns */}
        <div className="flex-1 flex relative">
          <GridLines />
          {Array.from({ length: 5 }, (_, di) => (
            <DayColumn
              key={di}
              location="UT"
              weekNumber={week.weekNumber}
              dayOfWeek={di}
              blocks={getBlocks('UT', week.weekNumber, di)}
              selectedBlockId={selectedBlockId}
              syncMode={syncMode}
              syncPairId={syncPairId}
              dragState={
                dragState?.location === 'UT' &&
                dragState?.weekNumber === week.weekNumber &&
                dragState?.dayOfWeek === di
                  ? dragState : null
              }
              locked={lockedLocations.has('UT')}
              colRefs={colRefs}
              onMouseDown={onColumnMouseDown}
              onBlockMouseDown={onBlockMouseDown}
              onSelectBlock={onSelectBlock}
              getCourseColor={getCourseColor}
              getCourseName={getCourseName}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Grid Lines ────────────────────────────────────────── */
function GridLines() {
  return (
    <>
      {Array.from({ length: 11 }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 right-0 border-t border-border/50 pointer-events-none z-0"
          style={{ top: i * HOUR_HEIGHT }}
        />
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <div
          key={`h${i}`}
          className="absolute left-0 right-0 border-t border-border/20 pointer-events-none z-0"
          style={{ top: i * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
        />
      ))}
    </>
  );
}

/* ── Day Column ────────────────────────────────────────── */
interface DayColumnProps {
  location: Location;
  weekNumber: number;
  dayOfWeek: number;
  blocks: TimeBlock[];
  selectedBlockId: string | null;
  syncMode: { blockId: string; courseId: string; fromLocation: Location } | null;
  syncPairId: string | null;
  dragState: DragState | null;
  locked: boolean;
  colRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  onMouseDown: (e: React.MouseEvent, loc: Location, wn: number, d: number) => void;
  onBlockMouseDown: (e: React.MouseEvent, block: TimeBlock) => void;
  onSelectBlock: (id: string) => void;
  getCourseColor: (id: string) => string;
  getCourseName: (id: string) => string;
}

function DayColumn({
  location, weekNumber, dayOfWeek, blocks,
  selectedBlockId, syncMode, syncPairId,
  dragState, locked, colRefs,
  onMouseDown, onBlockMouseDown, onSelectBlock,
  getCourseColor, getCourseName,
}: DayColumnProps) {
  const key = colKey(location, weekNumber, dayOfWeek);

  const refCallback = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) colRefs.current.set(key, el);
      else colRefs.current.delete(key);
    },
    [colRefs, key]
  );

  /* Layout for overlapping blocks */
  const layout = useMemo(() => computeLayout(blocks), [blocks]);

  /* Drag preview */
  const dragPreview = useMemo(() => {
    if (!dragState) return null;
    if (dragState.type === 'create') {
      const s = Math.min(dragState.startMin, dragState.currentMin);
      const e = Math.max(dragState.startMin, dragState.currentMin);
      if (e - s < SNAP_MIN) return null;
      return {
        top: (s - GRID_START) * PX_PER_MIN,
        height: (e - s) * PX_PER_MIN,
        isPreview: true,
      };
    }
    if (dragState.type === 'move') {
      return {
        top: (dragState.startMin - GRID_START) * PX_PER_MIN,
        height: dragState.duration * PX_PER_MIN,
        isPreview: false,
      };
    }
    return null;
  }, [dragState]);

  return (
    <div
      ref={refCallback}
      className={cn(
        'flex-1 relative border-l select-none',
        !locked && 'cursor-crosshair'
      )}
      style={{ height: GRID_HEIGHT }}
      onMouseDown={e => {
        const target = e.target as HTMLElement;
        if (!target.closest('[data-block]')) {
          onMouseDown(e, location, weekNumber, dayOfWeek);
        }
      }}
    >
      {/* Drag create preview */}
      {dragState?.type === 'create' && dragPreview && (
        <div
          className="absolute left-0.5 right-0.5 bg-primary/20 border border-primary/50 rounded-sm pointer-events-none z-20"
          style={{ top: dragPreview.top, height: dragPreview.height }}
        />
      )}

      {/* Time blocks */}
      {blocks.map(block => {
        const isBeingMoved = dragState?.type === 'move' && dragState.blockId === block.id;
        const isSelected   = block.id === selectedBlockId;
        const isSyncPair   = block.id === syncPairId;
        const isSyncTarget =
          syncMode !== null &&
          block.courseId === syncMode.courseId &&
          block.location !== syncMode.fromLocation &&
          !block.syncGroupId;

        const color    = getCourseColor(block.courseId);
        const name     = getCourseName(block.courseId);
        const isTravel = block.courseId === TRAVEL_ID;

        const { leftPct, widthPct } = layout.get(block.id) ?? { leftPct: 0, widthPct: 100 };

        /* Position: use drag state if being moved */
        const top    = isBeingMoved && dragState?.type === 'move'
          ? (dragState.startMin - GRID_START) * PX_PER_MIN
          : (block.startMinute - GRID_START) * PX_PER_MIN;
        const height = (block.endMinute - block.startMinute) * PX_PER_MIN;

        return (
          <div
            key={block.id}
            data-block="true"
            className={cn(
              'absolute rounded-sm overflow-hidden z-10 transition-shadow',
              isBeingMoved && 'opacity-80 shadow-lg z-30',
              isSelected && 'ring-2 ring-primary ring-offset-0 z-20',
              isSyncPair && 'ring-2 ring-orange-400 z-20',
              isSyncTarget && 'ring-2 ring-green-500 animate-pulse z-20',
              isTravel && 'pointer-events-none opacity-60',
              !isTravel && 'cursor-pointer',
              !isTravel && block.syncGroupId && 'border-dashed',
            )}
            style={{
              top,
              height: Math.max(height, 12),
              left: `calc(${leftPct}% + 1px)`,
              width: `calc(${widthPct}% - 2px)`,
              backgroundColor: isTravel
                ? undefined
                : `${color}${isSelected || isSyncPair ? '50' : '28'}`,
              borderWidth: 1,
              borderStyle: block.syncGroupId ? 'dashed' : 'solid',
              borderColor: color,
              backgroundImage: isTravel
                ? `repeating-linear-gradient(45deg, ${TRAVEL_COLOR}22 0px, ${TRAVEL_COLOR}22 4px, ${TRAVEL_COLOR}55 4px, ${TRAVEL_COLOR}55 8px)`
                : undefined,
            }}
            onMouseDown={e => {
              if (!isTravel) onBlockMouseDown(e, block);
            }}
            onClick={e => {
              e.stopPropagation();
              if (!isTravel) onSelectBlock(block.id);
            }}
          >
            <div
              className="px-0.5 pt-0.5 text-[9px] leading-tight font-semibold truncate"
              style={{ color }}
            >
              {isTravel ? '✈' : ''} {name}
            </div>
            {height >= 24 && (
              <div className="px-0.5 text-[8px] text-muted-foreground truncate leading-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatTime(block.startMinute)}
              </div>
            )}
            {block.syncGroupId && (
              <div className="absolute top-0.5 right-0.5 pointer-events-none">
                <Link2 className="h-2 w-2 text-muted-foreground" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

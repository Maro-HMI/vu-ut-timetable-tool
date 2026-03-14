import {
  type Module, type InsertModule,
  type Course, type InsertCourse,
  type ActivityType, type InsertActivityType,
  type TimeBlock, type InsertTimeBlock,
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Modules
  getModules(): Promise<Module[]>;
  getModule(id: string): Promise<Module | undefined>;
  createModule(m: InsertModule): Promise<Module>;
  updateModule(id: string, m: Partial<InsertModule>): Promise<Module | undefined>;
  deleteModule(id: string): Promise<boolean>;

  // Courses
  getCoursesByModule(moduleId: string): Promise<Course[]>;
  getCourse(id: string): Promise<Course | undefined>;
  createCourse(c: InsertCourse): Promise<Course>;
  updateCourse(id: string, c: Partial<InsertCourse>): Promise<Course | undefined>;
  deleteCourse(id: string): Promise<boolean>;

  // Activity Types
  getActivityTypes(moduleId?: string): Promise<ActivityType[]>;
  createActivityType(a: InsertActivityType): Promise<ActivityType>;
  updateActivityType(id: string, a: Partial<InsertActivityType>): Promise<ActivityType | undefined>;
  deleteActivityType(id: string): Promise<boolean>;

  // Time Blocks
  getTimeBlocksByModule(moduleId: string): Promise<TimeBlock[]>;
  getTimeBlock(id: string): Promise<TimeBlock | undefined>;
  createTimeBlock(t: InsertTimeBlock): Promise<TimeBlock>;
  updateTimeBlock(id: string, t: Partial<InsertTimeBlock>): Promise<TimeBlock | undefined>;
  deleteTimeBlock(id: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private modules: Map<string, Module> = new Map();
  private courses: Map<string, Course> = new Map();
  private activityTypes: Map<string, ActivityType> = new Map();
  private timeBlocks: Map<string, TimeBlock> = new Map();

  constructor() {
    // Seed default activity types
    const defaults = [
      { label: "Lecture", abbreviation: "LEC", colorOverlay: null, moduleId: null },
      { label: "Lab", abbreviation: "LAB", colorOverlay: null, moduleId: null },
      { label: "Tutorial", abbreviation: "TUT", colorOverlay: null, moduleId: null },
      { label: "Exam", abbreviation: "EXAM", colorOverlay: null, moduleId: null },
      { label: "Project", abbreviation: "PROJ", colorOverlay: null, moduleId: null },
      { label: "Self-study", abbreviation: "SELF", colorOverlay: null, moduleId: null },
    ];
    for (const d of defaults) {
      const id = randomUUID();
      this.activityTypes.set(id, { ...d, id });
    }
  }

  // ── Modules ───────────────
  async getModules() { return Array.from(this.modules.values()); }
  async getModule(id: string) { return this.modules.get(id); }
  async createModule(m: InsertModule) {
    const id = randomUUID();
    const mod: Module = { ...m, id, locations: m.locations ?? [] };
    this.modules.set(id, mod);
    return mod;
  }
  async updateModule(id: string, m: Partial<InsertModule>) {
    const existing = this.modules.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...m };
    this.modules.set(id, updated);
    return updated;
  }
  async deleteModule(id: string) {
    // Cascade: delete courses and time blocks
    for (const [bid, b] of this.timeBlocks) { if (b.moduleId === id) this.timeBlocks.delete(bid); }
    for (const [cid, c] of this.courses) { if (c.moduleId === id) this.courses.delete(cid); }
    return this.modules.delete(id);
  }

  // ── Courses ───────────────
  async getCoursesByModule(moduleId: string) {
    return Array.from(this.courses.values()).filter(c => c.moduleId === moduleId);
  }
  async getCourse(id: string) { return this.courses.get(id); }
  async createCourse(c: InsertCourse) {
    const id = randomUUID();
    const course: Course = { ...c, id, locations: c.locations ?? [], teachers: c.teachers ?? null, targetHoursPerLocation: c.targetHoursPerLocation ?? null };
    this.courses.set(id, course);
    return course;
  }
  async updateCourse(id: string, c: Partial<InsertCourse>) {
    const existing = this.courses.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...c };
    this.courses.set(id, updated);
    return updated;
  }
  async deleteCourse(id: string) {
    // Cascade: delete time blocks for this course
    for (const [bid, b] of this.timeBlocks) { if (b.courseId === id) this.timeBlocks.delete(bid); }
    return this.courses.delete(id);
  }

  // ── Activity Types ────────
  async getActivityTypes(moduleId?: string) {
    return Array.from(this.activityTypes.values()).filter(a => a.moduleId === null || a.moduleId === moduleId);
  }
  async createActivityType(a: InsertActivityType) {
    const id = randomUUID();
    const at: ActivityType = { ...a, id, moduleId: a.moduleId ?? null, colorOverlay: a.colorOverlay ?? null };
    this.activityTypes.set(id, at);
    return at;
  }
  async updateActivityType(id: string, a: Partial<InsertActivityType>) {
    const existing = this.activityTypes.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...a };
    this.activityTypes.set(id, updated);
    return updated;
  }
  async deleteActivityType(id: string) { return this.activityTypes.delete(id); }

  // ── Time Blocks ───────────
  async getTimeBlocksByModule(moduleId: string) {
    return Array.from(this.timeBlocks.values()).filter(t => t.moduleId === moduleId);
  }
  async getTimeBlock(id: string) { return this.timeBlocks.get(id); }
  async createTimeBlock(t: InsertTimeBlock) {
    const id = randomUUID();
    const tb: TimeBlock = {
      ...t, id,
      activityTypeId: t.activityTypeId ?? null,
      room: t.room ?? null,
      title: t.title ?? null,
      notes: t.notes ?? null,
      syncGroupId: t.syncGroupId ?? null,
    };
    this.timeBlocks.set(id, tb);
    return tb;
  }
  async updateTimeBlock(id: string, t: Partial<InsertTimeBlock>) {
    const existing = this.timeBlocks.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...t };
    this.timeBlocks.set(id, updated);
    return updated;
  }
  async deleteTimeBlock(id: string) { return this.timeBlocks.delete(id); }
}

export const storage = new MemStorage();

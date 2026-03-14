import { pgTable, text, varchar, integer, boolean, time } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

// ── Module ────────────────────────────────────────────
export const modules = pgTable("modules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  academicYear: text("academic_year").notNull(),
  locations: text("locations").array().notNull(), // e.g. ["UT","VU"]
  startDate: text("start_date").notNull(), // ISO date string
  endDate: text("end_date").notNull(),
});

export const insertModuleSchema = createInsertSchema(modules).omit({ id: true });
export type InsertModule = z.infer<typeof insertModuleSchema>;
export type Module = typeof modules.$inferSelect;

// ── Course ────────────────────────────────────────────
export const courses = pgTable("courses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  moduleId: varchar("module_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(), // hex color
  locations: text("locations").array().notNull(),
  teachers: text("teachers"),
  targetHoursPerLocation: text("target_hours_per_location"), // JSON string: {"UT":30,"VU":28}
});

export const insertCourseSchema = createInsertSchema(courses).omit({ id: true });
export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type Course = typeof courses.$inferSelect;

// ── Activity Type ─────────────────────────────────────
export const activityTypes = pgTable("activity_types", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  moduleId: varchar("module_id"), // null = global
  label: text("label").notNull(),
  abbreviation: text("abbreviation").notNull(),
  colorOverlay: text("color_overlay"), // optional CSS class or pattern
});

export const insertActivityTypeSchema = createInsertSchema(activityTypes).omit({ id: true });
export type InsertActivityType = z.infer<typeof insertActivityTypeSchema>;
export type ActivityType = typeof activityTypes.$inferSelect;

// ── Time Block ────────────────────────────────────────
export const timeBlocks = pgTable("time_blocks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  courseId: varchar("course_id").notNull(),
  moduleId: varchar("module_id").notNull(),
  location: text("location").notNull(),
  weekNumber: integer("week_number").notNull(),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Mon, 1=Tue, ...4=Fri
  startMinute: integer("start_minute").notNull(), // minutes from midnight, e.g. 540 = 09:00
  endMinute: integer("end_minute").notNull(),
  activityTypeId: varchar("activity_type_id"),
  room: text("room"),
  title: text("title"),
  notes: text("notes"),
  syncGroupId: varchar("sync_group_id"), // blocks with same syncGroupId are synced
});

export const insertTimeBlockSchema = createInsertSchema(timeBlocks).omit({ id: true });
export type InsertTimeBlock = z.infer<typeof insertTimeBlockSchema>;
export type TimeBlock = typeof timeBlocks.$inferSelect;

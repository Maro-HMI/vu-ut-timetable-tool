import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ── Modules ────────────────────────────────
  app.get("/api/modules", async (_req, res) => {
    const modules = await storage.getModules();
    res.json(modules);
  });

  app.get("/api/modules/:id", async (req, res) => {
    const m = await storage.getModule(req.params.id);
    if (!m) return res.status(404).json({ error: "Module not found" });
    res.json(m);
  });

  app.post("/api/modules", async (req, res) => {
    const m = await storage.createModule(req.body);
    res.status(201).json(m);
  });

  app.patch("/api/modules/:id", async (req, res) => {
    const m = await storage.updateModule(req.params.id, req.body);
    if (!m) return res.status(404).json({ error: "Module not found" });
    res.json(m);
  });

  app.delete("/api/modules/:id", async (req, res) => {
    await storage.deleteModule(req.params.id);
    res.status(204).end();
  });

  // ── Courses ────────────────────────────────
  app.get("/api/modules/:moduleId/courses", async (req, res) => {
    const courses = await storage.getCoursesByModule(req.params.moduleId);
    res.json(courses);
  });

  app.post("/api/courses", async (req, res) => {
    const c = await storage.createCourse(req.body);
    res.status(201).json(c);
  });

  app.patch("/api/courses/:id", async (req, res) => {
    const c = await storage.updateCourse(req.params.id, req.body);
    if (!c) return res.status(404).json({ error: "Course not found" });
    res.json(c);
  });

  app.delete("/api/courses/:id", async (req, res) => {
    await storage.deleteCourse(req.params.id);
    res.status(204).end();
  });

  // ── Activity Types ─────────────────────────
  app.get("/api/activity-types", async (req, res) => {
    const moduleId = req.query.moduleId as string | undefined;
    const types = await storage.getActivityTypes(moduleId);
    res.json(types);
  });

  app.post("/api/activity-types", async (req, res) => {
    const a = await storage.createActivityType(req.body);
    res.status(201).json(a);
  });

  app.patch("/api/activity-types/:id", async (req, res) => {
    const a = await storage.updateActivityType(req.params.id, req.body);
    if (!a) return res.status(404).json({ error: "Activity type not found" });
    res.json(a);
  });

  app.delete("/api/activity-types/:id", async (req, res) => {
    await storage.deleteActivityType(req.params.id);
    res.status(204).end();
  });

  // ── Time Blocks ────────────────────────────
  app.get("/api/modules/:moduleId/time-blocks", async (req, res) => {
    const blocks = await storage.getTimeBlocksByModule(req.params.moduleId);
    res.json(blocks);
  });

  app.post("/api/time-blocks", async (req, res) => {
    const t = await storage.createTimeBlock(req.body);
    res.status(201).json(t);
  });

  app.patch("/api/time-blocks/:id", async (req, res) => {
    const t = await storage.updateTimeBlock(req.params.id, req.body);
    if (!t) return res.status(404).json({ error: "Time block not found" });
    res.json(t);
  });

  app.delete("/api/time-blocks/:id", async (req, res) => {
    await storage.deleteTimeBlock(req.params.id);
    res.status(204).end();
  });

  return httpServer;
}

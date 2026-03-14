import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Module, Course } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, BookOpen, GraduationCap } from "lucide-react";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";

const PRESET_COLORS = [
  "#F59E0B",
  "#EF4444",
  "#3B82F6",
  "#10B981",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#F97316",
  "#6366F1",
  "#14B8A6",
  "#84CC16",
  "#A855F7",
];

interface ManageModulesProps {
  selectedModuleId: string | null;
  onSelectModule: (id: string | null) => void;
}

export default function ManageModules({
  selectedModuleId,
  onSelectModule,
}: ManageModulesProps) {
  const { toast } = useToast();
  const [moduleDialogOpen, setModuleDialogOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<Module | null>(null);
  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  // Module form state
  const [moduleName, setModuleName] = useState("");
  const [moduleYear, setModuleYear] = useState("2025-2026");
  const [moduleLocations, setModuleLocations] = useState("UT, VU");
  const [moduleStartDate, setModuleStartDate] = useState("");
  const [moduleEndDate, setModuleEndDate] = useState("");

  // Course form state
  const [courseCode, setCourseCode] = useState("");
  const [courseName, setCourseName] = useState("");
  const [courseColor, setCourseColor] = useState(PRESET_COLORS[0]);
  const [courseLocations, setCourseLocations] = useState<string[]>([]);
  const [courseTeachers, setCourseTeachers] = useState("");
  const [courseTargetHours, setCourseTargetHours] = useState("");

  const { data: modules = [], isLoading: modulesLoading } = useQuery<Module[]>({
    queryKey: ["/api/modules"],
  });

  const selectedModule = modules.find((m) => m.id === selectedModuleId) ?? null;

  const { data: courses = [], isLoading: coursesLoading } = useQuery<Course[]>({
    queryKey: ["/api/modules", selectedModuleId, "courses"],
    enabled: !!selectedModuleId,
  });

  // Module mutations
  const createModuleMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/modules", data);
      return res.json();
    },
    onSuccess: (newModule: Module) => {
      queryClient.invalidateQueries({ queryKey: ["/api/modules"] });
      onSelectModule(newModule.id);
      setModuleDialogOpen(false);
      toast({ title: "Module created" });
    },
  });

  const updateModuleMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Record<string, unknown>;
    }) => {
      const res = await apiRequest("PATCH", `/api/modules/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/modules"] });
      setModuleDialogOpen(false);
      setEditingModule(null);
      toast({ title: "Module updated" });
    },
  });

  const deleteModuleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/modules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/modules"] });
      if (selectedModuleId) onSelectModule(null);
      toast({ title: "Module deleted" });
    },
  });

  // Course mutations
  const createCourseMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/courses", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/modules", selectedModuleId, "courses"],
      });
      setCourseDialogOpen(false);
      toast({ title: "Course created" });
    },
  });

  const updateCourseMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Record<string, unknown>;
    }) => {
      const res = await apiRequest("PATCH", `/api/courses/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/modules", selectedModuleId, "courses"],
      });
      setCourseDialogOpen(false);
      setEditingCourse(null);
      toast({ title: "Course updated" });
    },
  });

  const deleteCourseMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/courses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/modules", selectedModuleId, "courses"],
      });
      toast({ title: "Course deleted" });
    },
  });

  function openNewModuleDialog() {
    setEditingModule(null);
    setModuleName("");
    setModuleYear("2025-2026");
    setModuleLocations("UT, VU");
    setModuleStartDate("");
    setModuleEndDate("");
    setModuleDialogOpen(true);
  }

  function openEditModuleDialog(mod: Module) {
    setEditingModule(mod);
    setModuleName(mod.name);
    setModuleYear(mod.academicYear);
    setModuleLocations((mod.locations ?? []).join(", "));
    setModuleStartDate(mod.startDate);
    setModuleEndDate(mod.endDate);
    setModuleDialogOpen(true);
  }

  function handleModuleSubmit() {
    const locs = moduleLocations
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const data = {
      name: moduleName,
      academicYear: moduleYear,
      locations: locs,
      startDate: moduleStartDate,
      endDate: moduleEndDate,
    };
    if (editingModule) {
      updateModuleMutation.mutate({ id: editingModule.id, data });
    } else {
      createModuleMutation.mutate(data);
    }
  }

  function openNewCourseDialog() {
    setEditingCourse(null);
    setCourseCode("");
    setCourseName("");
    setCourseColor(PRESET_COLORS[0]);
    setCourseLocations(selectedModule?.locations ?? []);
    setCourseTeachers("");
    setCourseTargetHours("");
    setCourseDialogOpen(true);
  }

  function openEditCourseDialog(course: Course) {
    setEditingCourse(course);
    setCourseCode(course.code);
    setCourseName(course.name);
    setCourseColor(course.color);
    setCourseLocations(course.locations ?? []);
    setCourseTeachers(course.teachers ?? "");
    setCourseTargetHours(course.targetHoursPerLocation ?? "");
    setCourseDialogOpen(true);
  }

  function handleCourseSubmit() {
    const data = {
      moduleId: selectedModuleId!,
      code: courseCode,
      name: courseName,
      color: courseColor,
      locations: courseLocations,
      teachers: courseTeachers || null,
      targetHoursPerLocation: courseTargetHours || null,
    };
    if (editingCourse) {
      updateCourseMutation.mutate({ id: editingCourse.id, data });
    } else {
      createCourseMutation.mutate(data);
    }
  }

  const moduleLocationsList = selectedModule?.locations ?? [];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Modules Section */}
      <Card className="rounded-md">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <GraduationCap className="h-5 w-5" />
            Modules
          </CardTitle>
          <Button
            size="sm"
            onClick={openNewModuleDialog}
            data-testid="button-create-module"
            className="rounded-md"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Module
          </Button>
        </CardHeader>
        <CardContent>
          {modulesLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : modules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <GraduationCap className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No modules yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {modules.map((mod) => (
                <div
                  key={mod.id}
                  data-testid={`card-module-${mod.id}`}
                  className={`flex items-center justify-between p-3 rounded-md border cursor-pointer transition-colors ${
                    mod.id === selectedModuleId
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => onSelectModule(mod.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{mod.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                      <span>{mod.academicYear}</span>
                      <span>·</span>
                      <span>{(mod.locations ?? []).join(" / ")}</span>
                      <span>·</span>
                      <span>{mod.startDate} to {mod.endDate}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-md"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditModuleDialog(mod);
                      }}
                      data-testid={`button-edit-module-${mod.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 rounded-md text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteModuleMutation.mutate(mod.id);
                      }}
                      data-testid={`button-delete-module-${mod.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Courses Section */}
      {selectedModule && (
        <Card className="rounded-md">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Courses in {selectedModule.name}
            </CardTitle>
            <Button
              size="sm"
              onClick={openNewCourseDialog}
              data-testid="button-create-course"
              className="rounded-md"
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Course
            </Button>
          </CardHeader>
          <CardContent>
            {coursesLoading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : courses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No courses yet. Add one to start planning.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Color</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Locations</TableHead>
                    <TableHead>Teachers</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {courses.map((course) => (
                    <TableRow key={course.id} data-testid={`row-course-${course.id}`}>
                      <TableCell>
                        <div
                          className="h-5 w-5 rounded-md border"
                          style={{ backgroundColor: course.color }}
                        />
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {course.code}
                      </TableCell>
                      <TableCell className="text-sm">{course.name}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {(course.locations ?? []).map((loc) => (
                            <Badge
                              key={loc}
                              variant="secondary"
                              className="text-xs rounded-md"
                            >
                              {loc}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {course.teachers || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-md"
                            onClick={() => openEditCourseDialog(course)}
                            data-testid={`button-edit-course-${course.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-md text-destructive"
                            onClick={() => deleteCourseMutation.mutate(course.id)}
                            data-testid={`button-delete-course-${course.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Module Dialog */}
      <Dialog open={moduleDialogOpen} onOpenChange={setModuleDialogOpen}>
        <DialogContent className="rounded-md">
          <DialogHeader>
            <DialogTitle>
              {editingModule ? "Edit Module" : "Create Module"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="module-name">Name</Label>
              <Input
                id="module-name"
                data-testid="input-module-name"
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
                placeholder="e.g. Module 3"
                className="rounded-md"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="module-year">Academic Year</Label>
              <Input
                id="module-year"
                data-testid="input-module-year"
                value={moduleYear}
                onChange={(e) => setModuleYear(e.target.value)}
                placeholder="e.g. 2025-2026"
                className="rounded-md"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="module-locations">
                Locations (comma-separated)
              </Label>
              <Input
                id="module-locations"
                data-testid="input-module-locations"
                value={moduleLocations}
                onChange={(e) => setModuleLocations(e.target.value)}
                placeholder="UT, VU"
                className="rounded-md"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="module-start-date">Start Date</Label>
                <Input
                  id="module-start-date"
                  data-testid="input-module-start-date"
                  type="date"
                  value={moduleStartDate}
                  onChange={(e) => setModuleStartDate(e.target.value)}
                  className="rounded-md"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="module-end-date">End Date</Label>
                <Input
                  id="module-end-date"
                  data-testid="input-module-end-date"
                  type="date"
                  value={moduleEndDate}
                  onChange={(e) => setModuleEndDate(e.target.value)}
                  className="rounded-md"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setModuleDialogOpen(false)}
              className="rounded-md"
              data-testid="button-cancel-module"
            >
              Cancel
            </Button>
            <Button
              onClick={handleModuleSubmit}
              disabled={
                !moduleName || !moduleStartDate || !moduleEndDate
              }
              className="rounded-md"
              data-testid="button-save-module"
            >
              {editingModule ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Course Dialog */}
      <Dialog open={courseDialogOpen} onOpenChange={setCourseDialogOpen}>
        <DialogContent className="rounded-md">
          <DialogHeader>
            <DialogTitle>
              {editingCourse ? "Edit Course" : "Add Course"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="course-code">Code</Label>
                <Input
                  id="course-code"
                  data-testid="input-course-code"
                  value={courseCode}
                  onChange={(e) => setCourseCode(e.target.value)}
                  placeholder="CS101"
                  className="rounded-md"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="course-name">Name</Label>
                <Input
                  id="course-name"
                  data-testid="input-course-name"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  placeholder="Intro to CS"
                  className="rounded-md"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    data-testid={`button-color-${color}`}
                    className={`h-7 w-7 rounded-md border-2 transition-all ${
                      courseColor === color
                        ? "border-foreground scale-110"
                        : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setCourseColor(color)}
                    type="button"
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Locations</Label>
              <div className="flex gap-3">
                {moduleLocationsList.map((loc) => (
                  <label
                    key={loc}
                    className="flex items-center gap-1.5 text-sm"
                  >
                    <Checkbox
                      data-testid={`checkbox-location-${loc}`}
                      checked={courseLocations.includes(loc)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setCourseLocations([...courseLocations, loc]);
                        } else {
                          setCourseLocations(
                            courseLocations.filter((l) => l !== loc)
                          );
                        }
                      }}
                    />
                    {loc}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-teachers">Teachers</Label>
              <Input
                id="course-teachers"
                data-testid="input-course-teachers"
                value={courseTeachers}
                onChange={(e) => setCourseTeachers(e.target.value)}
                placeholder="Dr. Smith, Prof. Jones"
                className="rounded-md"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-target-hours">
                Target Hours per Location (JSON)
              </Label>
              <Input
                id="course-target-hours"
                data-testid="input-course-target-hours"
                value={courseTargetHours}
                onChange={(e) => setCourseTargetHours(e.target.value)}
                placeholder='{"UT":30,"VU":28}'
                className="rounded-md"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setCourseDialogOpen(false)}
              className="rounded-md"
              data-testid="button-cancel-course"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCourseSubmit}
              disabled={!courseCode || !courseName}
              className="rounded-md"
              data-testid="button-save-course"
            >
              {editingCourse ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PerplexityAttribution />
    </div>
  );
}

import { z } from "zod";

export const CLASSROOM_UPDATE_ROLE = "classroom_update";
export const STUDY_PLAN_ROLE = "study_plan";

export const classroomUpdateSchema = z.object({
  assignmentId: z.string(),
  title: z.string(),
  dueDate: z.string().nullable(),
  status: z.enum(["pending", "due_soon", "overdue", "completed"]).optional(),
  change: z.enum(["new", "deadline", "due_soon", "overdue", "completed", "updated"]).optional(),
  lastQuestion: z.string().optional(),
});

export type ClassroomUpdate = z.infer<typeof classroomUpdateSchema>;

export function assignmentQuestionPrefix(assignmentId: string) {
  return `assignment-question-${assignmentId}-`;
}

export const studyPlanSchema = z.object({
  approvalId: z.string(),
  title: z.string(),
  sessions: z.array(z.string()).length(3),
});

export const studyPlanApprovalSchema = z.object({
  type: z.literal("save_study_plan"),
  assignmentId: z.string(),
  sessions: z.array(z.string().max(200)).length(3),
});

export function studyCoachThreadId(agentId: string) {
  return `study-thread-${agentId}`;
}

export function readThreadData<T>(schema: z.ZodType<T>, content: string): T | null {
  try {
    const value: unknown = JSON.parse(content);
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

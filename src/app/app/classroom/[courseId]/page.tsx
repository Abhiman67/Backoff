"use client";

import { use } from "react";
import { ClassroomCourseView } from "@/components/ClassroomCourseView";

export default function ClassroomCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params);
  return <ClassroomCourseView courseId={courseId} />;
}

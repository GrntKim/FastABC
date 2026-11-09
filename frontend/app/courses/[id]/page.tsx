import { Suspense } from "react";
import CourseScreen from "./course-screen";

// Params are runtime data under Cache Components: read them inside <Suspense>
export default function CoursePage({ params }: PageProps<"/courses/[id]">) {
  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <Suspense fallback={<p className="text-muted-foreground">불러오는 중…</p>}>
        {params.then(({ id }) => (
          <CourseScreen courseId={Number(id)} />
        ))}
      </Suspense>
    </div>
  );
}

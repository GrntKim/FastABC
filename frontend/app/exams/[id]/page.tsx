import { Suspense } from "react";
import ExamScreen from "./exam-screen";

// Params are runtime data under Cache Components: read them inside <Suspense>
export default function ExamPage({ params }: PageProps<"/exams/[id]">) {
  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <Suspense fallback={<p className="text-muted-foreground">불러오는 중…</p>}>
        {params.then(({ id }) => (
          <ExamScreen examId={Number(id)} />
        ))}
      </Suspense>
    </div>
  );
}

import { Suspense } from "react";
import QuestionReport from "./question-report";

// Params and the query are runtime data under Cache Components: read them inside <Suspense>
export default function QuestionReportPage({ params, searchParams }: PageProps<"/assignments/[id]/report">) {
  return (
    <div className="w-full p-4 print:p-0">
      <Suspense fallback={<p className="text-muted-foreground">불러오는 중…</p>}>
        {Promise.all([params, searchParams]).then(([{ id }, q]) => (
          <QuestionReport assignmentId={Number(id)} student={typeof q.student === "string" ? q.student : null} />
        ))}
      </Suspense>
    </div>
  );
}

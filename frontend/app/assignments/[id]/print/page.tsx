import { Suspense } from "react";
import { parseSheetQuery } from "@/lib/sheet";
import QuestionPrint from "./question-print";

// Params and the query are runtime data under Cache Components: read them inside <Suspense>
export default function QuestionPrintPage({ params, searchParams }: PageProps<"/assignments/[id]/print">) {
  return (
    <div className="w-full p-4 print:p-0">
      <Suspense fallback={<p className="text-muted-foreground">불러오는 중…</p>}>
        {Promise.all([params, searchParams]).then(([{ id }, q]) => (
          <QuestionPrint assignmentId={Number(id)} {...parseSheetQuery(q)} />
        ))}
      </Suspense>
    </div>
  );
}

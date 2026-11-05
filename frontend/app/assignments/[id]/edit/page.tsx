import { Suspense } from "react";
import EditAssignment from "./edit-assignment";

// Params are runtime data under Cache Components: read them inside <Suspense>
export default function EditAssignmentPage({ params }: PageProps<"/assignments/[id]/edit">) {
  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <Suspense fallback={<p className="text-muted-foreground">불러오는 중…</p>}>
        {params.then(({ id }) => (
          <EditAssignment assignmentId={Number(id)} />
        ))}
      </Suspense>
    </div>
  );
}

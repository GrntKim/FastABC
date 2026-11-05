import { Suspense } from "react";
import NewAssignment from "./new-assignment";

// Params are runtime data under Cache Components: read them inside <Suspense>
export default function NewAssignmentPage({ params }: PageProps<"/courses/[id]/assignments/new">) {
  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <Suspense fallback={<p className="text-muted-foreground">불러오는 중…</p>}>
        {params.then(({ id }) => (
          <NewAssignment courseId={Number(id)} />
        ))}
      </Suspense>
    </div>
  );
}

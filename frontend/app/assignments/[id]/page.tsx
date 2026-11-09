import { Suspense } from "react";
import DetailScreen from "./detail-screen";

// Params are runtime data under Cache Components: read them inside <Suspense>
export default function AssignmentPage({ params }: PageProps<"/assignments/[id]">) {
  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <Suspense fallback={<p className="text-muted-foreground">불러오는 중…</p>}>
        {params.then(({ id }) => (
          <DetailScreen assignmentId={Number(id)} />
        ))}
      </Suspense>
    </div>
  );
}

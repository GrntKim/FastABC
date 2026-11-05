import { Suspense } from "react";
import ReviewScreen from "./review-screen";

// Params are runtime data under Cache Components: read them inside <Suspense>
export default function ReviewPage({ params }: PageProps<"/assignments/[id]/review">) {
  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <Suspense fallback={<p className="text-muted-foreground">불러오는 중…</p>}>
        {params.then(({ id }) => (
          <ReviewScreen assignmentId={Number(id)} />
        ))}
      </Suspense>
    </div>
  );
}

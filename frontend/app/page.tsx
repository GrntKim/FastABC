import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import AssignmentsList from "./assignments-list";

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
      <div className="flex items-center">
        <h1 className="text-2xl font-bold">문항</h1>
        <Link href="/assignments/new" className={`ml-auto ${buttonVariants()}`}>
          새 문항
        </Link>
      </div>
      <AssignmentsList />
    </div>
  );
}

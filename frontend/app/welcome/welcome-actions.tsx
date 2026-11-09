"use client";

import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { useMe } from "@/lib/use-me";

/** Sign up or log in; a grader already logged in goes straight to the courses. */
export default function WelcomeActions() {
  const me = useMe(); // a 401 here only means logged out: /welcome is a public page
  if (me.isPending) return <div className="h-10" />;
  if (me.data)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className={buttonVariants({ size: "lg" })}>
          과목으로 가기
        </Link>
        <span className="text-sm text-muted-foreground">{me.data.name}님으로 로그인되어 있습니다.</span>
      </div>
    );
  return (
    <div className="flex flex-wrap gap-3">
      <Link href="/login?mode=signup" className={buttonVariants({ size: "lg" })}>
        가입하고 시작하기
      </Link>
      <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
        로그인
      </Link>
    </div>
  );
}

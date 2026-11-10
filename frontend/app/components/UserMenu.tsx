"use client";

import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useMe } from "@/lib/use-me";

/** Logged in: the introduction, the courses and the account. Logged out: ways in. */
export default function UserMenu() {
  const me = useMe(); // a 401 here only means logged out
  if (me.isPending) return null;
  if (!me.data)
    return (
      <nav className="flex items-center gap-2 text-sm">
        <Link href="/welcome" className="mr-2 hover:underline">
          소개
        </Link>
        <Link href="/login" className={buttonVariants({ size: "sm", variant: "ghost" })}>
          로그인
        </Link>
        <Link href="/login?mode=signup" className={buttonVariants({ size: "sm" })}>
          가입하기
        </Link>
      </nav>
    );
  return (
    <nav className="flex items-center gap-4 text-sm">
      <Link href="/welcome" className="hover:underline">
        소개
      </Link>
      <Link href={"/"} className="hover:underline">
        과목
      </Link>
      <span className="text-muted-foreground">{me.data.name}</span>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          await api("/auth/logout", { method: "POST" }).catch(() => undefined);
          // a full load on purpose, not router.push: no cached data of this account may survive
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
        }}
      >
        로그아웃
      </Button>
    </nav>
  );
}

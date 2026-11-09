"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useMe } from "@/lib/use-me";

/** Navigation and the account, once logged in; nothing on the login page. */
export default function UserMenu() {
  const me = useMe();
  if (!me.data) return null;
  return (
    <nav className="flex items-center gap-4 text-sm">
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

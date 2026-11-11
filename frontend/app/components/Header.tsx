import Link from "next/link";
import UserMenu from "./UserMenu";

export default function Header() {
  return (
    <header className="border-b bg-card print:hidden">
      <div className="flex w-full max-w-5xl mx-auto items-center justify-between p-4">
        {/* the logo always leads to the introduction, logged in or not; the courses are "과목" in the menu */}
        <Link href="/welcome" className="flex items-baseline gap-2">
          <span className="font-bold text-xl text-primary">FastABC</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">서술형 채점 보조</span>
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}

import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b bg-card">
      <div className="flex w-full max-w-5xl mx-auto items-center justify-between p-4">
        <Link href={"/"} className="flex items-baseline gap-2">
          <span className="font-bold text-xl text-primary">FastABC</span>
          <span className="text-xs text-muted-foreground">서술형 채점 보조</span>
        </Link>
        <nav className="flex space-x-4">
          <Link href={"/"} className="hover:underline">과목</Link>
        </nav>
      </div>
    </header>
  );
}

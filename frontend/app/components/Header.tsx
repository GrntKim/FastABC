import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b border-gray-500">
      <div className="flex w-full max-w-4xl mx-auto items-center justify-between p-4">
        <div>
          <Link href={"/"} className="hover:underline">
            <p className="font-bold text-xl">FastABC</p>
          </Link>
        </div>
        <nav className="flex space-x-4">
          <Link href={"#"} className="hover:underline">link1</Link>
          <Link href={"#"} className="hover:underline">link2</Link>
          <Link href={"#"} className="hover:underline">link3</Link>
        </nav>
      </div>
    </header>
  );
}
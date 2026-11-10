import { cacheLife } from "next/cache";

async function CurrentYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

export default async function Footer() {
  return (
    <footer className="border-t print:hidden">
      <div className="flex w-full max-w-5xl p-2 mx-auto items-center">
        <p className="text-sm text-gray-500">
          &copy; {await CurrentYear()} FastABC
        </p>
      </div>
    </footer>
  );
}
import { cacheLife } from "next/cache";

async function CurrentYear() {
  "use cache";
  cacheLife("days");
  return new Date().getFullYear();
}

export default async function Footer() {
  return (
    <footer className="border-t border-gray-500">
      <div className="flex w-full max-w-4xl p-2 mx-auto items-center">
        <p className="text-sm text-gray-500">
          &copy; {await CurrentYear()} FastABC
        </p>
      </div>
    </footer>
  );
}
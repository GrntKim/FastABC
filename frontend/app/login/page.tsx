import { Suspense } from "react";
import LoginScreen from "./login-screen";

// the ?next= search param is runtime data under Cache Components: read it inside <Suspense>
export default function LoginPage() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col justify-center p-4 py-16">
      <Suspense>
        <LoginScreen />
      </Suspense>
    </div>
  );
}

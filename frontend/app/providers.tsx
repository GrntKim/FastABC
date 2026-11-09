"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { isUnauthorized, toLogin } from "@/lib/api";

// an expired or deleted session: any request may be the first to find out
const onError = (e: unknown) => {
  if (isUnauthorized(e)) toLogin();
};

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError }),
        mutationCache: new MutationCache({ onError }),
        defaultOptions: { queries: { staleTime: 10_000, retry: (count, e) => !isUnauthorized(e) && count < 1 } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors />
    </QueryClientProvider>
  );
}

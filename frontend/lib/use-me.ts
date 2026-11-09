import { useQuery } from "@tanstack/react-query";
import { api, type UserOut } from "./api";

/** The logged-in grader. Errors with 401 when logged out (the global handler then goes to /login). */
export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<UserOut>("/auth/me"), staleTime: Infinity });

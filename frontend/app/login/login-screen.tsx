"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError, json, type UserOut } from "@/lib/api";

type Mode = "login" | "signup";

// only paths inside this app: never an absolute or protocol-relative URL
const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

function message(e: unknown, mode: Mode) {
  if (e instanceof ApiError && typeof e.detail === "string" && (e.status === 401 || e.status === 409)) return e.detail;
  if (e instanceof ApiError && e.status === 422)
    return mode === "signup" ? "이메일 형식과 비밀번호(8자 이상)를 확인하세요" : "이메일과 비밀번호를 입력하세요";
  return "서버에 연결하지 못했습니다";
}

export default function LoginScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const next = safeNext(params.get("next"));
  // the mode lives in the URL, not in state: the page stays mounted between visits, so state would keep
  // whichever form was open last instead of the one the link asked for
  const mode: Mode = params.get("mode") === "signup" ? "signup" : "login";
  const switchTo = (m: Mode) => {
    const query = new URLSearchParams(params);
    if (m === "signup") query.set("mode", "signup");
    else query.delete("mode");
    router.replace(query.size ? `/login?${query}` : "/login");
    submit.reset();
  };
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const submit = useMutation({
    mutationFn: () =>
      mode === "login"
        ? api<UserOut>("/auth/login", json({ email: form.email.trim(), password: form.password }))
        : api<UserOut>("/auth/signup", json({ ...form, email: form.email.trim() })),
    // a full load: no cached data from another account survives, and the proxy sees the new cookie
    onSuccess: () => window.location.assign(next),
  });
  const signup = mode === "signup";
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{signup ? "가입" : "로그인"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          {signup && (
            <label className="flex flex-col gap-1 text-sm">
              이름
              <Input autoComplete="name" placeholder="김조교" required {...field("name")} />
              <span className="text-xs text-muted-foreground">화면과 성적 확정 기록에 남습니다.</span>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            이메일
            <Input type="email" autoComplete="email" required {...field("email")} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            비밀번호
            <Input
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 8 : undefined}
              placeholder={signup ? "8자 이상" : undefined}
              required
              {...field("password")}
            />
          </label>
          {submit.isError && <p className="text-sm text-destructive">{message(submit.error, mode)}</p>}
          <Button type="submit" disabled={submit.isPending || submit.isSuccess}>
            {signup ? "가입하고 시작하기" : "로그인"}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {signup ? "이미 계정이 있나요?" : "처음인가요?"}{" "}
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline"
            onClick={() => switchTo(signup ? "login" : "signup")}
          >
            {signup ? "로그인" : "가입하기"}
          </button>
        </p>
      </CardContent>
    </Card>
  );
}

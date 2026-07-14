"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  async function submit(form: FormData) {
    const result = await signIn("credentials", {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      redirect: false,
      callbackUrl: "/uploads",
    });
    if (result?.error) setError("Invalid email or password.");
    else window.location.assign(result?.url ?? "/uploads");
  }
  return (
    <main className="login-page">
      <form action={submit} className="login-form">
        <h1>RizPoint private access</h1>
        <label>
          Email
          <input required name="email" type="email" autoComplete="username" />
        </label>
        <label>
          Password
          <input
            required
            name="password"
            type="password"
            autoComplete="current-password"
          />
        </label>
        <button type="submit">Sign in</button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}

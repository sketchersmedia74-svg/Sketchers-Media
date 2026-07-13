"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await supabaseBrowser.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleLogin}>
        <img src="/logo.png" alt="Company logo" className="login-logo" />
        <h2>Sketchers Media CRM</h2>
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn" type="submit" style={{ width: "100%" }}>Sign in</button>
        {error && <p className="error">{error}</p>}
        <p style={{ fontSize: 12, color: "#888", marginTop: 16 }}>
          Team members are added via Supabase Auth (Dashboard → Authentication → Users).
        </p>
      </form>
    </div>
  );
}

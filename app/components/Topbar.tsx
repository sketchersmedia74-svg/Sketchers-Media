"use client";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";

export default function Topbar() {
  const router = useRouter();
  async function logout() {
    await supabaseBrowser.auth.signOut();
    router.push("/");
  }
  return (
    <div className="topbar">
      <div className="brand">
        <img src="/logo.png" alt="Company logo" className="logo" />
        <strong>Sketchers Media CRM</strong>
      </div>
      <nav>
        <a href="/dashboard">Pipeline</a>
        <a href="/contacts">Contacts</a>
        <a href="/companies">Companies</a>
      </nav>
      <button className="btn secondary" onClick={logout}>Sign out</button>
    </div>
  );
}

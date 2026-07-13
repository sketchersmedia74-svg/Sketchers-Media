"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";

export default function Topbar() {
  const router = useRouter();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) return;
      const { data } = await supabaseBrowser
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single();
      setIsAdmin(data?.role === "admin");
    })();
  }, []);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "dark" : "light");

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handleSystemChange(e: MediaQueryListEvent) {
      // Only follow the system preference if the user hasn't manually overridden it.
      if (localStorage.getItem("theme")) return;
      const next = e.matches ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      setTheme(next);
    }
    mq.addEventListener("change", handleSystemChange);
    return () => mq.removeEventListener("change", handleSystemChange);
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    setTheme(next);
  }

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
        <a href="/projects">Projects</a>
        {isAdmin && <a href="/team">Team</a>}
      </nav>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <button className="btn secondary" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}

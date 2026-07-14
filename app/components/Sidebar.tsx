"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";

function Icon({ path }: { path: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  overview: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
  pipeline: "M4 4v16M10 4v10M16 4v16M4 4h4M10 4h4M16 4h4",
  contacts: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.3 3.6-6 8-6s8 2.7 8 6",
  companies: "M4 21V7l8-4 8 4v14M4 21h16M9 21v-6h6v6M9 11h.01M15 11h.01M9 15h.01M15 15h.01",
  team: "M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 21c0-3 3-5 7-5s7 2 7 5M13 16c3.5.3 6 2.2 6 5",
  calendarSettings: "M3 8h18M7 3v4M17 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01",
  bookings: "M3 8h18M7 3v4M17 3v4M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 14l2 2 4-4",
  projects: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
  signOut: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
  menu: "M4 6h16M4 12h16M4 18h16",
};

const BASE_NAV = [
  { href: "/overview", label: "Overview", icon: ICONS.overview },
  { href: "/dashboard", label: "Pipeline", icon: ICONS.pipeline },
  { href: "/contacts", label: "Contacts", icon: ICONS.contacts },
  { href: "/companies", label: "Companies", icon: ICONS.companies },
  { href: "/projects", label: "Projects", icon: ICONS.projects },
  { href: "/bookings", label: "Bookings", icon: ICONS.bookings },
];

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isAdmin, setIsAdmin] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(localStorage.getItem("sidebarExpanded") === "true");
  }, []);

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem("sidebarExpanded", String(next));
  }

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

  const navItems = isAdmin
    ? [
        ...BASE_NAV,
        { href: "/team", label: "Team", icon: ICONS.team },
        { href: "/settings/calendar", label: "Calendar Settings", icon: ICONS.calendarSettings },
      ]
    : BASE_NAV;

  return (
    <div className={expanded ? "sidebar expanded" : "sidebar"}>
      <div className="sidebar-top">
        <a href="/overview" className="sidebar-logo" title="Sketchers Media CRM">
          <img src="/logo.png" alt="Company logo" />
        </a>
        <button className="sidebar-icon-btn" onClick={toggleExpanded} title={expanded ? "Collapse sidebar" : "Expand sidebar"}>
          <Icon path={ICONS.menu} />
        </button>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            title={item.label}
            className={pathname === item.href ? "active" : ""}
          >
            <Icon path={item.icon} />
            <span className="sidebar-label">{item.label}</span>
          </a>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button className="sidebar-icon-btn" onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
          {theme === "dark" ? "☀️" : "🌙"}
          <span className="sidebar-label">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </button>
        <button className="sidebar-icon-btn" onClick={logout} title="Sign out">
          <Icon path={ICONS.signOut} />
          <span className="sidebar-label">Sign out</span>
        </button>
      </div>
    </div>
  );
}

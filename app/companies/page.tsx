"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Topbar from "../components/Topbar";

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseBrowser.auth.getSession();
      if (!session) { router.push("/"); return; }
      const { data } = await supabaseBrowser.from("companies").select("*").order("created_at", { ascending: false });
      setCompanies(data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <Topbar />
      <div className="container">
        <h2>Companies</h2>
        {loading ? <p>Loading…</p> : (
          <table>
            <thead><tr><th>Name</th><th>Industry</th><th>Website</th></tr></thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.industry || "—"}</td>
                  <td>{c.website || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

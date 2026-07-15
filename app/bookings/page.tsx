"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseClient";
import Sidebar from "../components/Sidebar";

export default function BookingsPage() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabaseBrowser.auth.getSession();
      if (!session) {
        router.push("/");
        return;
      }
      await load();
    })();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabaseBrowser
      .from("bookings")
      .select("*, contacts(id, first_name, last_name, email, phone), deals(id, title, stage)")
      .order("start_time", { ascending: false });
    setBookings(data || []);
    setLoading(false);
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <div className="container">
          <h2>Bookings</h2>
          {loading ? (
            <p>Loading…</p>
          ) : bookings.length === 0 ? (
            <p>No bookings yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Attendee</th>
                  <th>Contact</th>
                  <th>Deal</th>
                  <th>Source</th>
                  <th>Calendar</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id}>
                    <td>
                      {new Date(b.start_time).toLocaleString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: b.timezone || undefined,
                      })}
                      {b.timezone && <span style={{ opacity: 0.6, fontSize: 12 }}> ({b.timezone})</span>}
                    </td>
                    <td>{b.attendee_name || "—"}</td>
                    <td>
                      {b.contacts ? (
                        <a href={`/contacts/${b.contacts.id}`}>
                          {b.contacts.first_name} {b.contacts.last_name || ""}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{b.deals ? `${b.deals.title} (${b.deals.stage})` : "—"}</td>
                    <td>{b.source === "public_page" ? "Public page" : "API"}</td>
                    <td>
                      {b.google_event_link ? (
                        <a href={b.google_event_link} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

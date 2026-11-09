"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseClient";
import { CALLING_ENABLED, phoneService, REMOTE_AUDIO_ID, PhoneStatus } from "@/lib/phone/phoneService";
import { isWithinCallingHours, localTimeLabel, parseDialable, resolveTimezone, toE164 } from "@/lib/phone/usTime";
import { CallBar, IncomingCallBar, OutcomePanel } from "./PhoneUI";

export type CallableContact = {
  id: string;
  first_name: string;
  last_name?: string | null;
  phone?: string | null;
  do_not_call?: boolean | null;
  timezone?: string | null;
  state?: string | null;
};

export type ActiveCall = {
  call: any;
  logId: string | null; // null for inbound until claimed at outcome time
  direction: "outbound" | "inbound";
  contactId: string | null;
  name: string;
  number: string;
  phase: "dialing" | "ringing" | "connected";
  connectedAt: number | null;
  muted: boolean;
};

export type PendingOutcome = {
  logId: string | null;
  sessionId: string | null;
  direction: "outbound" | "inbound";
  contactId: string | null;
  name: string;
  number: string;
  answered: boolean;
};

export type IncomingCall = { call: any; number: string; contactId: string | null; name: string };

type PhoneContext = {
  enabled: boolean;
  status: PhoneStatus;
  statusMessage: string;
  isAdmin: boolean;
  busy: boolean;
  startCall: (c: CallableContact) => Promise<{ ok: boolean; error?: string }>;
  startManualCall: (rawNumber: string) => Promise<{ ok: boolean; error?: string }>;
};

const Ctx = createContext<PhoneContext>({
  enabled: false, status: "disabled", statusMessage: "", isAdmin: false, busy: false,
  startCall: async () => ({ ok: false, error: "Calling is not enabled." }),
  startManualCall: async () => ({ ok: false, error: "Calling is not enabled." }),
});
export const usePhone = () => useContext(Ctx);

const fullName = (c: { first_name: string; last_name?: string | null }) =>
  `${c.first_name} ${c.last_name || ""}`.trim();
const last10 = (s?: string | null) => (s || "").replace(/\D/g, "").slice(-10);

export default function PhoneProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<PhoneStatus>(CALLING_ENABLED ? "idle" : "disabled");
  const [statusMessage, setStatusMessage] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [pending, setPending] = useState<PendingOutcome | null>(null);

  const activeRef = useRef<ActiveCall | null>(null);
  const incomingRef = useRef<IncomingCall | null>(null);
  const pendingRef = useRef<PendingOutcome | null>(null);
  const statusRef = useRef<PhoneStatus>(status);
  const readyWaiters = useRef<Array<() => void>>([]);
  activeRef.current = active;
  incomingRef.current = incoming;
  pendingRef.current = pending;
  statusRef.current = status;

  const updateStatus = useCallback((s: PhoneStatus, message?: string) => {
    setStatus(s);
    setStatusMessage(message || "");
    if (s === "ready") {
      readyWaiters.current.forEach((fn) => fn());
      readyWaiters.current = [];
    }
  }, []);

  // ---- Call lifecycle from the Telnyx SDK ------------------------------------
  const finishActive = useCallback((a: ActiveCall, answered: boolean) => {
    setActive(null);
    activeRef.current = null;
    const sessionId = a.call?.telnyxIDs?.telnyxSessionId ?? null;
    const p: PendingOutcome = {
      logId: a.logId, sessionId, direction: a.direction, contactId: a.contactId,
      name: a.name, number: a.number, answered,
    };
    pendingRef.current = p;
    setPending(p);
  }, []);

  const onCall = useCallback((call: any) => {
    const state: string = call.state;
    const a = activeRef.current;

    if (a && a.call.id === call.id) {
      if (state === "hangup" || state === "destroy") {
        finishActive(a, !!a.connectedAt);
      } else if (state === "active") {
        if (!a.connectedAt) setActive({ ...a, phase: "connected", connectedAt: Date.now() });
      } else if (state === "ringing" || state === "early" || state === "trying") {
        if (a.phase === "dialing") setActive({ ...a, phase: "ringing" });
      }
      return;
    }

    const inc = incomingRef.current;
    if (inc && inc.call.id === call.id && (state === "hangup" || state === "destroy")) {
      setIncoming(null); // caller gave up before anyone answered
      return;
    }

    // A new inbound call: only ring if this caller is free.
    if (call.direction === "inbound" && state === "ringing" && !a && !pendingRef.current && !inc) {
      const number: string = call.remotePartyNumber || "";
      setIncoming({ call, number, contactId: null, name: "Unknown caller" });
      const tail = last10(number);
      if (tail) {
        supabaseBrowser
          .from("contacts")
          .select("id, first_name, last_name")
          .like("phone", `%${tail}`)
          .limit(1)
          .then(({ data }) => {
            const c = data?.[0];
            if (c) {
              setIncoming((cur) => (cur && cur.call.id === call.id
                ? { ...cur, contactId: c.id, name: fullName(c) } : cur));
            }
          });
      }
    }
  }, [finishActive]);

  // ---- Connect when signed in, disconnect on sign-out -------------------------
  useEffect(() => {
    if (!CALLING_ENABLED) return;
    phoneService.setHandlers({ onStatus: updateStatus, onCall });
    phoneService.hasActiveCall = () => !!activeRef.current || !!incomingRef.current;

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange(async (_evt, session) => {
      if (session?.user) {
        const { data } = await supabaseBrowser.from("profiles").select("role").eq("id", session.user.id).single();
        setIsAdmin(data?.role === "admin");
        phoneService.connect();
      } else {
        setIsAdmin(false);
        phoneService.disconnect();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [onCall, updateStatus]);

  // Warn before closing the tab mid-call.
  useEffect(() => {
    if (!active) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [active]);

  function waitUntilReady(ms: number): Promise<boolean> {
    if (statusRef.current === "ready") return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      readyWaiters.current.push(() => { clearTimeout(t); resolve(true); });
    });
  }

  // ---- Start an outbound call --------------------------------------------------
  const startCall = useCallback(async (c: CallableContact) => {
    if (!CALLING_ENABLED) return { ok: false, error: "Calling is not enabled yet." };
    if (activeRef.current || pendingRef.current || incomingRef.current) {
      return { ok: false, error: "Finish the current call (and save its outcome) first." };
    }

    // 1. Valid phone number -> E.164
    const to = toE164(c.phone);
    if (!to) return { ok: false, error: "This contact has no valid US phone number." };

    // Manual dial of a number that isn't in the CRM: no contact row (id is empty).
    const isManual = !c.id;

    // 2. Do-not-call. Re-read the flag from the database so a stale page can't dial.
    const { data: fresh } = isManual
      ? { data: null as any }
      : await supabaseBrowser
          .from("contacts").select("do_not_call, timezone, state, phone").eq("id", c.id).single();
    if (fresh?.do_not_call ?? c.do_not_call) {
      return { ok: false, error: "This contact is marked Do Not Call. The call was blocked." };
    }

    // 3. Calling hours: 8:00am-9:00pm in the dentist's local time.
    const tz = resolveTimezone({
      timezone: fresh?.timezone ?? c.timezone, state: fresh?.state ?? c.state, phone: c.phone,
    });
    if (tz && tz.source !== "saved" && !isManual) {
      // Remember the derived zone so later checks are instant.
      await supabaseBrowser.from("contacts").update({ timezone: tz.timezone }).eq("id", c.id);
    }
    let override = false;
    if (!tz) {
      if (!isAdmin) {
        return { ok: false, error: "Can't tell this dentist's time zone (no state, unknown area code). Ask an admin to add a state, or to place the call." };
      }
      if (!window.confirm("Time zone unknown, so calling hours can't be checked. Call anyway? (This override is logged.)")) {
        return { ok: false, error: "Call cancelled." };
      }
      override = true;
    } else if (!isWithinCallingHours(tz.timezone)) {
      const msg = `It's ${localTimeLabel(tz.timezone)} for this dentist. Calls are only allowed 8:00am to 9:00pm their time.`;
      if (!isAdmin) return { ok: false, error: msg };
      if (!window.confirm(`${msg}\n\nAs an admin you can override. Call anyway? (This override is logged.)`)) {
        return { ok: false, error: "Call cancelled." };
      }
      override = true;
    }

    // 4. Microphone, then phone connection.
    try { await phoneService.ensureMicrophone(); }
    catch (e: any) { return { ok: false, error: e.message }; }

    if (!phoneService.isReady()) phoneService.connect();
    if (!(await waitUntilReady(20000))) {
      return { ok: false, error: statusRef.current === "error"
        ? `Phone isn't connected: ${statusMessage || "connection error"}`
        : "The phone is still connecting. Try again in a few seconds." };
    }

    // 5. Log first, then dial. The log row id travels with the call (clientState + header).
    const { data: deal } = isManual
      ? { data: null as any }
      : await supabaseBrowser
          .from("deals").select("id").eq("contact_id", c.id)
          .order("created_at", { ascending: false }).limit(1);

    const { data: row, error: insErr } = await supabaseBrowser
      .from("call_logs")
      .insert({
        contact_id: isManual ? null : c.id,
        deal_id: deal?.[0]?.id ?? null,
        direction: "outbound",
        to_number: to,
        from_number: phoneService.callerNumber || null,
        status: "dialing",
        outside_hours_override: override,
      })
      .select("id")
      .single();
    if (insErr || !row) return { ok: false, error: insErr?.message || "Could not log the call." };

    try {
      const call = phoneService.newCall({ to, logId: row.id });
      const a: ActiveCall = {
        call, logId: row.id, direction: "outbound", contactId: isManual ? null : c.id,
        name: isManual ? to : fullName(c), number: to, phase: "dialing", connectedAt: null, muted: false,
      };
      activeRef.current = a;
      setActive(a);
      return { ok: true };
    } catch (e: any) {
      await supabaseBrowser.from("call_logs").update({ status: "failed" }).eq("id", row.id);
      return { ok: false, error: e?.message || "Could not start the call." };
    }
  }, [isAdmin, statusMessage]);

  // ---- Manual dial: any US/Canada number, matched to a contact when one exists ----
  const startManualCall = useCallback(async (raw: string) => {
    const parsed = parseDialable(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const { data: m } = await supabaseBrowser
      .from("contacts")
      .select("id, first_name, last_name, phone, do_not_call, timezone, state")
      .like("phone", `%${last10(parsed.e164)}`)
      .limit(1);
    const match = m?.[0];
    // A match goes through the normal contact path: do-not-call, hours check, call attached to the contact.
    if (match) return startCall({ ...match, phone: parsed.e164 });
    return startCall({ id: "", first_name: parsed.e164, phone: parsed.e164 });
  }, [startCall]);

  // ---- Call-bar actions --------------------------------------------------------
  const hangup = () => { try { activeRef.current?.call.hangup(); } catch { /* ignore */ } };
  const toggleMute = () => {
    const a = activeRef.current;
    if (!a) return;
    try { a.muted ? a.call.unmuteAudio() : a.call.muteAudio(); } catch { /* ignore */ }
    setActive({ ...a, muted: !a.muted });
  };
  const sendDigit = (d: string) => { try { activeRef.current?.call.dtmf(d); } catch { /* ignore */ } };

  async function answerIncoming() {
    const inc = incomingRef.current;
    if (!inc) return;
    try {
      await phoneService.ensureMicrophone();
      await inc.call.answer();
      const a: ActiveCall = {
        call: inc.call, logId: null, direction: "inbound", contactId: inc.contactId,
        name: inc.name, number: inc.number, phase: "connected", connectedAt: Date.now(), muted: false,
      };
      activeRef.current = a;
      setActive(a);
      setIncoming(null);
    } catch (e: any) {
      alert(e?.message || "Could not answer the call.");
    }
  }
  function declineIncoming() {
    try { incomingRef.current?.call.hangup(); } catch { /* ignore */ }
    setIncoming(null);
  }

  const value = useMemo<PhoneContext>(() => ({
    enabled: CALLING_ENABLED, status, statusMessage, isAdmin,
    busy: !!active || !!pending || !!incoming, startCall, startManualCall,
  }), [status, statusMessage, isAdmin, active, pending, incoming, startCall, startManualCall]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {CALLING_ENABLED && (
        <>
          {/* The SDK plays the dentist's voice through this element. */}
          <audio id={REMOTE_AUDIO_ID} autoPlay playsInline />
          {incoming && <IncomingCallBar incoming={incoming} onAnswer={answerIncoming} onDecline={declineIncoming} />}
          {active && <CallBar active={active} onHangup={hangup} onMute={toggleMute} onDigit={sendDigit} />}
          {pending && (
            <OutcomePanel
              pending={pending}
              onDone={() => { setPending(null); pendingRef.current = null; }}
            />
          )}
        </>
      )}
    </Ctx.Provider>
  );
}

"use client";
import { supabaseBrowser } from "@/lib/supabaseClient";

// Calling is OFF until NEXT_PUBLIC_CALLING_ENABLED=true is set at build time
// (so the app ships safely before the Telnyx account and Edge Functions exist).
// Local-only UI preview: fake calls, no Telnyx connection, no database writes. NODE_ENV is
// replaced at build time, so in any production build this is constant-false and ignored,
// even if NEXT_PUBLIC_CALLING_PREVIEW were set.
export const CALLING_PREVIEW =
  process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_CALLING_PREVIEW === "true";
export const CALLING_ENABLED = CALLING_PREVIEW || process.env.NEXT_PUBLIC_CALLING_ENABLED === "true";

export const REMOTE_AUDIO_ID = "crm-remote-audio";
export type PhoneStatus = "disabled" | "idle" | "connecting" | "ready" | "error";

type Handlers = {
  onStatus: (s: PhoneStatus, message?: string) => void;
  onCall: (call: any) => void;
};

const TOKEN_REFRESH_MS = 20 * 60 * 60 * 1000; // tokens last ~24h; refresh well before

// One Telnyx WebRTC client for the whole app. The browser only ever receives a
// short-lived login token from the telnyx-token Edge Function, never the API key.
class PhoneService {
  private client: any = null;
  private handlers: Handlers | null = null;
  private connecting = false;
  private stopped = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  callerNumber = "";
  hasActiveCall: () => boolean = () => false;

  setHandlers(h: Handlers) {
    this.handlers = h;
  }

  async connect() {
    if (!CALLING_ENABLED || CALLING_PREVIEW || this.connecting || this.client) return;
    this.connecting = true;
    this.stopped = false;
    this.handlers?.onStatus("connecting");
    try {
      const { data, error } = await supabaseBrowser.functions.invoke("telnyx-token");
      if (error || !data?.token) throw new Error(error?.message || "No phone token returned");
      this.callerNumber = data.callerNumber || "";

      const { TelnyxRTC } = await import("@telnyx/webrtc");
      const client: any = new TelnyxRTC({ login_token: data.token });
      client.remoteElement = REMOTE_AUDIO_ID;

      client.on("telnyx.ready", () => {
        this.retry = 0;
        this.handlers?.onStatus("ready");
      });
      client.on("telnyx.error", (e: any) => {
        this.handlers?.onStatus("error", e?.error?.message || e?.message || "Phone connection error");
        this.scheduleReconnect();
      });
      client.on("telnyx.socket.close", () => {
        if (!this.stopped) this.scheduleReconnect();
      });
      client.on("telnyx.notification", (n: any) => {
        if (n?.type === "callUpdate" && n.call) this.handlers?.onCall(n.call);
      });

      this.client = client;
      client.connect();
      this.refreshTimer = setTimeout(() => this.refreshToken(), TOKEN_REFRESH_MS);
    } catch (e: any) {
      this.client = null;
      this.handlers?.onStatus("error", e?.message || "Could not connect the phone");
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private teardown() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    try { this.client?.disconnect(); } catch { /* ignore */ }
    this.client = null;
  }

  // Fresh token + reconnect; never while a call is in progress.
  private refreshToken() {
    if (this.hasActiveCall()) {
      this.refreshTimer = setTimeout(() => this.refreshToken(), 60 * 1000);
      return;
    }
    this.teardown();
    this.connect();
  }

  private scheduleReconnect() {
    if (this.stopped || this.retryTimer) return;
    const delay = Math.min(60000, 2000 * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.hasActiveCall()) return this.scheduleReconnect();
      this.teardown();
      this.connect();
    }, delay);
  }

  disconnect() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.teardown();
    this.handlers?.onStatus(CALLING_ENABLED ? "idle" : "disabled");
  }

  /** Ask for the microphone with a clear message if it's denied. */
  async ensureMicrophone(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser can't access the microphone. Use Chrome or Edge over https.");
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e: any) {
      const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
      throw new Error(
        denied
          ? "Microphone access is blocked. Click the lock icon in the address bar, allow the microphone, then try again."
          : "No working microphone was found. Plug one in and try again."
      );
    }
  }

  isReady() {
    return !!this.client;
  }

  newCall(opts: { to: string; logId: string }) {
    if (CALLING_PREVIEW) throw new Error("Preview mode never places real calls.");
    if (!this.client) throw new Error("Phone is not connected yet. Wait a moment and try again.");
    return this.client.newCall({
      destinationNumber: opts.to,
      callerNumber: this.callerNumber,
      callerName: "Reset Dental Media",
      audio: true,
      remoteElement: REMOTE_AUDIO_ID,
      clientState: btoa(opts.logId),
      customHeaders: [{ name: "X-CRM-Call-Id", value: opts.logId }],
    });
  }
}

export const phoneService = new PhoneService();

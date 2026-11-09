// Phone-number + US calling-hours helpers. Pure functions, no network.

const ET = "America/New_York";
const CT = "America/Chicago";
const MT = "America/Denver";
const PT = "America/Los_Angeles";
const AZ = "America/Phoenix";
const AK = "America/Anchorage";
const HI = "Pacific/Honolulu";

// Main time zone per state (used when a contact has a state saved).
export const STATE_TZ: Record<string, string> = {
  AL: CT, AK: AK, AZ: AZ, AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET, FL: ET,
  GA: ET, HI: HI, ID: MT, IL: CT, IN: ET, IA: CT, KS: CT, KY: ET, LA: CT, ME: ET,
  MD: ET, MA: ET, MI: ET, MN: CT, MS: CT, MO: CT, MT: MT, NE: CT, NV: PT, NH: ET,
  NJ: ET, NM: MT, NY: ET, NC: ET, ND: CT, OH: ET, OK: CT, OR: PT, PA: ET, RI: ET,
  SC: ET, SD: CT, TN: CT, TX: CT, UT: MT, VT: ET, VA: ET, WA: PT, WV: ET, WI: CT, WY: MT,
};

// Backup: US area code -> time zone. Used only when a contact has no timezone/state.
// Where a state spans two zones the area code's own zone is used. Unknown codes
// (including Canadian ones) resolve to null, and the calling-hours check then blocks the call.
const AREA_GROUPS: Array<[string, string]> = [
  [ET, "201 202 203 207 212 215 216 220 223 229 234 239 240 248 252 260 267 269 272 276 301 302 304 305 313 315 317 321 326 330 332 339 347 351 352 380 386 401 404 407 410 412 413 419 423 434 440 443 445 463 470 475 478 484 502 508 513 516 517 518 540 551 561 567 570 571 574 585 586 603 606 607 609 610 614 616 617 631 640 646 656 667 678 680 681 686 689 703 704 706 716 717 718 724 727 732 734 740 743 754 757 762 765 771 772 774 781 786 802 803 804 812 813 814 828 835 838 839 843 845 848 854 856 857 859 860 862 863 864 865 878 904 906 908 910 912 914 917 919 929 930 934 937 941 943 947 954 959 973 978 980 984 989"],
  [CT, "205 214 217 218 219 224 225 228 251 254 256 262 270 273 281 309 312 314 316 318 319 320 325 331 334 337 346 361 364 402 405 409 414 417 430 432 447 448 464 469 479 501 504 507 512 515 531 534 539 563 572 573 580 601 608 612 615 618 620 629 630 636 641 651 659 660 662 682 701 708 712 713 715 726 731 737 763 769 773 779 785 806 815 816 817 830 832 847 850 870 872 901 903 913 918 920 931 936 938 940 952 956 972 975 979 985"],
  [MT, "208 303 307 385 406 435 505 575 719 720 801 915 970 983 986"],
  [PT, "206 209 213 253 279 310 323 341 350 360 369 408 415 424 425 442 458 503 509 510 530 541 559 562 564 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 820 831 840 858 909 916 925 935 949 951 971"],
  [AZ, "480 520 602 623 928"],
  [AK, "907"],
  [HI, "808"],
];

// Canadian area codes (used by the manual dialer so Canadian numbers are accepted).
const AT = "America/Halifax";
const NT = "America/St_Johns";
const SK = "America/Regina";
const YT = "America/Whitehorse";
const CANADA_GROUPS: Array<[string, string]> = [
  [ET, "226 249 263 289 343 354 365 367 416 418 437 438 450 514 519 548 579 581 613 647 705 819 873 905 942"],
  [CT, "204 431 584 807"],
  [SK, "306 474 639"],
  [MT, "368 403 587 780 825"],
  [PT, "236 250 604 672 778"],
  [AT, "506 782 902"],
  [NT, "709 879"],
  [YT, "867"],
];

const AREA_TZ: Record<string, string> = {};
const US_AREA = new Set<string>();
const CANADA_AREA = new Set<string>();
for (const [tz, codes] of AREA_GROUPS) for (const c of codes.split(" ")) { AREA_TZ[c] = tz; US_AREA.add(c); }
for (const [tz, codes] of CANADA_GROUPS) for (const c of codes.split(" ")) { AREA_TZ[c] = tz; CANADA_AREA.add(c); }

// Premium-rate prefixes that must never be dialed.
const PREMIUM_AREA = new Set(["900", "976"]);

// Flat shape (the project doesn't use strict null checks, so a discriminated union wouldn't narrow).
export type Dialable = {
  ok: boolean;
  error?: string;
  e164?: string;
  areaCode?: string;
  country?: "US" | "CA";
  timezone?: string;
};

/**
 * Validate a typed/pasted number for the manual dialer: US or Canada only, normalised to
 * +1XXXXXXXXXX. Other +1 countries (Caribbean etc.), premium prefixes and malformed numbers
 * are rejected with a plain-language reason.
 */
export function parseDialable(raw: string): Dialable {
  const text = (raw || "").trim();
  if (!text) return { ok: false, error: "Enter a phone number." };
  if (/[^\d\s().+\-]/.test(text)) return { ok: false, error: "Use digits only (spaces, dashes and brackets are fine)." };

  const hasPlus = text.startsWith("+");
  let d = text.replace(/\D/g, "");
  if (hasPlus && !d.startsWith("1")) return { ok: false, error: "Only US and Canada numbers (+1) can be dialed." };
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  else if (d.length !== 10) {
    return { ok: false, error: d.length > 10 ? "Only US and Canada numbers (+1) can be dialed." : "That number is too short. Enter 10 digits." };
  }

  const area = d.slice(0, 3);
  if (PREMIUM_AREA.has(area)) return { ok: false, error: `${area} numbers are premium-rate and can't be dialed.` };
  if (!/^[2-9]/.test(area) || !/^[2-9]/.test(d.slice(3, 6))) {
    return { ok: false, error: "That isn't a valid US/Canada number (area code and exchange can't start with 0 or 1)." };
  }
  if (!AREA_TZ[area]) {
    return { ok: false, error: `Area code ${area} isn't a US or Canada area code we can dial (other +1 countries are blocked).` };
  }
  return {
    ok: true, e164: `+1${d}`, areaCode: area,
    country: CANADA_AREA.has(area) ? "CA" : "US", timezone: AREA_TZ[area],
  };
}

/** "+1XXXXXXXXXX" for any US/Canada number, or null if it can't be one. */
export function toE164(raw: string | null | undefined): string | null {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export function areaCodeOf(raw: string | null | undefined): string | null {
  const e = toE164(raw);
  return e ? e.slice(2, 5) : null;
}

export type TzSource = "saved" | "state" | "area_code";

/** Dentist's IANA time zone: saved timezone, else state, else area code. */
export function resolveTimezone(c: {
  timezone?: string | null;
  state?: string | null;
  phone?: string | null;
}): { timezone: string; source: TzSource } | null {
  if (c.timezone) return { timezone: c.timezone, source: "saved" };
  const st = (c.state || "").toUpperCase();
  if (STATE_TZ[st]) return { timezone: STATE_TZ[st], source: "state" };
  const ac = areaCodeOf(c.phone);
  if (ac && AREA_TZ[ac]) return { timezone: AREA_TZ[ac], source: "area_code" };
  return null;
}

export const CALL_START_HOUR = 8; // 8:00am local
export const CALL_END_HOUR = 21; // 9:00pm local (calls must start before this)

/** Minutes since local midnight in the given zone. */
function localMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function isWithinCallingHours(tz: string, at: Date = new Date()): boolean {
  const mins = localMinutes(tz, at);
  return mins >= CALL_START_HOUR * 60 && mins < CALL_END_HOUR * 60;
}

export function localTimeLabel(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", weekday: "short", timeZoneName: "short",
  }).format(at);
}

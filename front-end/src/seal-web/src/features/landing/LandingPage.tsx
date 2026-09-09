import { useState, useEffect, useRef, type ReactNode, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router";
import {
  C, GradientText, PixelButton, PixelBadge,
  FloatingParticles, TerminalWindow, TypingText, CircuitLines,
} from "@/shared/components/PixelComponents";
import { useAuth } from "@/app/providers/AuthProvider";
import { eventsApi, roundsApi, resultsApi, HackathonEvent, Round, RoundResult } from "@/shared/apiClient";
import { SealFooter } from "@/shared/components/SealFooter";
import sealLogo from "@/imports/image.png";
import Hero from "@/imports/Hero.jpg"
import fptLogo from "@/imports/fpt-logo.png";
import G1 from "@/imports/Hackathon.jpg";
import G2 from "@/imports/Hackathon2.jpg";
import G3 from "@/imports/Hackathon3.jpg";
import G4 from "@/imports/Hackathon4.jpg";
import G5 from "@/imports/Hackathon5.jpg";
import G6 from "@/imports/Hackathon6.jpg";
import G7 from "@/imports/Hackathon7.jpg";

type Page = "landing" | "auth" | "register" | "dashboard" | "events" | "teams" | "submissions" | "leaderboard" | "judge" | "admin" | "profile";

type Phase = "completed" | "active" | "upcoming";

// ── Live landing data (public endpoints) ──────────────────────────
interface LandingData {
  loading: boolean;
  events: HackathonEvent[];
  current?: HackathonEvent;   // ongoing event (Summer 2026 / OPEN)
  past?: HackathonEvent;      // finished event for leaderboard (Spring 2026 / COMPLETED)
  upcoming?: HackathonEvent;  // mystery event (Fall 2026 / DRAFT)
  currentRounds: Round[];
  pastTop3: RoundResult[];
}

function useLandingData(): LandingData {
  const [data, setData] = useState<LandingData>({
    loading: true, events: [], currentRounds: [], pastTop3: [],
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const events = (await eventsApi.getAll()).data ?? [];
        const bySeason = (s: string) => events.find(e => e.season?.toUpperCase() === s);
        const byStatus = (s: string) => events.find(e => e.status === s);
        const current = bySeason("SUMMER") ?? byStatus("OPEN");
        const past = bySeason("SPRING") ?? byStatus("COMPLETED");
        const upcoming = bySeason("FALL") ?? byStatus("DRAFT");

        let currentRounds: Round[] = [];
        let pastTop3: RoundResult[] = [];

        if (current) {
          try {
            currentRounds = ((await roundsApi.getAll(current.eventId)).data ?? [])
              .sort((a, b) => a.orderNumber - b.orderNumber);
          } catch { /* keep empty */ }
        }
        if (past) {
          try {
            const rounds = (await roundsApi.getAll(past.eventId)).data ?? [];
            const finalRound = rounds.find(r => r.isFinal) ?? rounds[rounds.length - 1];
            if (finalRound) {
              const results = (await resultsApi.getPublished(past.eventId, finalRound.roundId)).data ?? [];
              pastTop3 = [...results].sort((a, b) => a.rankPosition - b.rankPosition).slice(0, 3);
            }
          } catch { /* keep empty */ }
        }

        if (!cancelled) setData({ loading: false, events, current, past, upcoming, currentRounds, pastTop3 });
      } catch {
        if (!cancelled) setData(d => ({ ...d, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return data;
}

// Map a backend event status to a terminal badge {color,label}.
// Reflects whatever the coordinator sets the event status to, live.
function eventStatusBadge(status?: string): { color: "green" | "blue" | "cyan" | "yellow" | "gray" | "red"; label: string } {
  switch (status) {
    case "OPEN": return { color: "green", label: "open" };
    case "SETUP": return { color: "cyan", label: "setup" };
    case "IN_PROGRESS": return { color: "blue", label: "in progress" };
    case "COMPLETED": return { color: "yellow", label: "completed" };
    case "DRAFT": return { color: "gray", label: "draft" };
    case "CANCELLED": return { color: "red", label: "cancelled" };
    default: return { color: "gray", label: (status ?? "—").toLowerCase() };
  }
}

// Map a backend round status to a timeline phase.
function roundPhase(status?: string): Phase {
  switch (status) {
    case "FINALIZED": return "completed";
    case "ACTIVE": return "active";
    default: return "upcoming"; // PENDING / unknown
  }
}

function fmtDate(iso?: string): string {
  if (!iso) return "TBA";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "TBA";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()} — ${hh}:${mi}`;
}

// ── Scroll / reveal primitives (landing polish) ───────────────────
// All motion below is opt-out: honours the OS "reduce motion" setting, either
// via the `.seal-reveal` / `.seal-marquee` CSS overrides or the runtime check.
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// window.scrollY, throttled to one update per animation frame (for parallax).
function useScrollY(): number {
  const [y, setY] = useState(0);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setY(window.scrollY));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return y;
}

// Fires once, the first time the element nears the viewport, then disconnects.
function useInView<T extends HTMLElement = HTMLDivElement>(
  opts: IntersectionObserverInit = { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setInView(true); io.disconnect(); }
    }, opts);
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);
  return { ref, inView };
}

type RevealDir = "up" | "down" | "left" | "right" | "scale";

function hiddenTransform(dir: RevealDir): string {
  switch (dir) {
    case "left":  return "translateX(-44px)";
    case "right": return "translateX(44px)";
    case "down":  return "translateY(-28px)";
    case "scale": return "scale(0.94)";
    default:      return "translateY(28px)";
  }
}

// Fade + directional rise, applied once on scroll-in. Settles to transform:"none"
// (not translate(0)) and never uses will-change:transform, so a revealed wrapper
// is not a containing block for the gallery lightbox's position:fixed overlay.
function Reveal({ children, delay = 0, direction = "up", sweep = false }: { children: ReactNode; delay?: number; direction?: RevealDir; sweep?: boolean }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className="seal-reveal"
      style={{
        position: "relative",
        opacity: inView ? 1 : 0,
        transform: inView ? "none" : hiddenTransform(direction),
        transition: "opacity 0.7s ease-out, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)",
        transitionDelay: `${delay}ms`,
        willChange: "opacity",
      }}
    >
      {children}
      {sweep && inView && !prefersReducedMotion() && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 6 }}>
          <div className="seal-sweep" style={{
            position: "absolute", left: 0, right: 0, top: 0, height: 2,
            background: "linear-gradient(90deg, transparent, #22c55e, #3b82f6, transparent)",
            boxShadow: "0 0 12px rgba(34,197,94,0.7), 0 0 24px rgba(59,130,246,0.4)",
          }} />
        </div>
      )}
    </div>
  );
}

// Terminal-style "decode": random glyphs settle into the real characters,
// left-to-right, the first time the text scrolls into view.
const DECODE_GLYPHS = "!<>-_\\/[]{}=+*^?#01x%&";

function scramble(text: string): string {
  let out = "";
  for (const ch of text) out += ch === " " ? " " : DECODE_GLYPHS[Math.floor(Math.random() * DECODE_GLYPHS.length)];
  return out;
}

function DecodeText({ text, durationMs = 900, style }: { text: string; durationMs?: number; style?: CSSProperties }) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const [display, setDisplay] = useState(() => (prefersReducedMotion() ? text : scramble(text)));
  const started = useRef(false);

  useEffect(() => {
    if (!inView || started.current) return;
    started.current = true;
    if (prefersReducedMotion()) { setDisplay(text); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      const settled = Math.floor(p * text.length);
      let out = "";
      for (let i = 0; i < text.length; i++) {
        out += (i < settled || text[i] === " ")
          ? text[i]
          : DECODE_GLYPHS[Math.floor(Math.random() * DECODE_GLYPHS.length)];
      }
      setDisplay(out);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDisplay(text);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, text, durationMs]);

  return <span ref={ref} style={style}>{display}</span>;
}

// Drop-in for <SectionHeader gradient> on the landing page, with a decode title.
function DecodeHeading({ title, subtitle, align = "center" }: { title: string; subtitle?: string; align?: "center" | "left" }) {
  return (
    <div style={{ textAlign: align }}>
      <h2 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "clamp(22px, 3vw, 32px)", fontWeight: 800, lineHeight: 1.2 }}>
        <GradientText><DecodeText text={title} /></GradientText>
      </h2>
      {subtitle && (
        <p style={{
          color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 14, lineHeight: 1.75,
          maxWidth: align === "center" ? 560 : "none",
          margin: align === "center" ? "14px auto 0" : "14px 0 0",
        }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

// Full-page neon wash whose hue and glow intensify with scroll depth
// (green → blue → cyan → purple) — the page "heats up" the deeper you go.
function AmbientScrollLayer() {
  const [depth, setDepth] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = document.documentElement;
        const max = el.scrollHeight - el.clientHeight;
        setDepth(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); cancelAnimationFrame(raf); };
  }, []);
  const hue = 140 + depth * 135;
  const intensity = 0.04 + depth * 0.10;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none", mixBlendMode: "screen",
      background:
        `radial-gradient(120% 80% at 50% 118%, hsla(${hue}, 90%, 55%, ${intensity}) 0%, transparent 60%),` +
        `radial-gradient(100% 60% at 50% -12%, hsla(${hue + 40}, 90%, 55%, ${intensity * 0.7}) 0%, transparent 55%)`,
      transition: "background 0.2s linear",
    }} />
  );
}

// Neon glow that trails the cursor over dark sections. Skipped on touch devices.
function CursorSpotlight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof window === "undefined" || (window.matchMedia && window.matchMedia("(hover: none)").matches)) return;
    let raf = 0, x = 0, y = 0;
    const move = (e: PointerEvent) => {
      x = e.clientX; y = e.clientY;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (ref.current) ref.current.style.background =
          `radial-gradient(circle 260px at ${x}px ${y}px, rgba(34,197,94,0.10), rgba(59,130,246,0.06) 42%, transparent 70%)`;
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { window.removeEventListener("pointermove", move); cancelAnimationFrame(raf); };
  }, []);
  return <div ref={ref} style={{ position: "fixed", inset: 0, zIndex: 2, pointerEvents: "none", mixBlendMode: "screen" }} />;
}

// Pointer-driven 3D tilt for cards. Imperative (no re-render) and reduced-motion aware.
function Tilt({ children, max = 8, style }: { children: ReactNode; max?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: ReactPointerEvent) => {
    if (prefersReducedMotion()) return;
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${-py * max}deg) rotateY(${px * max}deg)`;
  };
  const onLeave = () => { if (ref.current) ref.current.style.transform = ""; };
  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave}
      style={{ transition: "transform 0.2s ease-out", transformStyle: "preserve-3d", ...style }}>
      {children}
    </div>
  );
}

// Gallery-style neon frame around an image (corner brackets, scanlines, glow).
function NeonImageFrame({ src, label, height, borderColor = C.green }: {
  src: string; label?: string; height: number | string; borderColor?: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative", width: "100%", height, overflow: "hidden", flexShrink: 0,
        border: `1px solid ${hovered ? `${borderColor}88` : `${borderColor}33`}`,
        boxShadow: hovered
          ? `0 0 0 1px ${borderColor}22, 0 0 28px ${borderColor}44, 0 0 60px ${borderColor}18, inset 0 0 30px rgba(0,0,0,0.4)`
          : `0 0 16px ${borderColor}12, inset 0 0 20px rgba(0,0,0,0.35)`,
        transition: "border-color 0.3s, box-shadow 0.3s",
      }}
    >
      <img src={src} alt={label ?? "SEAL"} style={{
        width: "100%", height: "100%", objectFit: "cover", display: "block",
        transition: "transform 0.5s ease, filter 0.3s ease",
        transform: hovered ? "scale(1.05)" : "scale(1)",
        filter: hovered ? "brightness(1.06) contrast(1.04)" : "brightness(0.9) contrast(1)",
      }} />
      {/* Scanline overlay */}
      <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 3px)", pointerEvents: "none", zIndex: 1 }} />
      {/* Gradient vignette */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 50%)", pointerEvents: "none", zIndex: 2 }} />
      {/* Top neon line */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, zIndex: 4, background: `linear-gradient(90deg, transparent, ${borderColor}, transparent)`, opacity: hovered ? 1 : 0.4, boxShadow: hovered ? `0 0 10px ${borderColor}, 0 0 20px ${borderColor}88` : "none", transition: "opacity 0.3s, box-shadow 0.3s" }} />
      {/* Corner brackets */}
      {[
        { top: 7, left: 7, bt: true, bl: true },
        { top: 7, right: 7, bt: true, br: true },
        { bottom: 7, left: 7, bb: true, bl: true },
        { bottom: 7, right: 7, bb: true, br: true },
      ].map((c, i) => (
        <div key={i} style={{
          position: "absolute", width: 16, height: 16, zIndex: 5,
          top: c.top, left: c.left, right: c.right, bottom: c.bottom,
          borderTop: c.bt ? `2px solid ${hovered ? borderColor : `${borderColor}55`}` : undefined,
          borderBottom: c.bb ? `2px solid ${hovered ? borderColor : `${borderColor}55`}` : undefined,
          borderLeft: c.bl ? `2px solid ${hovered ? borderColor : `${borderColor}55`}` : undefined,
          borderRight: c.br ? `2px solid ${hovered ? borderColor : `${borderColor}55`}` : undefined,
          transition: "border-color 0.3s",
        }} />
      ))}
      {/* Label tag */}
      {label ? (
        <div style={{ position: "absolute", bottom: 10, left: 12, zIndex: 6, color: hovered ? borderColor : "rgba(255,255,255,0.5)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.12em", textShadow: hovered ? `0 0 8px ${borderColor}` : "none", transition: "color 0.3s, text-shadow 0.3s" }}>
          {label}
        </div>
      ) : null}
    </div>
  );
}

const sponsors = [
  { name: "TechCorp", tier: "platinum" },
  { name: "DevHub", tier: "platinum" },
  { name: "CodeLab", tier: "platinum" },
  { name: "ByteWave", tier: "platinum" },
  { name: "SyncIO", tier: "platinum" },
  { name: "NullPtr", tier: "platinum" },
  { name: "OpenSrc", tier: "platinum" },
];

const faqs = [
  { q: "Who can participate?", a: "Any student or developer 18+. Teams of 3-5 members. Students, professionals, and hobbyists are all welcome." },
  { q: "Is it free to join?", a: "Yes — participation is completely free. All you need is a registered account on this platform." },
  { q: "What can I build?", a: "Web apps, mobile apps, AI tools, dev tools, games — anything built from scratch during the hackathon window." },
  { q: "How are projects judged?", a: "Innovation, technical depth, design quality, and real-world impact — scored by a panel of expert judges per round." },
  { q: "What are the prizes?", a: "Cash prizes, cloud credits, hardware, mentorship sessions, and fast-track interviews at sponsor companies." },
  { q: "Can I use existing code?", a: "Open-source libraries and frameworks are fine. The core project must be built during the event." },
];

const features = [
  { title: "Team Registration", desc: "Build a team, pick a track, go — in minutes.", accent: C.green },
  { title: "Project Submission", desc: "Repo, demo, deck. Submitted and timestamped.", accent: C.blue },
  { title: "Multi-Round Judging", desc: "Blind, multi-round scoring. Zero spreadsheets.", accent: C.cyan },
  { title: "Live Leaderboard", desc: "Rankings that move the instant scores land.", accent: C.purple },
  { title: "Event Management", desc: "Rounds, tracks, deadlines — one console.", accent: C.blue },
  { title: "Announcements & Alerts", desc: "Instant alerts the moment anything changes.", accent: C.green },
];

// Smooth-scroll to a section on the landing page. Used by the "Event
// Registration" CTAs to drop visitors at the live Events list (role-agnostic —
// works the same whether or not they're logged in).
function scrollToLandingSection(id: string) {
  const el = document.querySelector(id);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

const NAV_LINKS = [
  { label: "Home", href: "#hero" },
  { label: "About", href: "#features" },
  { label: "Events", href: "#events" },
  { label: "Timeline", href: "#timeline" },
  { label: "Gallery", href: "#gallery" },
  { label: "FAQ", href: "#faq" },
];

function NavBar({ navigate }: { navigate: (p: Page) => void }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { isAuthenticated } = useAuth();
  const routerNavigate = useNavigate();

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 40);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function scrollTo(href: string) {
    if (href === "#hero") { window.scrollTo({ top: 0, behavior: "smooth" }); setOpen(false); return; }
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth" });
    setOpen(false);
  }

  return (
    <nav
      style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, height: 60, overflow: "visible",
        background: "rgba(7,12,15,0.88)",
        backdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(34,197,94,0.12)",
        boxShadow: "0 1px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(59,130,246,0.04)",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: C.gradientPrimary, opacity: 0.6 }} />

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: "100%" }}>
        {/* LEFT — logo + brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ height: 80, overflow: "visible", flexShrink: 0, display: "flex", alignItems: "center" }}>
            <img
              src={sealLogo}
              alt="SEAL"
              style={{ height: 160, width: "auto", objectFit: "contain", filter: "drop-shadow(0 0 8px rgba(34,197,94,0.35)) drop-shadow(0 0 16px rgba(59,130,246,0.2))" }}
            />
          </div>
          <span style={{ display: "inline-flex", alignItems: "baseline", overflow: "hidden", color: C.text, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14, letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
            <span style={{ background: C.gradientPrimary, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              SEAL
            </span>
            <span
              style={{
                display: "inline-block",
                overflow: "hidden",
                maxWidth: scrolled ? 0 : 220,
                opacity: scrolled ? 0 : 1,
                marginLeft: scrolled ? 0 : "0.4em",
                transform: scrolled ? "translateX(-16px)" : "translateX(0)",
                background: C.gradientPrimary,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                transition: "max-width 0.55s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, margin-left 0.55s cubic-bezier(0.4, 0, 0.2, 1), transform 0.55s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              Hackathon
            </span>
          </span>
        </div>

        {/* CENTER — nav links */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((item) => (
            <button
              key={item.label}
              onClick={() => scrollTo(item.href)}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.04em", textDecoration: "none", transition: "color 0.15s", padding: "4px 0", borderBottom: "2px solid transparent" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = C.green; (e.currentTarget as HTMLElement).style.borderBottomColor = C.green; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = C.textMuted; (e.currentTarget as HTMLElement).style.borderBottomColor = "transparent"; }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* RIGHT — auth buttons */}
        <div className="hidden md:flex items-center gap-3">
          {isAuthenticated ? (
            <PixelButton variant="cyber" size="sm" onClick={() => routerNavigate("/dashboard")}>Go to Dashboard</PixelButton>
          ) : (
            <>
              <PixelButton variant="ghost" size="sm" onClick={() => navigate("auth")}>Login</PixelButton>
              <PixelButton variant="cyber" size="sm" onClick={() => navigate("register")}>Register</PixelButton>
            </>
          )}
        </div>

        <button onClick={() => setOpen(!open)} className="md:hidden"
          style={{ background: "none", border: "none", color: C.green, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>
          {open ? "CLOSE" : "MENU"}
        </button>
      </div>

      {open && (
        <div style={{ background: C.surface, borderTop: `1px solid ${C.border}`, padding: "16px 24px" }} className="md:hidden flex flex-col gap-4">
          {NAV_LINKS.map((item) => (
            <button key={item.label} onClick={() => scrollTo(item.href)}
              style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 14, textAlign: "left" }}>
              {item.label}
            </button>
          ))}
          <div className="flex gap-3 mt-2">
            {isAuthenticated ? (
              <PixelButton variant="cyber" size="sm" onClick={() => routerNavigate("/dashboard")}>Go to Dashboard</PixelButton>
            ) : (
              <>
                <PixelButton variant="ghost" size="sm" onClick={() => navigate("auth")}>Login</PixelButton>
                <PixelButton variant="cyber" size="sm" onClick={() => navigate("register")}>Register</PixelButton>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}

function HeroSection({ navigate, data }: { navigate: (p: Page) => void; data: LandingData }) {
  const leaderColors = [C.green, C.blue, C.cyan];
  // Logged-in visitors already have a session — send them straight into the app
  // instead of bouncing them through the login/register screens.
  const { isAuthenticated } = useAuth();
  // Gentle parallax: the ambient glow blobs drift as the hero scrolls away.
  const scrollY = useScrollY();
  const reduced = prefersReducedMotion();
  const parallax = reduced ? "none" : `translateY(${scrollY * 0.18}px)`;
  // Cinematic scroll-away: the foreground content lifts and fades as you leave.
  const heroP = reduced ? 0 : Math.min(1, scrollY / 600);
  return (
    <section
      id="hero"
      style={{
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        paddingTop: 80,
        background: C.bg,
      }}
      className="cyber-grid-bg"
    >
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, transform: parallax, willChange: "transform" }}>
        <div style={{ position: "absolute", top: "10%", left: "5%", width: 480, height: 480, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.07) 0%, transparent 70%)" }} />
        <div style={{ position: "absolute", top: "20%", right: "8%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.07) 0%, transparent 70%)" }} />
        <div style={{ position: "absolute", bottom: "5%", left: "40%", width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle, rgba(6,182,212,0.05) 0%, transparent 70%)" }} />
      </div>

      <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 4px)", pointerEvents: "none", zIndex: 1 }} />

      <FloatingParticles count={32} className="z-0" />

      <div style={{
          maxWidth: 1200, width: "100%", margin: "0 auto", padding: "0 24px", position: "relative", zIndex: 2,
          opacity: 1 - heroP,
          transform: `translateY(${heroP * -40}px)`,
          pointerEvents: heroP > 0.85 ? "none" : "auto",
          willChange: "opacity, transform",
        }}
        className="grid md:grid-cols-2 gap-12 items-center">

        <div className="flex flex-col gap-7">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              {/* FPT logo */}
              <img src={fptLogo} alt="FPT" style={{ height: 50, width: "auto", display: "block" }} />
              <span style={{ color: "#ffffff", fontFamily: "'JetBrains Mono', monospace", fontSize: 26, fontWeight: 700, letterSpacing: "0.04em" }}>University</span>
            </div>
          </div>

          <div>
            <h1 style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 900, lineHeight: 1.05, fontSize: "clamp(38px,5.5vw,68px)", letterSpacing: "-0.025em" }}>
              <GradientText from={C.green} to={C.blue}>Software</GradientText>
              <br />
              <GradientText from={C.blue} to={C.cyan}>Engineering</GradientText>
              <br />
              <span style={{ color: C.text }}>Agile League</span>
            </h1>
          </div>

          <div className="flex flex-wrap gap-3">
            <PixelButton variant="cyber" size="lg" onClick={() => navigate(isAuthenticated ? "dashboard" : "auth")}>{isAuthenticated ? "GO TO DASHBOARD" : "GET STARTED FREE"}</PixelButton>
            <PixelButton variant="secondary" size="lg" onClick={() => scrollToLandingSection("#events")}>EVENT REGISTRATION</PixelButton>
          </div>
        </div>

        <div className="hidden md:flex flex-col gap-4 relative">
          <CircuitLines className="absolute -top-8 -right-8 w-full max-w-sm" />

          <NeonImageFrame src={Hero} height={220} borderColor={C.green} />

          <TerminalWindow title="seal-hms — live-dashboard" className="pixel-float-slow relative z-10">
            <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12, color: C.text }}>
              <div><span style={{ color: C.green }}>→</span> <span style={{ color: C.textMuted }}>auth</span> <span style={{ color: C.green }}>--login seal_admin</span></div>
              <div style={{ color: C.textMuted }}>  Authenticating... <span style={{ color: C.green }}>OK</span></div>

              <div className="mt-1"><span style={{ color: C.green }}>→</span> <span style={{ color: C.textMuted }}>events</span> <span style={{ color: C.blue }}>--list</span></div>
              <div style={{ color: C.textMuted, paddingLeft: 8 }}>
                {data.loading ? (
                  <div>  loading events...</div>
                ) : data.events.length === 0 ? (
                  <div>  no events found</div>
                ) : (
                  data.events.map((ev, i) => {
                    const b = eventStatusBadge(ev.status);
                    return (
                      <div key={ev.eventId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>[{i + 1}] {ev.name}</span>
                        <PixelBadge color={b.color}>{b.label}</PixelBadge>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-1"><span style={{ color: C.green }}>→</span> <span style={{ color: C.textMuted }}>leaderboard</span> <span style={{ color: C.cyan }}>--top 3 {data.past ? `--event "${data.past.name}"` : ""}</span></div>
              <div style={{ color: C.textMuted, paddingLeft: 8 }}>
                {data.loading ? (
                  <div>  loading results...</div>
                ) : data.pastTop3.length === 0 ? (
                  <div>  no published results</div>
                ) : (
                  data.pastTop3.map((r, i) => (
                    <div key={r.resultId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span>#{r.rankPosition} {r.teamName}</span>
                      <span style={{ color: leaderColors[i] ?? C.green }}>{r.totalScore} pts</span>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-1">
                <span style={{ color: C.green }}>→ </span>
                <span style={{ color: "rgba(134,239,172,0.4)" }}>$ </span>
                <TypingText
                  phrases={["MANAGE_EVENTS.run()", "BUILD_TEAMS.execute()", "JUDGE_PROJECTS.eval()", "WIN_PRIZES.claim()"]}
                  style={{ color: C.green }}
                />
              </div>
            </div>
          </TerminalWindow>
        </div>
      </div>
    </section>
  );
}

// A Features card: fades + rises on scroll, its top edge and corner bracket
// "draw" in a beat later, and it tilts in 3D toward the cursor while hovered.
function FeatureCard({ feat, delay }: { feat: { title: string; desc: string; accent: string }; delay: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const onMove = (e: ReactPointerEvent) => {
    if (prefersReducedMotion()) return;
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${-py * 7}deg) rotateY(${px * 7}deg) translateY(-4px)`;
    el.style.boxShadow = `0 0 30px ${feat.accent}25, 0 8px 24px rgba(0,0,0,0.4)`;
    el.style.borderColor = `${feat.accent}44`;
  };
  const onLeave = () => {
    const el = ref.current; if (!el) return;
    el.style.transform = "none";
    el.style.boxShadow = `0 0 20px ${feat.accent}0a`;
    el.style.borderColor = `${feat.accent}22`;
  };
  return (
    <div
      ref={ref}
      className="seal-reveal"
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={{
        background: C.surface,
        border: `1px solid ${feat.accent}22`,
        padding: "24px",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        opacity: inView ? 1 : 0,
        transform: inView ? "none" : "translateY(28px)",
        transition: "opacity 0.6s ease-out, transform 0.3s ease-out, box-shadow 0.2s ease, border-color 0.2s ease",
        transitionDelay: `${delay}ms`,
        boxShadow: `0 0 20px ${feat.accent}0a`,
        transformStyle: "preserve-3d",
        willChange: "transform",
      }}
    >
      {/* top edge — draws left→right a beat after the card lands */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${feat.accent}, transparent)`, opacity: 0.7, transform: inView ? "scaleX(1)" : "scaleX(0)", transformOrigin: "left", transition: "transform 0.6s ease-out", transitionDelay: `${delay + 150}ms` }} />
      {/* corner bracket — pops in last */}
      <div style={{ position: "absolute", top: 0, left: 0, width: 10, height: 10, borderTop: `2px solid ${feat.accent}`, borderLeft: `2px solid ${feat.accent}`, opacity: inView ? 0.8 : 0, transform: inView ? "scale(1)" : "scale(0.2)", transformOrigin: "top left", transition: "opacity 0.4s ease, transform 0.4s ease", transitionDelay: `${delay + 320}ms` }} />
      <div style={{ position: "absolute", bottom: -16, right: -16, width: 64, height: 64, borderRadius: "50%", background: `radial-gradient(circle, ${feat.accent}18, transparent 70%)`, pointerEvents: "none" }} />

      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ color: feat.accent, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>
          {feat.title}
        </div>
        <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.7 }}>
          {feat.desc}
        </div>
      </div>
    </div>
  );
}

function FeaturesSection() {
  return (
    <section id="features" style={{ background: C.bg, padding: "100px 0" }} className="cyber-grid-bg">
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px" }}>
        <Reveal>
          <DecodeHeading title="Everything You Need" subtitle="From signup to results — one platform." />
        </Reveal>

        <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(34,197,94,0.4), rgba(59,130,246,0.4), transparent)", margin: "40px 0" }} />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feat, i) => (
            <FeatureCard key={i} feat={feat} delay={i * 90} />
          ))}
        </div>
      </div>
    </section>
  );
}

function EventsSection({ data }: { data: LandingData }) {
  const { current, upcoming, currentRounds, loading } = data;
  const accent = C.green;
  const activeRound = currentRounds.find(r => r.status === "ACTIVE");
  const cur = eventStatusBadge(current?.status);

  // The whole ongoing card is a single link while registration is OPEN.
  // Logged-in users land on their role dashboard (RoleDashboardPage routes by role);
  // visitors go to login (which links onward to register).
  const registrationOpen = current?.status === "OPEN";
  const routerNavigate = useNavigate();
  const { isAuthenticated } = useAuth();
  function goRegister() {
    routerNavigate(isAuthenticated ? "/dashboard" : "/login");
  }

  return (
    <section id="events" style={{ background: "#070b12", padding: "100px 0", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px" }}>
        <DecodeHeading title="Events" subtitle="Explore current hackathons in progress and upcoming opportunities to compete." />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mt-16">
          {/* Ongoing — real current event */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, display: "inline-block", boxShadow: `0 0 10px ${C.green}` }} className="cyber-pulse" />
              <span style={{ color: C.green, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Ongoing</span>
            </div>
            <div className="flex flex-col gap-4">
              {loading ? (
                <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, padding: "20px 24px", border: `1px solid ${C.border}`, background: C.surface }}>Loading current event…</div>
              ) : !current ? (
                <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, padding: "20px 24px", border: `1px solid ${C.border}`, background: C.surface }}>No ongoing event right now.</div>
              ) : (
                <Tilt max={6}>
                <div
                  onClick={registrationOpen ? goRegister : undefined}
                  role={registrationOpen ? "button" : undefined}
                  tabIndex={registrationOpen ? 0 : undefined}
                  onKeyDown={registrationOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goRegister(); } } : undefined}
                  style={{
                    background: C.surface,
                    border: `1px solid ${accent}33`,
                    padding: "20px 24px",
                    position: "relative",
                    overflow: "hidden",
                    boxShadow: `0 0 20px ${accent}10`,
                    cursor: registrationOpen ? "pointer" : "default",
                  }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
                  <div style={{ position: "absolute", top: 0, left: 0, width: 10, height: 10, borderTop: `2px solid ${accent}`, borderLeft: `2px solid ${accent}`, zIndex: 7 }} />
                  <div style={{ marginBottom: 16 }}>
                    <NeonImageFrame src={G7} height={120} borderColor={accent} />
                  </div>
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="glitch-text" style={{ color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 15, fontWeight: 700 }}>{current.name}</div>
                    <PixelBadge color={cur.color}>{cur.label}</PixelBadge>
                  </div>
                  {current.topic && (
                    <div style={{ color: accent, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, marginBottom: 8, lineHeight: 1.5 }}>{current.topic}</div>
                  )}
                  <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
                    {current.season} · {current.year}{activeRound ? ` · Current round: ${activeRound.name}` : ""}
                  </div>

                  {/* Single, subtle CTA line — the whole card is the link. */}
                  {registrationOpen && (
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${accent}22`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: accent, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>Register for this event</span>
                      <span style={{ color: accent, fontFamily: "'JetBrains Mono', monospace", fontSize: 15 }}>→</span>
                    </div>
                  )}
                </div>
                </Tilt>
              )}
            </div>
          </div>

          {/* Coming Soon — mystery event */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <span style={{ width: 8, height: 8, borderRadius: 0, background: C.purple, display: "inline-block", boxShadow: `0 0 10px ${C.purple}` }} className="cyber-pulse" />
              <span style={{ color: C.purple, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Coming Soon</span>
            </div>
            <Tilt max={6}><MysteryEventCard hasEvent={!loading && !!upcoming} /></Tilt>
          </div>
        </div>
      </div>
    </section>
  );
}

// A fully-obscured "mystery" card for an undisclosed upcoming event.
function MysteryEventCard({ hasEvent }: { hasEvent: boolean }) {
  const [hovered, setHovered] = useState(false);
  const purple = C.purple;
  const block = (w: number) => (
    <span style={{
      display: "inline-block", width: w, height: 11, verticalAlign: "middle",
      background: `repeating-linear-gradient(90deg, ${purple}55 0px, ${purple}55 6px, transparent 6px, transparent 10px)`,
      filter: "blur(0.4px)",
    }} />
  );

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "linear-gradient(160deg, rgba(139,92,246,0.08), rgba(59,130,246,0.04))",
        border: `1px solid ${hovered ? `${purple}66` : `${purple}33`}`,
        padding: "28px 24px",
        position: "relative",
        overflow: "hidden",
        minHeight: 220,
        display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 14,
        boxShadow: hovered ? `0 0 30px ${purple}22, inset 0 0 40px rgba(0,0,0,0.4)` : `0 0 16px ${purple}10, inset 0 0 30px rgba(0,0,0,0.35)`,
        transition: "border-color 0.3s, box-shadow 0.3s",
      }}
    >
      {/* scanline veil */}
      <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)", pointerEvents: "none", zIndex: 1 }} />
      {/* top neon line */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${purple}, transparent)`, opacity: hovered ? 1 : 0.5, boxShadow: hovered ? `0 0 12px ${purple}` : "none", transition: "opacity 0.3s" }} />
      <div style={{ position: "absolute", top: 0, left: 0, width: 10, height: 10, borderTop: `2px solid ${purple}66`, borderLeft: `2px solid ${purple}66`, zIndex: 2 }} />

      {/* Glitch ? */}
      <div className="glitch-text" style={{
        position: "relative", zIndex: 2,
        fontFamily: "'JetBrains Mono', monospace", fontSize: 64, fontWeight: 900, lineHeight: 1,
        color: purple,
        letterSpacing: "-0.02em",
      }}>
        ?
      </div>

      {/* Masked title */}
      <div className="glitch-text" style={{ position: "relative", zIndex: 2, color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 700, letterSpacing: "0.06em" }}>
        SEAL <span style={{ color: purple }}>███</span> 20<span style={{ color: purple }}>██</span>
      </div>

      {/* Masked meta */}
      <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        <div>{block(140)}</div>
        <div>{block(180)}</div>
      </div>

      <div style={{ position: "relative", zIndex: 2, marginTop: 4 }}>
        <span style={{
          background: `${purple}14`, border: `1px solid ${purple}44`, color: purple,
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.14em", padding: "4px 14px",
        }}>
          {hasEvent ? "COMING SOON" : "TBA"}
        </span>
      </div>
    </div>
  );
}

interface Milestone { label: string; date: string; desc: string; icon: string; status: Phase; }

// Build the timeline from the real current event's lifecycle + rounds.
function buildMilestones(data: LandingData): Milestone[] {
  const ev = data.current;
  const now = Date.now();
  const ms: Milestone[] = [];

  // 1) Registration — from event status + registration window.
  let regStatus: Phase = "upcoming";
  if (ev) {
    if (ev.status === "COMPLETED") {
      regStatus = "completed";
    } else {
      const rs = new Date(ev.registrationStart).getTime();
      const re = new Date(ev.registrationEnd).getTime();
      if (!isNaN(re) && now > re) regStatus = "completed";
      else if (!isNaN(rs) && now >= rs) regStatus = "active";
      else regStatus = "upcoming";
    }
  }
  ms.push({
    label: "Registration",
    date: ev ? fmtDate(ev.registrationStart) : "TBA",
    desc: "Team sign-ups and registration window for the event.",
    icon: "📅",
    status: regStatus,
  });

  // 2) One milestone per real round, ticked by round status.
  const roundIcons = ["⭐", "⚔️", "🏁", "🎯", "🚀"];
  data.currentRounds.forEach((r, i) => {
    ms.push({
      label: r.name,
      date: fmtDate(r.startTime),
      desc: r.isFinal
        ? "Final round — top teams compete for the title."
        : "Build & submit, then judges score this round.",
      icon: roundIcons[i] ?? "⭐",
      status: roundPhase(r.status),
    });
  });

  // 3) Results & Awards — completed only when the event itself is done.
  ms.push({
    label: "Results & Awards",
    date: ev ? fmtDate(ev.endDate) : "TBA",
    desc: "Winners announced on the live leaderboard and prizes awarded.",
    icon: "🏆",
    status: ev?.status === "COMPLETED" ? "completed" : "upcoming",
  });

  return ms;
}

function TimelineSection({ data }: { data: LandingData }) {
  const timelineMilestones = buildMilestones(data);
  const N = timelineMilestones.length;
  // Fill the track up to the last completed/active node.
  const lastDone = timelineMilestones.reduce((acc, m, i) => (m.status !== "upcoming" ? i : acc), -1);
  const fillPct = lastDone >= 0 ? (lastDone / N) * 100 : 0;
  const trackLeftPct = 50 / N;
  const trackWidthPct = 100 - 100 / N;
  const scheduleSubtitle = data.current
    ? `Live schedule for ${data.current.name}`
    : "Key dates and milestones for the season";
  const neon = "#00ff88";
  const neonDim = "rgba(0,255,136,0.18)";
  const neonGlow = "0 0 8px rgba(0,255,136,0.55), 0 0 20px rgba(0,255,136,0.25)";
  const bg = "#0a0a0a";
  const trackDim = "rgba(0,255,136,0.12)";
  // Draw the neon progress track from empty → fill once the section scrolls in.
  const { ref: trackRef, inView: trackIn } = useInView<HTMLDivElement>();
  const drawn = trackIn || prefersReducedMotion();

  return (
    <section
      id="timeline"
      style={{ background: bg, padding: "100px 0", borderTop: `1px solid ${neonDim}`, borderBottom: `1px solid ${neonDim}`, position: "relative", overflow: "hidden" }}
    >
      {/* Ambient glow blobs */}
      <div style={{ position: "absolute", top: "20%", left: "5%", width: 320, height: 320, borderRadius: "50%", background: `radial-gradient(circle, rgba(0,255,136,0.04) 0%, transparent 70%)`, pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "10%", right: "8%", width: 260, height: 260, borderRadius: "50%", background: `radial-gradient(circle, rgba(0,255,136,0.04) 0%, transparent 70%)`, pointerEvents: "none" }} />

      <div ref={trackRef} style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 64 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(0,255,136,0.06)", border: `1px solid rgba(0,255,136,0.2)`, padding: "4px 14px", marginBottom: 20 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: neon, display: "inline-block", boxShadow: neonGlow }} />
            <span style={{ color: neon, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.18em" }}>EVENT_TIMELINE</span>
          </div>
          <h2 style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 900, fontSize: "clamp(24px,3.5vw,42px)", lineHeight: 1.1, background: `linear-gradient(135deg, ${neon} 0%, #22c55e 60%, #3b82f6 100%)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", marginBottom: 12 }}>
            <DecodeText text="Hackathon Schedule" />
          </h2>
          <p style={{ color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.04em" }}>
            {scheduleSubtitle}
          </p>
        </div>

        {/* Horizontal stepper (desktop) */}
        <div className="hidden lg:block">
          {/* Track line */}
          <div style={{ position: "relative", marginBottom: 0 }}>
            <div style={{ position: "absolute", top: 28, left: `${trackLeftPct}%`, right: `${trackLeftPct}%`, height: 2, background: trackDim, zIndex: 0 }} />
            {/* Filled track up to active node — draws in on scroll */}
            <div style={{ position: "absolute", top: 28, left: `${trackLeftPct}%`, width: `${drawn ? fillPct : 0}%`, height: 2, background: `linear-gradient(90deg, ${neon}, rgba(0,255,136,0.6))`, boxShadow: `0 0 8px rgba(0,255,136,0.5)`, zIndex: 1, transition: "width 1.2s cubic-bezier(0.16, 1, 0.3, 1)" }} />

            {/* Nodes */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${N},1fr)`, gap: 0 }}>
              {timelineMilestones.map((m, i) => {
                const isCompleted = m.status === "completed";
                const isActive = m.status === "active";
                const isUpcoming = m.status === "upcoming";

                const nodeColor = isCompleted ? "#22c55e" : isActive ? neon : "rgba(255,255,255,0.15)";
                const nodeBorder = isCompleted ? "#22c55e" : isActive ? neon : "rgba(255,255,255,0.18)";
                const nodeBg = isCompleted ? "rgba(34,197,94,0.15)" : isActive ? "rgba(0,255,136,0.12)" : "#111";
                const nodeShadow = isActive ? neonGlow : isCompleted ? "0 0 8px rgba(34,197,94,0.4)" : "none";
                const labelColor = isCompleted ? "#4ade80" : isActive ? neon : "rgba(255,255,255,0.35)";
                const dateColor = isCompleted ? "rgba(74,222,128,0.5)" : isActive ? "rgba(0,255,136,0.6)" : "rgba(255,255,255,0.2)";
                const descColor = isCompleted ? "rgba(255,255,255,0.45)" : isActive ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)";

                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative", zIndex: 2, padding: "0 4px" }}>
                    {/* Node circle */}
                    <div style={{
                      width: 56, height: 56,
                      borderRadius: "50%",
                      background: nodeBg,
                      border: `2px solid ${nodeBorder}`,
                      boxShadow: nodeShadow,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: isCompleted ? 18 : 20,
                      marginBottom: 16,
                      position: "relative",
                      flexShrink: 0,
                      transition: "box-shadow 0.2s",
                    }}>
                      {isCompleted ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                          <path d="M5 13l4 4L19 7" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <span style={{ filter: isActive ? `drop-shadow(0 0 6px ${neon})` : "none" }}></span>
                      )}
                      {isActive && (
                        <div style={{ position: "absolute", inset: -4, borderRadius: "50%", border: `1px solid rgba(0,255,136,0.25)`, animation: "glowPulse 2s ease-in-out infinite", pointerEvents: "none" }} />
                      )}
                    </div>

                    {/* Label */}
                    <div style={{ color: labelColor, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textAlign: "center", marginBottom: 6, lineHeight: 1.3, textShadow: isActive ? `0 0 10px ${neon}` : "none" }}>
                      {m.label.toUpperCase()}
                    </div>

                    {/* Date */}
                    <div style={{ color: dateColor, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.04em", textAlign: "center", marginBottom: 6 }}>
                      {m.date}
                    </div>

                    {/* Description */}
                    <div style={{ color: descColor, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, lineHeight: 1.6, textAlign: "center", maxWidth: 140 }}>
                      {m.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Vertical stepper (mobile / tablet) */}
        <div className="lg:hidden" style={{ position: "relative", paddingLeft: 40 }}>
          {/* Vertical track */}
          <div style={{ position: "absolute", left: 20, top: 28, bottom: 28, width: 2, background: trackDim }} />
          {/* Filled portion — draws in on scroll */}
          <div style={{ position: "absolute", left: 20, top: 28, height: `${drawn && N > 1 && lastDone >= 0 ? (lastDone / (N - 1)) * 100 : 0}%`, width: 2, background: `linear-gradient(180deg, ${neon}, rgba(0,255,136,0.5))`, boxShadow: `0 0 8px rgba(0,255,136,0.5)`, transition: "height 1.2s cubic-bezier(0.16, 1, 0.3, 1)" }} />

          <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
            {timelineMilestones.map((m, i) => {
              const isCompleted = m.status === "completed";
              const isActive = m.status === "active";

              const nodeColor = isCompleted ? "#22c55e" : isActive ? neon : "rgba(255,255,255,0.15)";
              const nodeBg = isCompleted ? "rgba(34,197,94,0.15)" : isActive ? "rgba(0,255,136,0.12)" : "#111";
              const nodeShadow = isActive ? neonGlow : isCompleted ? "0 0 8px rgba(34,197,94,0.4)" : "none";
              const labelColor = isCompleted ? "#4ade80" : isActive ? neon : "rgba(255,255,255,0.35)";
              const dateColor = isCompleted ? "rgba(74,222,128,0.5)" : isActive ? "rgba(0,255,136,0.6)" : "rgba(255,255,255,0.2)";
              const descColor = isCompleted ? "rgba(255,255,255,0.45)" : isActive ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.2)";

              return (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 20, position: "relative", zIndex: 1 }}>
                  {/* Node */}
                  <div style={{
                    width: 40, height: 40, borderRadius: "50%",
                    background: nodeBg,
                    border: `2px solid ${nodeColor}`,
                    boxShadow: nodeShadow,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                    marginLeft: -40,
                  }}>
                    {isCompleted ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M5 13l4 4L19 7" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <span style={{ fontSize: 14, filter: isActive ? `drop-shadow(0 0 4px ${neon})` : "none" }}>{m.icon}</span>
                    )}
                  </div>

                  <div>
                    <div style={{ color: labelColor, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 4, textShadow: isActive ? `0 0 10px ${neon}` : "none" }}>
                      {m.label.toUpperCase()}
                    </div>
                    <div style={{ color: dateColor, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, marginBottom: 6 }}>
                      {m.date}
                    </div>
                    <div style={{ color: descColor, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.6 }}>
                      {m.desc}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

const GALLERY = [
  { src: G1, idx: "01", borderColor: "#22c55e" },
  { src: G2, idx: "02", borderColor: "#3b82f6" },
  { src: G3, idx: "03", borderColor: "#06b6d4" },
  { src: G4, idx: "04", borderColor: "#3b82f6" },
  { src: G5, idx: "05", borderColor: "#22c55e" },
  { src: G6, idx: "06", borderColor: "#06b6d4" },
];

function GalleryPhoto({ src, idx, gridColumn, gridRow, borderColor = C.green, hovered, onMouseEnter, onMouseLeave, onClick, revealed = true, revealDelay = 0, glitchOnHover = false }: {
  src: string; idx: string; gridColumn?: string; gridRow?: string;
  borderColor?: string; hovered: boolean; onMouseEnter: () => void; onMouseLeave: () => void; onClick: () => void;
  revealed?: boolean; revealDelay?: number; glitchOnHover?: boolean;
}) {
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      className={"seal-reveal" + (revealed ? " seal-glitch-in" : "")}
      style={{
        gridColumn, gridRow, position: "relative", overflow: "hidden", cursor: "zoom-in",
        opacity: revealed ? undefined : 0,
        animationDelay: `${revealDelay}ms`,
        border: `1px solid ${hovered ? `${borderColor}88` : `${borderColor}28`}`,
        boxShadow: hovered
          ? `0 0 0 1px ${borderColor}22, 0 0 24px ${borderColor}44, 0 0 60px ${borderColor}18, inset 0 0 30px rgba(0,0,0,0.4)`
          : `0 0 12px ${borderColor}0a, inset 0 0 20px rgba(0,0,0,0.35)`,
        transition: "border-color 0.3s, box-shadow 0.3s",
      }}
    >
      <img src={src} alt={`Gallery ${idx}`} className={glitchOnHover && hovered ? "seal-img-glitch" : ""} style={{
        width: "100%", height: "100%", objectFit: "cover", display: "block",
        transition: "transform 0.5s ease, filter 0.3s ease",
        transform: hovered ? "scale(1.06)" : "scale(1)",
        filter: hovered ? "brightness(1.08) contrast(1.05)" : "brightness(0.88) contrast(1)",
      }} />

      {/* Scanline overlay */}
      <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 3px)", pointerEvents: "none", zIndex: 1 }} />

      {/* Gradient vignette */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 45%)", pointerEvents: "none", zIndex: 2 }} />

      {/* Hover colour wash */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 3,
        background: hovered ? `linear-gradient(135deg, ${borderColor}14 0%, transparent 60%)` : "transparent",
        transition: "background 0.3s",
      }} />

      {/* Top edge neon line */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2, zIndex: 4,
        background: `linear-gradient(90deg, transparent, ${borderColor}, transparent)`,
        opacity: hovered ? 1 : 0.25,
        boxShadow: hovered ? `0 0 10px ${borderColor}, 0 0 20px ${borderColor}88` : "none",
        transition: "opacity 0.3s, box-shadow 0.3s",
      }} />

      {/* Bottom edge neon line */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 1, zIndex: 4,
        background: `linear-gradient(90deg, transparent, ${borderColor}66, transparent)`,
        opacity: hovered ? 0.8 : 0.12,
        transition: "opacity 0.3s",
      }} />

      {/* Index tag */}
      <div style={{
        position: "absolute", bottom: 10, right: 12, zIndex: 5,
        color: hovered ? borderColor : "rgba(255,255,255,0.22)",
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.14em",
        textShadow: hovered ? `0 0 8px ${borderColor}, 0 0 16px ${borderColor}88` : "none",
        transition: "color 0.3s, text-shadow 0.3s",
      }}>
        /{idx}
      </div>

      {/* Corner brackets */}
      <div style={{
        position: "absolute", top: 7, left: 7, width: 16, height: 16, zIndex: 5,
        borderTop: `2px solid ${hovered ? borderColor : `${borderColor}44`}`,
        borderLeft: `2px solid ${hovered ? borderColor : `${borderColor}44`}`,
        boxShadow: hovered ? `inset 2px 2px 6px ${borderColor}33` : "none",
        transition: "border-color 0.3s, box-shadow 0.3s"
      }} />
      <div style={{
        position: "absolute", top: 7, right: 7, width: 16, height: 16, zIndex: 5,
        borderTop: `2px solid ${hovered ? borderColor : `${borderColor}44`}`,
        borderRight: `2px solid ${hovered ? borderColor : `${borderColor}44`}`,
        transition: "border-color 0.3s"
      }} />
      <div style={{
        position: "absolute", bottom: 7, left: 7, width: 16, height: 16, zIndex: 5,
        borderBottom: `2px solid ${hovered ? borderColor : `${borderColor}44`}`,
        borderLeft: `2px solid ${hovered ? borderColor : `${borderColor}44`}`,
        transition: "border-color 0.3s"
      }} />
      <div style={{
        position: "absolute", bottom: 7, right: 7, width: 16, height: 16, zIndex: 5,
        borderBottom: `2px solid ${hovered ? borderColor : `${borderColor}44`}`,
        borderRight: `2px solid ${hovered ? borderColor : `${borderColor}44`}`,
        boxShadow: hovered ? `inset -2px -2px 6px ${borderColor}33` : "none",
        transition: "border-color 0.3s, box-shadow 0.3s"
      }} />
    </div>
  );
}

function GallerySection() {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const n = GALLERY.length;
  // Photos stagger in when the bento grid scrolls into view.
  const { ref: gridRef, inView: gridIn } = useInView<HTMLDivElement>();
  const revealed = gridIn || prefersReducedMotion();

  useEffect(() => {
    if (activeIdx === null) { document.body.style.overflow = ""; return; }
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setActiveIdx(null);
      if (e.key === "ArrowRight") setActiveIdx(i => i !== null ? (i + 1) % n : null);
      if (e.key === "ArrowLeft") setActiveIdx(i => i !== null ? (i + n - 1) % n : null);
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [activeIdx, n]);

  const h = (i: number) => ({
    hovered: hoveredIdx === i,
    onMouseEnter: () => setHoveredIdx(i),
    onMouseLeave: () => setHoveredIdx(null),
    onClick: () => setActiveIdx(i),
  });

  const navBtn = (label: string, action: () => void) => (
    <button
      onClick={(e) => { e.stopPropagation(); action(); }}
      style={{
        position: "absolute", top: "50%", transform: "translateY(-50%)",
        ...(label === "‹" ? { left: 16 } : { right: 16 }),
        background: "rgba(7,12,15,0.7)",
        border: "1px solid rgba(34,197,94,0.35)",
        color: "#22c55e",
        width: 48, height: 48,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", fontSize: 26, lineHeight: 1,
        fontFamily: "'JetBrains Mono', monospace",
        transition: "all 0.18s",
        zIndex: 10,
      }}
      onMouseEnter={(e) => { const el = e.currentTarget; el.style.background = "rgba(34,197,94,0.14)"; el.style.boxShadow = "0 0 18px rgba(34,197,94,0.35)"; }}
      onMouseLeave={(e) => { const el = e.currentTarget; el.style.background = "rgba(7,12,15,0.7)"; el.style.boxShadow = "none"; }}
    >
      {label}
    </button>
  );

  return (
    <section id="gallery" style={{ background: "#060a10", padding: "100px 0", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, position: "relative", overflow: "hidden" }}>
      {/* Ambient glow blobs */}
      <div style={{ position: "absolute", top: "8%", left: "3%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.05) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "5%", right: "5%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 600, height: 300, background: "radial-gradient(ellipse, rgba(6,182,212,0.03) 0%, transparent 70%)", pointerEvents: "none" }} />

      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px", position: "relative", zIndex: 1 }}>
        <DecodeHeading title="GALLERY" subtitle="Past events, team moments, and ceremony highlights." />

        {/* Bento grid */}
        <div ref={gridRef} style={{
          marginTop: 48,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gridTemplateRows: "220px 220px 210px",
          gap: 8,
          background: "rgba(34,197,94,0.03)",
          padding: 8,
          border: "1px solid rgba(34,197,94,0.07)",
          boxShadow: "0 0 80px rgba(34,197,94,0.04), 0 0 40px rgba(59,130,246,0.04)",
        }}>
          <GalleryPhoto {...GALLERY[0]} gridColumn="1 / 3" gridRow="1 / 3" {...h(0)} revealed={revealed} revealDelay={0} glitchOnHover />
          <GalleryPhoto {...GALLERY[1]} gridColumn="3" gridRow="1"     {...h(1)} revealed={revealed} revealDelay={80} />
          <GalleryPhoto {...GALLERY[2]} gridColumn="3" gridRow="2"     {...h(2)} revealed={revealed} revealDelay={160} />
          <GalleryPhoto {...GALLERY[3]} gridColumn="1" gridRow="3"     {...h(3)} revealed={revealed} revealDelay={240} />
          <GalleryPhoto {...GALLERY[4]} gridColumn="2" gridRow="3"     {...h(4)} revealed={revealed} revealDelay={320} />
          <GalleryPhoto {...GALLERY[5]} gridColumn="3" gridRow="3"     {...h(5)} revealed={revealed} revealDelay={400} />
        </div>
      </div>

      {/* ── Lightbox ── */}
      {activeIdx !== null && (
        <div
          onClick={() => setActiveIdx(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.93)",
            backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {/* Close button */}
          <button
            onClick={(e) => { e.stopPropagation(); setActiveIdx(null); }}
            style={{
              position: "absolute", top: 18, right: 20, zIndex: 11,
              background: "rgba(7,12,15,0.8)",
              border: "1px solid rgba(34,197,94,0.45)",
              color: "#22c55e",
              width: 44, height: 44,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", fontSize: 22, lineHeight: 1,
              fontFamily: "'JetBrains Mono', monospace",
              transition: "all 0.18s",
            }}
            onMouseEnter={(e) => { const el = e.currentTarget; el.style.background = "rgba(34,197,94,0.16)"; el.style.boxShadow = "0 0 20px rgba(34,197,94,0.4)"; el.style.borderColor = "#22c55e"; }}
            onMouseLeave={(e) => { const el = e.currentTarget; el.style.background = "rgba(7,12,15,0.8)"; el.style.boxShadow = "none"; el.style.borderColor = "rgba(34,197,94,0.45)"; }}
          >
            ×
          </button>

          {/* Prev / Next */}
          {navBtn("‹", () => setActiveIdx(i => i !== null ? (i + n - 1) % n : null))}
          {navBtn("›", () => setActiveIdx(i => i !== null ? (i + 1) % n : null))}

          {/* Image */}
          <img
            src={GALLERY[activeIdx].src}
            alt={`Gallery ${GALLERY[activeIdx].idx}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "88vw", maxHeight: "82vh",
              objectFit: "contain",
              border: `1px solid ${GALLERY[activeIdx].borderColor}55`,
              boxShadow: `0 0 60px ${GALLERY[activeIdx].borderColor}22, 0 0 120px rgba(0,0,0,0.8)`,
              userSelect: "none",
              display: "block",
            }}
          />

          {/* Dot pagination */}
          <div style={{
            position: "absolute", bottom: 22, left: "50%", transform: "translateX(-50%)",
            display: "flex", alignItems: "center", gap: 8, zIndex: 11,
          }}>
            {GALLERY.map((g, i) => (
              <div
                key={i}
                onClick={(e) => { e.stopPropagation(); setActiveIdx(i); }}
                style={{
                  width: i === activeIdx ? 24 : 7, height: 7,
                  background: i === activeIdx ? GALLERY[activeIdx].borderColor : "rgba(255,255,255,0.2)",
                  cursor: "pointer",
                  transition: "all 0.22s",
                  boxShadow: i === activeIdx ? `0 0 10px ${GALLERY[activeIdx].borderColor}` : "none",
                }}
              />
            ))}
          </div>

          {/* Counter */}
          <div style={{
            position: "absolute", top: 22, left: 20, zIndex: 11,
            color: "rgba(134,239,172,0.5)",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.14em",
          }}>
            {String(activeIdx + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
          </div>
        </div>
      )}
    </section>
  );
}

function SponsorsSection() {
  return (
    <section id="sponsors" style={{ background: C.bg, padding: "80px 0" }} className="cyber-grid-bg">
      <div style={{ maxWidth: 1160, margin: "0 auto", padding: "0 24px" }}>
        <DecodeHeading title="Our Sponsors" subtitle="Backed by world-class tech companies who believe in developer talent." />
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12, marginTop: 48 }}>
          {sponsors.map((s) => {
            return (
              <div
                key={s.name}
                style={{
                  background: C.surface,
                  border: "1px solid rgba(34,197,94,0.3)",
                  padding: "14px 28px",
                  fontFamily: "'JetBrains Mono', monospace",
                  color: C.green,
                  fontSize: 14,
                  fontWeight: 700,
                  boxShadow: `0 0 16px rgba(34,197,94,0.1), 0 0 30px rgba(59,130,246,0.06)`,
                  transition: "all 0.2s ease",
                  position: "relative",
                  overflow: "hidden",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(59,130,246,0.4)";
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 0 20px rgba(59,130,246,0.15)`;
                  (e.currentTarget as HTMLElement).style.color = C.blueBright;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgba(34,197,94,0.3)";
                  (e.currentTarget as HTMLElement).style.boxShadow = `0 0 16px rgba(34,197,94,0.1), 0 0 30px rgba(59,130,246,0.06)`;
                  (e.currentTarget as HTMLElement).style.color = C.green;
                }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: C.gradientPrimary, opacity: 0.5 }} />
                {s.name}
              </div>
            );
          })}
        </div>
        <div style={{ textAlign: "center", marginTop: 32 }}>
          <span style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, letterSpacing: "0.04em" }}>
            Want to sponsor?{" "}
            <span style={{ color: C.blue, cursor: "pointer" }}>sponsors@seal-hms.io</span>
          </span>
        </div>
      </div>
    </section>
  );
}

function FAQSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <section id="faq" style={{ background: "#070b12", padding: "100px 0", borderTop: `1px solid ${C.border}` }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px" }}>
        <DecodeHeading title="Common Questions" />
        <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 4 }}>
          {faqs.map((item, i) => (
            <div
              key={i}
              style={{
                background: C.surface,
                border: `1px solid ${openIdx === i ? "rgba(59,130,246,0.3)" : C.border}`,
                transition: "border-color 0.2s",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {openIdx === i && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: C.gradientPrimary, opacity: 0.6 }} />}
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                style={{ width: "100%", background: "none", border: "none", cursor: "pointer", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
              >
                <span style={{ color: C.text, fontFamily: "'JetBrains Mono', monospace", fontSize: 14, textAlign: "left" }}>
                  <span style={{ color: C.green, fontFamily: "'JetBrains Mono', monospace" }}>Q: </span>{item.q}
                </span>
              </button>
              {openIdx === i && (
                <div style={{ padding: "0 20px 16px", borderTop: `1px solid ${C.border}` }}>
                  <p style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.8, paddingTop: 12 }}>
                    <span style={{ color: C.blue, fontFamily: "'JetBrains Mono', monospace" }}>A: </span>{item.a}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InnovationStrip() {
  const items = [
    { label: "Blockchain Verified", color: C.blue },
    { label: "Real-Time Analytics", color: C.green },
    { label: "Multi-Cloud Ready", color: C.cyan },
    { label: "Zero-Trust Security", color: C.blue },
    { label: "Live Sync Engine", color: C.cyan },
    { label: "DevOps Native", color: C.green },
  ];

  return (
    <section style={{ background: C.bg, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, overflow: "hidden", padding: "0" }}>
      <div style={{ height: 2, background: "linear-gradient(90deg, transparent, #22c55e, #3b82f6, #06b6d4, transparent)" }} />
      <div style={{ padding: "20px 0", display: "flex", gap: 0 }}>
        <div
          className="seal-marquee"
          style={{ display: "flex", gap: 0, whiteSpace: "nowrap", willChange: "transform" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.animationPlayState = "paused"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.animationPlayState = "running"; }}
        >
          {[...items, ...items].map((item, i) => (
            <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 28px", borderRight: `1px solid ${C.border}` }}>
              <span style={{ color: item.color, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ height: 2, background: "linear-gradient(90deg, transparent, #3b82f6, #22c55e, #8b5cf6, transparent)" }} />
    </section>
  );
}

function CTASection({ navigate }: { navigate: (p: Page) => void }) {
  // Same auth-aware routing as the hero CTAs — no forced re-login for an
  // already-authenticated visitor.
  const { isAuthenticated } = useAuth();
  return (
    <section
      style={{
        padding: "100px 24px",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
        background: C.bg,
      }}
      className="cyber-grid-bg"
    >
      <FloatingParticles count={18} />
      <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 600, height: 300, background: "radial-gradient(ellipse, rgba(34,197,94,0.06) 0%, rgba(59,130,246,0.04) 50%, transparent 70%)", pointerEvents: "none" }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 580, margin: "0 auto" }}>
        <h2 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "clamp(28px,4vw,52px)", fontWeight: 900, lineHeight: 1.15, marginBottom: 20, color: "white" }}>Boot Up Your<br /><GradientText from={C.green} to={C.blue}>Hackathon Journey</GradientText></h2>
        <p style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 15, lineHeight: 1.8, marginBottom: 36 }}>
          Join thousands of builders on the platform. Your next breakthrough starts with a single commit.
        </p>

        <div
          style={{
            background: "linear-gradient(#0d1117, #0d1117) padding-box, linear-gradient(135deg, #22c55e44, #3b82f644, #06b6d444) border-box",
            border: "1px solid transparent",
            padding: "28px",
            marginBottom: 24,
          }}
        >
          <div className="flex justify-center gap-3">
            <PixelButton variant="cyber" size="lg" onClick={() => navigate(isAuthenticated ? "dashboard" : "register")}>{isAuthenticated ? "GO TO DASHBOARD" : "GET STARTED FREE"}</PixelButton>
            <PixelButton variant="secondary" size="lg" onClick={() => scrollToLandingSection("#events")}>EVENT REGISTRATION</PixelButton>
          </div>
          <p style={{ color: "rgba(134,239,172,0.4)", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, marginTop: 16, letterSpacing: "0.04em" }}>
            No credit card required · Free forever · Open source
          </p>
        </div>
      </div>
    </section>
  );
}

export function LandingPage({ navigate, hideChrome = false }: { navigate: (p: Page) => void; hideChrome?: boolean }) {
  const data = useLandingData();
  return (
    <div style={{ background: C.bg, minHeight: "100vh", overflowX: "clip" }}>
      {/* When embedded in the dashboard frame, DashboardLayout already provides
          the top navbar + footer, so we skip the landing's own chrome. */}
      {!hideChrome && <AmbientScrollLayer />}
      {!hideChrome && <CursorSpotlight />}
      {!hideChrome && <NavBar navigate={navigate} />}
      {/* Hero stays immediate (above the fold); everything below reveals on scroll.
          Features & Gallery manage their own staggered reveals internally, so they
          are not wrapped here. Directions alternate to keep the descent lively. */}
      <HeroSection navigate={navigate} data={data} />
      <Reveal><InnovationStrip /></Reveal>
      <FeaturesSection />
      <Reveal direction="left" sweep><EventsSection data={data} /></Reveal>
      <Reveal direction="up" sweep><TimelineSection data={data} /></Reveal>
      <GallerySection />
      <Reveal direction="right" sweep><SponsorsSection /></Reveal>
      <Reveal direction="up" sweep><FAQSection /></Reveal>
      <Reveal direction="scale" sweep><CTASection navigate={navigate} /></Reveal>
      {!hideChrome && <SealFooter />}
    </div>
  );
}

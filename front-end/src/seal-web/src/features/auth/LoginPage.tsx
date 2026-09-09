import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  C, GradientText, PixelButton, PixelInput, FloatingParticles, TerminalWindow,
} from "@/shared/components/PixelComponents";
import { useAuth } from "@/app/providers/AuthProvider";
import { useNotifications } from "@/app/providers/NotificationProvider";
import { SealFooter } from "@/shared/components/SealFooter";
import { SocialAuthButtons } from "@/features/auth/SocialAuthButtons";
import sealLogo from "@/imports/image.png";

const PENDING_APPROVAL_MESSAGE =
  "Your account is awaiting coordinator approval. Please wait until it is approved before signing in.";

function oauthErrorMessage(errorCode: string) {
  const code = errorCode.toUpperCase();
  if (code === "ACCOUNT_NOT_APPROVED") return PENDING_APPROVAL_MESSAGE;
  if (code === "EMAIL_NOT_FOUND") {
    return "Google did not provide an email address. Please use an account with a verified email.";
  }
  if (code === "AUTHORIZATION_REQUEST_NOT_FOUND") {
    return "Google sign-in session expired. Please try signing in with Google again.";
  }
  return `Google sign-in failed (${errorCode}). Please try again or check the backend OAuth logs.`;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { login } = useAuth();
  const { addAuthToast } = useNotifications();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Surface errors coming back from the OAuth2 flow (redirected to /login?error=...).
  useEffect(() => {
    const err = searchParams.get("error");
    if (!err) return;
    setSearchParams({}, { replace: true });
    // A pending Google account is not an error — route it to the waiting page too,
    // matching the email/password flow. Other OAuth failures stay as inline errors.
    if (err.toUpperCase() === "ACCOUNT_NOT_APPROVED") {
      navigate('/pending-approval');
      return;
    }
    setError(oauthErrorMessage(err));
  }, [searchParams, navigate, setSearchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password, rememberMe);
      if (result === 'ok' || result === 'ok:select-role') {
        addAuthToast({ type: 'success', title: 'WELCOME BACK', message: `Authenticated as ${email}` });
        navigate(result === 'ok:select-role' ? '/select-role' : '/dashboard');
      } else if (result === 'pending_approval') {
        // Not an error — the account exists but isn't approved yet. Send them to the
        // dedicated waiting page (which explains the review status) instead of a red error.
        navigate('/pending-approval');
      } else if (result === 'account_inactive') {
        setError("Your account is inactive. Please contact a System Admin to be reactivated.");
      } else if (result === 'access_denied') {
        setError("Sign-in was blocked by the server. Refresh the page and try again; if it persists, contact a system administrator.");
      } else {
        setError("Invalid credentials. Please verify your email and password.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ background: C.bg, display: "flex", flexDirection: "column", minHeight: "100vh" }}>

    <div style={{ flex: 1, position: "relative", overflow: "hidden" }} className="cyber-grid-bg">
      <FloatingParticles count={30} />
      {/* Ambient blobs */}
      <div style={{ position: "absolute", top: "10%", left: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(34,197,94,0.08), transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "10%", right: "5%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.08), transparent 70%)", pointerEvents: "none" }} />

      <div style={{ position: "relative", zIndex: 2, minHeight: "100vh", display: "flex" }}>
        {/* Left panel */}
        <div className="hidden lg:flex" style={{ flex: 1, padding: 48, flexDirection: "column", justifyContent: "center", borderRight: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <div style={{ height: 100, overflow: "visible", flexShrink: 0, display: "flex", alignItems: "center" }}>
              <img src={sealLogo} alt="HMS" style={{ height: 200, width: "auto", objectFit: "contain", filter: "drop-shadow(0 0 8px rgba(34,197,94,0.4))" }} />
            </div>
            <span style={{ color: C.text, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14, letterSpacing: "0.08em" }}>
              <GradientText>HACKATHON Management System</GradientText>
            </span>
          </div>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 32, fontWeight: 900, lineHeight: 1.1 }}>
              <GradientText>OPERATIONAL</GradientText>
            </h2>
            <p style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, lineHeight: 1.7, marginTop: 12 }}>
              All systems online. Ready to authenticate hackers, judges, mentors and coordinators.
            </p>
          </div>

          <TerminalWindow title="hms-status">
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: C.text }}>
              <div><span style={{ color: C.green }}>-&gt;</span> <span style={{ color: C.textMuted }}>auth_service</span> <span style={{ color: C.green }}>ONLINE</span></div>
              <div><span style={{ color: C.green }}>-&gt;</span> <span style={{ color: C.textMuted }}>events_service</span> <span style={{ color: C.green }}>ONLINE</span></div>
              <div><span style={{ color: C.green }}>-&gt;</span> <span style={{ color: C.textMuted }}>scoring_engine</span> <span style={{ color: C.green }}>ONLINE</span></div>
              <div><span style={{ color: C.green }}>-&gt;</span> <span style={{ color: C.textMuted }}>db_cluster</span> <span style={{ color: C.green }}>5/5 NODES</span></div>
              <div style={{ marginTop: 4 }}><span style={{ color: C.blue }}>$</span> <span style={{ color: C.textMuted }}>awaiting credentials...</span></div>
            </div>
          </TerminalWindow>
        </div>

        {/* Right panel */}
        <div style={{ flex: 1, padding: 32, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
          <div style={{ width: "100%", maxWidth: 420 }}>
            <div className="lg:hidden" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24, justifyContent: "center" }}>
              <div style={{ height: 100, overflow: "visible", flexShrink: 0, display: "flex", alignItems: "center" }}>
                <img src={sealLogo} alt="HMS" style={{ height: 200, width: "auto", objectFit: "contain" }} />
              </div>
            </div>

            <div style={{ marginBottom: 28 }}>
              <h1 style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 900, fontSize: 36, lineHeight: 1.1 }}>
                <GradientText>Access Terminal</GradientText>
              </h1>
              <p style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, marginTop: 10, lineHeight: 1.7 }}>
                Authenticate to enter the hackathon console.
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <PixelInput
                label="Email"
                placeholder="you@seal.edu"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <PixelInput
                label="Password"
                placeholder="********"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                showToggle
              />

              {error && (
                <div style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.35)",
                  color: C.red,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  padding: "10px 12px",
                  letterSpacing: "0.04em",
                }}>
                  ERROR: {error}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.85"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                >
                  <div
                    onClick={() => setRememberMe(v => !v)}
                    style={{
                      width: 14,
                      height: 14,
                      border: `1px solid ${rememberMe ? C.green : C.border}`,
                      background: rememberMe ? "rgba(34,197,94,0.15)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      flexShrink: 0,
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    {rememberMe && (
                      <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                        <polyline points="1.5,4.5 3.5,6.5 7.5,2.5" stroke={C.green} strokeWidth="1.5" strokeLinecap="square" />
                      </svg>
                    )}
                  </div>
                  <span
                    onClick={() => setRememberMe(v => !v)}
                    style={{
                      color: C.textMuted,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      letterSpacing: "0.08em",
                      cursor: "pointer",
                    }}
                  >
                    REMEMBER ME
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  style={{ background: "none", border: "none", cursor: "pointer", color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.08em", padding: 0, transition: "color 0.15s" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = C.green; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = C.textMuted; }}
                >
                  FORGOT PASSWORD?
                </button>
              </div>

              <PixelButton type="submit" variant="cyber" size="lg" fullWidth disabled={submitting}>
                {submitting ? "AUTHENTICATING..." : "LOGIN"}
              </PixelButton>

              <SocialAuthButtons />
            </form>

            <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
              <div style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>
                NO ACCOUNT?{" "}
                <a
                  onClick={() => navigate('/register')}
                  style={{ color: C.green, cursor: "pointer", letterSpacing: "0.06em" }}
                >
                  REGISTER
                </a>
              </div>
              <a
                onClick={() => navigate('/')}
                style={{ color: C.textMuted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, cursor: "pointer", letterSpacing: "0.1em" }}
              >
                BACK TO HOME
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
    <SealFooter />
    </div>
  );
}

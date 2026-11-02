import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { ErrorNote, Field } from "./ui";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  title?: string;
  subtitle?: string;
}

export function AuthModal({ isOpen, onClose, onSuccess, title, subtitle }: AuthModalProps) {
  const { requestOtp, loginWithOtp } = useAuth();
  const [step, setStep] = useState<"email" | "otp">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [countdown, setCountdown] = useState(0);

  // Countdown timer for OTP resend
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  if (!isOpen) return null;

  async function handleSendOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError("");
    setNotice("");
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      return setError("Please provide a valid email address.");
    }

    setBusy(true);
    try {
      const res = await requestOtp(trimmed);
      setStep("otp");
      setCountdown(45); // 45s resend cooldown
      setNotice(res.message || "Verification code sent to your email.");
    } catch (err: any) {
      setError(err?.message || "Failed to send verification code. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError("");
    const cleanOtp = otp.trim();
    if (!cleanOtp || cleanOtp.length < 6) {
      return setError("Please enter the complete 6-digit verification code.");
    }

    setBusy(true);
    try {
      await loginWithOtp(email.trim(), cleanOtp, name.trim() || undefined);
      if (onSuccess) onSuccess();
      onClose();
      // Reset state for next time
      setStep("email");
      setOtp("");
      setError("");
      setNotice("");
    } catch (err: any) {
      setError(err?.message || "Invalid or expired verification code.");
    } finally {
      setBusy(false);
    }
  }

  function handleResetToEmail() {
    setStep("email");
    setOtp("");
    setError("");
    setNotice("");
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="brand" style={{ fontSize: "15px" }}>
            <span className="logo" style={{ width: "24px", height: "24px", fontSize: "12px" }}>R</span>
            ResumeRise AI
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close modal">✕</button>
        </div>

        <div className="modal-body">
          <h2 id="auth-modal-title" style={{ fontSize: "22px", fontWeight: 700, color: "var(--charcoal)", marginBottom: "6px" }}>
            {step === "email" ? (title || "Sign in to ResumeRise") : "Enter verification code"}
          </h2>
          <p className="sub" style={{ marginBottom: "20px" }}>
            {step === "email"
              ? (subtitle || "Sign in to save your ATS analyses, manage email job alerts, and access your career toolkit.")
              : `We sent a 6-digit one-time code to ${email}.`}
          </p>

          <ErrorNote message={error} />

          {notice && (
            <div className="alert alert-info" style={{ marginBottom: "16px" }} role="status">
              {notice}
            </div>
          )}

          {step === "email" ? (
            <form onSubmit={handleSendOtp} className="col">
              <Field label="Your email address" htmlFor="auth-email">
                <input
                  id="auth-email"
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  required
                />
              </Field>

              <Field label="Name (optional)" htmlFor="auth-name">
                <input
                  id="auth-name"
                  type="text"
                  className="input"
                  placeholder="Your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>

              <button type="submit" className="btn" disabled={busy} style={{ width: "100%", marginTop: "8px" }}>
                {busy ? "Sending code…" : "Send verification code"}
              </button>

              <p className="sub" style={{ fontSize: "12px", textAlign: "center", marginTop: "4px" }}>
                Passwordless login. We'll send a one-time code to verify your identity.
              </p>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="col">
              <Field label="6-digit verification code (OTP)" htmlFor="auth-otp">
                <input
                  id="auth-otp"
                  type="text"
                  maxLength={6}
                  className="input mono"
                  style={{
                    fontSize: "24px",
                    letterSpacing: "8px",
                    textAlign: "center",
                    fontWeight: 700,
                  }}
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                  required
                />
              </Field>

              <button type="submit" className="btn" disabled={busy || otp.length < 6} style={{ width: "100%", marginTop: "8px" }}>
                {busy ? "Verifying…" : "Verify & Sign in"}
              </button>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", fontSize: "13px" }}>
                <button
                  type="button"
                  className="link-btn"
                  onClick={handleResetToEmail}
                  style={{ background: "none", border: "none", color: "var(--graphite)", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                >
                  ← Change email
                </button>

                <button
                  type="button"
                  className="link-btn"
                  disabled={countdown > 0 || busy}
                  onClick={() => handleSendOtp()}
                  style={{
                    background: "none",
                    border: "none",
                    color: countdown > 0 ? "var(--grey-500)" : "var(--charcoal)",
                    cursor: countdown > 0 ? "default" : "pointer",
                    fontWeight: 500,
                    padding: 0,
                  }}
                >
                  {countdown > 0 ? `Resend code in ${countdown}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}


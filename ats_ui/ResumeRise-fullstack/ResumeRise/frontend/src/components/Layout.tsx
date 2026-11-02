import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { getHealth } from "../api";
import { lsClearExpired, clearAllPersistence, lsGet } from "../persistence";
import { useAuth } from "../context/AuthContext";
import { AuthModal } from "./AuthModal";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/ats", label: "ATS Scoring", end: false },
  { to: "/jobs", label: "Job Discovery", end: false },
];

/** Check if any AI results are currently saved in localStorage. */
function hasSavedData(): boolean {
  return lsGet("ats.analysis") !== null || lsGet("ats.optimized") !== null || lsGet("jobs.data") !== null;
}

export default function Layout() {
  const { user, isAuthenticated, logout } = useAuth();
  const [keyMissing, setKeyMissing] = useState(false);
  const [savedData, setSavedData] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  useEffect(() => {
    // Prune expired localStorage entries on every app load
    lsClearExpired();
    // Check if there's saved data to show the restore hint
    setSavedData(hasSavedData());

    getHealth().then((h) => setKeyMissing(!h.llm_key_configured)).catch(() => {});
  }, []);

  function handleClearData() {
    clearAllPersistence();
    setSavedData(false);
    setCleared(true);
    // Brief confirmation, then hide the notice
    setTimeout(() => setCleared(false), 3000);
    // Reload so all hooks re-init to defaults
    window.location.reload();
  }

  const initial = user?.name ? user.name[0] : user?.email ? user.email[0] : "U";

  return (
    <>
      <header className="nav">
        <NavLink to="/" className="brand">
          <span className="logo" aria-hidden="true">R</span>
          ResumeRise AI
        </NavLink>
        <nav aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "on" : "")}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="auth-nav-group">
          {/* Clear saved data button — only shown when data exists */}
          {savedData && (
            <button
              className="btn secondary btn-sm"
              onClick={handleClearData}
              title="Remove all saved analysis results, form inputs and preferences from this browser"
            >
              Clear saved data
            </button>
          )}

          {/* Account status: Logged in vs Logged out */}
          {isAuthenticated && user ? (
            <div className="auth-nav-group">
              <div className="user-pill" title={`Signed in as ${user.email}`}>
                <span className="user-avatar">{initial}</span>
                <span className="user-email">{user.email}</span>
              </div>
              <button
                className="btn secondary btn-sm"
                onClick={() => logout()}
                title="Sign out of your account"
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              className="btn btn-sm"
              onClick={() => setAuthModalOpen(true)}
              title="Sign in with your email and OTP"
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {/* Key missing warning */}
      {keyMissing && (
        <div className="banner" role="alert">
          Gemini API key is not configured on the server. Add GEMINI_API_KEY to .env and restart.
        </div>
      )}

      {/* Session restore notice */}
      {!keyMissing && savedData && !cleared && (
        <div className="banner banner-info" role="status">
          ✓ Previous session restored — your analysis results and form inputs are saved in this browser.
        </div>
      )}

      {/* Cleared confirmation */}
      {cleared && (
        <div className="banner banner-ok" role="status">
          All saved data cleared.
        </div>
      )}

      <main className="page">
        <Outlet />
      </main>

      {/* Account Login / Verification Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
      />
    </>
  );
}

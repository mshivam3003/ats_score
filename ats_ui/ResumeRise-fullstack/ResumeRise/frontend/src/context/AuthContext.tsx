import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { UserProfile } from "../types";
import { getMe, logoutApi, sendOtp, verifyOtp } from "../api";
import { getCookie, setCookie, deleteCookie } from "../persistence";

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  requestOtp: (email: string) => Promise<{ ok: boolean; message: string; devNotice?: string }>;
  loginWithOtp: (email: string, otp: string, name?: string) => Promise<UserProfile>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = "rr_auth_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    return getCookie(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
  });
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate user profile on initial load if token exists
  useEffect(() => {
    const existingToken = getCookie(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
    if (!existingToken) {
      setIsLoading(false);
      return;
    }

    getMe(existingToken)
      .then((res) => {
        if (res.ok && res.user) {
          setUser(res.user);
          setToken(existingToken);
        } else {
          // Token invalid, clear it
          handleClearAuth();
        }
      })
      .catch(() => {
        handleClearAuth();
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  function handleClearAuth() {
    setUser(null);
    setToken(null);
    deleteCookie(TOKEN_KEY);
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch { /* noop */ }
  }

  async function requestOtp(email: string) {
    return await sendOtp(email);
  }

  async function loginWithOtp(email: string, otp: string, name?: string): Promise<UserProfile> {
    const res = await verifyOtp(email, otp, name);
    if (!res.ok || !res.user || !res.token) {
      throw new Error(res.error || "Failed to sign in. Please verify your OTP.");
    }

    setUser(res.user);
    setToken(res.token);

    // Save token in cookie (7 days) and localStorage
    setCookie(TOKEN_KEY, res.token, 7 * 24 * 60 * 60);
    try {
      localStorage.setItem(TOKEN_KEY, res.token);
    } catch { /* noop */ }

    return res.user;
  }

  async function logout() {
    try {
      await logoutApi();
    } catch { /* noop */ }
    handleClearAuth();
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: Boolean(user),
        requestOtp,
        loginWithOtp,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}


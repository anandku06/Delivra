"use client";

import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "@/lib/auth-context";
import { useState } from "react";
import toast from "react-hot-toast";

export function LoginPage() {
  const { login } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleGoogleSuccess = async (credentialResponse: { credential?: string }) => {
    if (!credentialResponse.credential) {
      toast.error("No credential received from Google");
      return;
    }

    setIsLoggingIn(true);
    try {
      await login(credentialResponse.credential);
      toast.success("Welcome to Delivra!");
    } catch {
      toast.error("Login failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface-50 via-white to-brand-50/30">
      {/* Decorative background shapes */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-brand-200/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent-200/15 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-100/10 rounded-full blur-3xl" />
      </div>

      <div className="relative animate-slide-up w-full max-w-md mx-4">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-[0_8px_40px_-12px_rgb(0_0_0/0.12)] border border-border-light p-10">
          {/* Logo */}
          <div className="flex justify-center mb-8">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-brand-600 rounded-xl flex items-center justify-center shadow-[0_4px_12px_-2px_rgb(16_185_129/0.4)]">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <span className="text-2xl font-bold text-foreground tracking-tight">
                Delivra
              </span>
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-foreground mb-2">Login</h1>
            <p className="text-muted text-sm">
              Sign in to manage your email campaigns
            </p>
          </div>

          {/* Google Login Button */}
          <div className="flex justify-center mb-6" id="google-login-button">
            {isLoggingIn ? (
              <div className="flex items-center gap-3 px-6 py-3.5 bg-surface-50 border border-border rounded-xl">
                <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-muted">Signing in...</span>
              </div>
            ) : (
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => toast.error("Google login failed")}
                theme="outline"
                size="large"
                width="340"
                text="continue_with"
                shape="pill"
              />
            )}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted font-medium">OR</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Secondary CTA */}
          <button
            disabled
            className="w-full py-3.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white font-semibold text-sm rounded-xl
                       opacity-80 cursor-not-allowed"
          >
            Sign in with Google above to continue
          </button>

          {/* Footer text */}
          <p className="text-center text-xs text-muted mt-6">
            By continuing, you agree to our Terms of Service
          </p>
        </div>

        {/* Bottom tagline */}
        <p className="text-center text-xs text-muted/60 mt-6">
          Powered by ReachInbox · Outbox Labs
        </p>
      </div>
    </div>
  );
}

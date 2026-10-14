"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type RoleLoginCardProps = {
  role: "driver" | "passenger";
  title: string;
  subtitle: string;
  accentClass: string;
};

export default function RoleLoginCard({
  role,
  title,
  subtitle,
  accentClass,
}: RoleLoginCardProps) {
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);

    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?role=${role}`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });

      if (oauthError) throw oauthError;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Google sign-in failed. Please try again.");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-800/80 p-6 shadow-2xl backdrop-blur-sm">
      <div className={`mb-4 h-1.5 w-14 rounded-full ${accentClass}`} />
      <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
      <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      <button
        type="button"
        onClick={handleSignIn}
        className="mt-5 w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-slate-900 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
      >
        Continue with Google
      </button>
      {error && (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
          {error}
        </div>
      )}
    </div>
  );
}

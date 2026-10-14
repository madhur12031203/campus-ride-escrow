"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import VideoBackground from "@/components/VideoBackground";
import { createClient } from "@/lib/supabase/client";

const AUTH_CHECK_TIMEOUT_MS = 6000;

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), AUTH_CHECK_TIMEOUT_MS);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const supabase = createClient();
      void withTimeout(
        supabase.auth.getUser(),
        "Login check timed out. Check your internet connection and Supabase settings."
      )
        .then(({ data }) => {
          if (data.user) {
            router.replace("/");
          }
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Unable to check login status.");
        });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to check login status.");
    }
  }, [router]);

  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center px-6">
      <VideoBackground />
      <div className="relative z-10 w-full max-w-3xl rounded-lg border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/30 backdrop-blur sm:p-8">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-lg border border-teal-400/25 bg-teal-400/10 text-sm font-black text-teal-200">
          CR
        </div>
        <h1 className="text-center text-3xl font-semibold text-slate-100">Campus Ride</h1>
        <p className="mt-2 text-center text-sm text-slate-400">
          Choose your workflow to continue.
        </p>

        {error && (
          <div className="mt-6 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link
            href="/login/driver"
            className="min-h-[138px] rounded-lg border border-cyan-500/25 bg-cyan-500/10 p-5 transition hover:border-cyan-300/50 hover:bg-cyan-500/15"
          >
            <p className="text-lg font-semibold text-cyan-100">Login as Driver</p>
            <p className="mt-1 text-sm text-cyan-200/80">
              Accept nearby passenger requests or publish your own route.
            </p>
          </Link>
          <Link
            href="/login/passenger"
            className="min-h-[138px] rounded-lg border border-teal-500/25 bg-teal-500/10 p-5 transition hover:border-teal-300/50 hover:bg-teal-500/15"
          >
            <p className="text-lg font-semibold text-emerald-100">Login as Passenger</p>
            <p className="mt-1 text-sm text-emerald-200/80">
              Request rides, book listed trips, and pay through escrow.
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}

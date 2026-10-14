/**
 * Check if current user is admin. Used by Navbar to show Admin link.
 */

import { createServerClient } from "@supabase/ssr";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const isAdmin =
    !!user?.email && adminEmails.includes(user.email.toLowerCase());

  return NextResponse.json({ isAdmin });
}

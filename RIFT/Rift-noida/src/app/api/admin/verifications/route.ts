/**
 * Admin API: List pending verifications.
 * Protected by ADMIN_EMAILS env var (comma-separated list).
 * Uses cookies for auth (same-origin requests from admin page).
 */

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import {
  getSupabasePublishableKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/supabase/env";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(email: string | undefined): boolean {
  if (!email) return false;
  return adminEmails.includes(email.toLowerCase());
}

export async function GET(request: Request) {
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

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(user.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending";

  const serviceSupabase = createClient(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
  );

  // Fetch verifications with user info
  const { data: verificationsData, error: verificationsError } = await serviceSupabase
    .from("user_verifications")
    .select(`
      id,
      user_id,
      document_type,
      document_url,
      status,
      created_at,
      reviewed_at,
      users(id, name)
    `)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (verificationsError) {
    return NextResponse.json({ error: verificationsError.message }, { status: 500 });
  }

  // Fetch user emails from auth.users (requires service role)
  const userIds = (verificationsData || []).map((v) => v.user_id);
  const emailsByUserId: Record<string, string> = {};

  if (userIds.length > 0) {
    // Query auth.users via admin API (service role can access auth schema)
    const { data: authUsers, error: authError } = await serviceSupabase.auth.admin.listUsers();
    if (!authError && authUsers?.users) {
      authUsers.users.forEach((authUser) => {
        if (authUser.email && userIds.includes(authUser.id)) {
          emailsByUserId[authUser.id] = authUser.email;
        }
      });
    }
  }

  // Combine verification data with emails (flatten structure)
  const verifications = (verificationsData || []).map((v) => ({
    id: v.id,
    user_id: v.user_id,
    document_type: v.document_type,
    document_url: v.document_url,
    status: v.status,
    created_at: v.created_at,
    reviewed_at: v.reviewed_at,
    user_email: emailsByUserId[v.user_id] || null,
    user_name: Array.isArray(v.users) ? (v.users[0]?.name ?? null) : null,
  }));

  return NextResponse.json({ verifications });
}

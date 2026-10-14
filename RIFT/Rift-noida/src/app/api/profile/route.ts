import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getSupabasePublishableKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/supabase/env";

type ProfileBody = {
  role?: string | null;
  walletAddress?: string | null;
};

const VALID_ROLES = new Set(["driver", "passenger"]);

async function getAuthUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Route handlers can set cookies; keep this defensive for shared runtime behavior.
        }
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return user;
}

export async function GET() {
  const user = await getAuthUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const serviceSupabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const name =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.email ? user.email.split("@")[0] : "Campus Rider");

  const { error: upsertError } = await serviceSupabase.from("users").upsert(
    {
      id: user.id,
      name,
    },
    { onConflict: "id" }
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const { data, error } = await serviceSupabase
    .from("users")
    .select("id,name,role,wallet_address,rating_avg,rating_count")
    .eq("id", user.id)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}

export async function PATCH(request: Request) {
  const user = await getAuthUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ProfileBody;
  const updates: { role?: string; wallet_address?: string | null } = {};

  if (body.role !== undefined) {
    if (!body.role || !VALID_ROLES.has(body.role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    updates.role = body.role;
  }

  if (body.walletAddress !== undefined) {
    updates.wallet_address = body.walletAddress?.trim() || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No profile updates provided." }, { status: 400 });
  }

  const serviceSupabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await serviceSupabase
    .from("users")
    .update(updates)
    .eq("id", user.id)
    .select("id,name,role,wallet_address,rating_avg,rating_count")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}

import { createServerClient } from "@supabase/ssr";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabase/env";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const selectedRole = requestUrl.searchParams.get("role");
  const role = selectedRole === "driver" || selectedRole === "passenger" ? selectedRole : null;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
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
            // Ignore when called from a context that cannot set cookies
          }
        },
      },
    }
  );

  if (code) {
    // Handle OAuth callback
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Get current user (works for both OAuth and email/password)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const name =
      (user.user_metadata?.full_name as string | undefined) ??
      (user.email ? user.email.split("@")[0] : "Campus Rider");

    // Upsert user profile with role (only update role if provided)
    const updateData: { id: string; name: string; role?: string } = {
      id: user.id,
      name,
    };
    
    if (role) {
      updateData.role = role;
    }

    await supabase.from("users").upsert(updateData, { onConflict: "id" });
  }

  return NextResponse.redirect(requestUrl.origin);
}

/**
 * Admin API: Get signed URL for document preview.
 * Document is in private storage; signed URL allows temporary access.
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;

  const serviceSupabase = createClient(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
  );

  const { data: verification, error: fetchError } = await serviceSupabase
    .from("user_verifications")
    .select("document_url")
    .eq("id", id)
    .single();

  if (fetchError || !verification) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: signed, error: signedError } = await serviceSupabase.storage
    .from("verification-documents")
    .createSignedUrl(verification.document_url, 3600); // 1 hour

  if (signedError) {
    return NextResponse.json({ error: signedError.message }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}

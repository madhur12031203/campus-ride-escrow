import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/supabase/env";

type SignUpBody = {
  email?: string;
  password?: string;
  name?: string;
  role?: string;
};

const VALID_ROLES = new Set(["driver", "passenger"]);

async function findUserByEmail(
  supabase: SupabaseClient,
  email: string
) {
  const normalizedEmail = email.toLowerCase();

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    });

    if (error) throw error;

    const user = data.users.find(
      (candidate) => candidate.email?.toLowerCase() === normalizedEmail
    );
    if (user) return user;
    if (data.users.length < 100) return null;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    let body: SignUpBody;

    try {
      body = (await request.json()) as SignUpBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";
    const role = body.role;
    const name = body.name?.trim() || email?.split("@")[0] || "Campus Rider";

    if (!email || !password || password.length < 6) {
      return NextResponse.json(
        { error: "Email and a password of at least 6 characters are required." },
        { status: 400 }
      );
    }

    if (!role || !VALID_ROLES.has(role)) {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }

    const supabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const existingUser = await findUserByEmail(supabase, email);

    if (existingUser) {
      if (!existingUser.email_confirmed_at) {
        const { error: updateError } = await supabase.auth.admin.updateUserById(
          existingUser.id,
          { email_confirm: true }
        );

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
      }

      const { error: profileError } = await supabase.from("users").upsert(
        {
          id: existingUser.id,
          name,
          role,
        },
        { onConflict: "id" }
      );

      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 500 });
      }

      return NextResponse.json({ userId: existingUser.id, existing: true });
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name,
      },
    });

    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message || "Unable to create account." },
        { status: 500 }
      );
    }

    const { error: profileError } = await supabase.from("users").upsert(
      {
        id: data.user.id,
        name,
        role,
      },
      { onConflict: "id" }
    );

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    return NextResponse.json({ userId: data.user.id, existing: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create account.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

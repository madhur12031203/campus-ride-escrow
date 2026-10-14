import { createClient } from "@/lib/supabase/client";
import type {
  BookingRow,
  BookingStatus,
  RideRequestRow,
  RideRow,
  UserProfileRow,
  UserRole,
} from "@/types";

const supabase = createClient();

export async function getCurrentAuthUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function ensureUserProfile(walletAddress?: string | null) {
  const profileResponse = await fetch("/api/profile", {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (profileResponse.status === 401) return null;

  const profileJson = (await profileResponse.json()) as {
    profile?: UserProfileRow;
    error?: string;
  };

  if (!profileResponse.ok || !profileJson.profile) {
    throw new Error(profileJson.error || "Failed to load profile");
  }

  if (walletAddress !== undefined && profileJson.profile.wallet_address !== walletAddress) {
    return updateWalletAddress(profileJson.profile.id, walletAddress ?? null);
  }

  return profileJson.profile;
}

export async function updateRole(userId: string, role: UserRole) {
  void userId;
  const response = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  const json = (await response.json()) as { profile?: UserProfileRow; error?: string };
  if (!response.ok || !json.profile) {
    throw new Error(json.error || "Failed to save role");
  }
  return json.profile;
}

export async function updateWalletAddress(userId: string, walletAddress: string | null) {
  void userId;
  const response = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
  });
  const json = (await response.json()) as { profile?: UserProfileRow; error?: string };
  if (!response.ok || !json.profile) {
    throw new Error(json.error || "Failed to save wallet");
  }
  return json.profile;
}

export async function createRideOffer(input: {
  driverId: string;
  source: string;
  destination: string;
  availableSeats: number;
}) {
  const { data, error } = await supabase
    .from("rides")
    .insert({
      driver_id: input.driverId,
      source: input.source,
      destination: input.destination,
      available_seats: input.availableSeats,
      status: "open",
    })
    .select("id,driver_id,source,destination,available_seats,status")
    .single();
  if (error) throw error;
  return data as RideRow;
}

export async function listOpenRides() {
  const { data, error } = await supabase
    .from("rides")
    .select("id,driver_id,source,destination,available_seats,status")
    .eq("status", "open")
    .order("id", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RideRow[];
}

export async function createRideRequest(input: {
  passengerId: string;
  source: string;
  destination: string;
  fareEstimate: number;
}) {
  const { data, error } = await supabase
    .from("ride_requests")
    .insert({
      passenger_id: input.passengerId,
      source: input.source,
      destination: input.destination,
      fare_estimate: input.fareEstimate,
      status: "waiting",
    })
    .select("id,passenger_id,source,destination,fare_estimate,status")
    .single();
  if (error) throw error;
  return data as RideRequestRow;
}

export async function listWaitingRideRequests() {
  const { data, error } = await supabase
    .from("ride_requests")
    .select("id,passenger_id,source,destination,fare_estimate,status")
    .eq("status", "waiting")
    .order("id", { ascending: false });
  if (error) throw error;
  return (data ?? []) as RideRequestRow[];
}

export async function createBooking(input: {
  driverId: string;
  passengerId: string;
  rideId?: string | null;
  fare: number;
  algorandAppId?: number | null;
}) {
  const { data, error } = await supabase
    .from("bookings")
    .insert({
      driver_id: input.driverId,
      passenger_id: input.passengerId,
      ride_id: input.rideId ?? null,
      fare: input.fare,
      status: "pending",
      algorand_app_id: input.algorandAppId ?? null,
    })
    .select(
      "id,driver_id,passenger_id,ride_id,fare,status,algorand_app_id,escrow_txn_id"
    )
    .single();
  if (error) throw error;
  return data as BookingRow;
}

export async function updateRideRequestStatus(requestId: string, status: string) {
  const { error } = await supabase
    .from("ride_requests")
    .update({ status })
    .eq("id", requestId);
  if (error) throw error;
}

export async function updateRideStatus(rideId: string, status: string) {
  const { error } = await supabase.from("rides").update({ status }).eq("id", rideId);
  if (error) throw error;
}

export async function updateBookingStatus(bookingId: string, status: BookingStatus) {
  const { error } = await supabase.from("bookings").update({ status }).eq("id", bookingId);
  if (error) throw error;
}

export async function setEscrowTxn(bookingId: string, escrowTxnId: string) {
  const { error } = await supabase
    .from("bookings")
    .update({ escrow_txn_id: escrowTxnId })
    .eq("id", bookingId);
  if (error) throw error;
}

export async function listMyBookings(userId: string, role: UserRole) {
  const column = role === "driver" ? "driver_id" : "passenger_id";
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id,driver_id,passenger_id,ride_id,fare,status,algorand_app_id,escrow_txn_id"
    )
    .eq(column, userId)
    .order("id", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BookingRow[];
}

export async function submitRating(input: {
  fromUserId: string;
  toUserId: string;
  bookingId: string;
  rating: number;
  comment?: string;
}) {
  const { error: insertError } = await supabase.from("ratings").upsert(
    {
      from_user_id: input.fromUserId,
      to_user_id: input.toUserId,
      booking_id: input.bookingId,
      rating: input.rating,
      comment: input.comment ?? null,
    },
    { onConflict: "from_user_id,to_user_id,booking_id" }
  );
  if (insertError) throw insertError;

  const { data: ratingRows, error: ratingError } = await supabase
    .from("ratings")
    .select("rating")
    .eq("to_user_id", input.toUserId);
  if (ratingError) throw ratingError;

  const values = (ratingRows ?? []).map((row) => Number(row.rating || 0));
  const ratingCount = values.length;
  const ratingAvg =
    ratingCount > 0
      ? Number((values.reduce((sum, value) => sum + value, 0) / ratingCount).toFixed(2))
      : 0;

  const { error: userUpdateError } = await supabase
    .from("users")
    .update({ rating_avg: ratingAvg, rating_count: ratingCount })
    .eq("id", input.toUserId);
  if (userUpdateError) throw userUpdateError;
}

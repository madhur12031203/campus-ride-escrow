"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  acceptRide,
  driverHasActiveRide,
  fetchDriverActiveRide,
  fetchWaitingRideBookings,
  haversineDistanceKm,
  subscribeToRideBookings,
} from "@/lib/supabase/rideBookings";
import type { RideBookingRow } from "@/types";

const MAX_DISTANCE_KM = 8;
type RideWithDistance = RideBookingRow & { distanceKm: number };

type RealtimeRideListProps = {
  driverLat: number;
  driverLng: number;
  isBusy: boolean;
  onCompleteRide: (ride: RideBookingRow) => Promise<void>;
  paymentMessage?: string | null;
  driverWalletAddress: string | null;
  onToast: (message: string, tone?: "success" | "info" | "error") => void;
};

export default function RealtimeRideList({
  driverLat,
  driverLng,
  isBusy,
  onCompleteRide,
  paymentMessage,
  driverWalletAddress,
  onToast,
}: RealtimeRideListProps) {
  const [rides, setRides] = useState<RideWithDistance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [activeRide, setActiveRide] = useState<RideBookingRow | null>(null);
  const [blockedByActiveRide, setBlockedByActiveRide] = useState(false);
  const [rejectedRideIds, setRejectedRideIds] = useState<string[]>([]);

  const refreshDriverRideState = useCallback(
    async (nextDriverId: string) => {
      const [hasActive, ride] = await Promise.all([
        driverHasActiveRide(nextDriverId),
        fetchDriverActiveRide(nextDriverId),
      ]);
      setBlockedByActiveRide(hasActive);
      setActiveRide(ride);
    },
    []
  );

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      setDriverId(data.user.id);
      void refreshDriverRideState(data.user.id).catch(() => {
        setError("Failed to load current ride");
      });
    });
  }, [refreshDriverRideState]);

  const addRideWithDistance = useCallback(
    (ride: RideBookingRow) => {
      if (ride.status !== "waiting" || ride.driver_id) return;
      if (rejectedRideIds.includes(ride.id)) return;
      const distanceKm = haversineDistanceKm(
        driverLat,
        driverLng,
        ride.origin_lat,
        ride.origin_lng
      );
      if (distanceKm > MAX_DISTANCE_KM) return;
      setRides((prev) => {
        if (prev.some((value) => value.id === ride.id)) return prev;
        return [{ ...ride, distanceKm }, ...prev].sort((a, b) => a.distanceKm - b.distanceKm);
      });
    },
    [driverLat, driverLng, rejectedRideIds]
  );

  const handleRideUpdate = useCallback(
    (ride: RideBookingRow) => {
      setRides((prev) => prev.filter((value) => value.id !== ride.id));
      if (driverId && ride.driver_id === driverId) {
        void refreshDriverRideState(driverId).catch(() => undefined);
      }
    },
    [driverId, refreshDriverRideState]
  );

  useEffect(() => {
    setError(null);
    setLoading(true);
    fetchWaitingRideBookings()
      .then((data) => {
        const withDistance = data
          .map((ride) => ({
            ...ride,
            distanceKm: haversineDistanceKm(
              driverLat,
              driverLng,
              ride.origin_lat,
              ride.origin_lng
            ),
          }))
          .filter((ride) => !rejectedRideIds.includes(ride.id))
          .filter((ride) => ride.distanceKm <= MAX_DISTANCE_KM)
          .sort((a, b) => a.distanceKm - b.distanceKm);
        setRides(withDistance);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load rides"))
      .finally(() => setLoading(false));
  }, [driverLat, driverLng, rejectedRideIds]);

  useEffect(() => {
    const unsubscribe = subscribeToRideBookings(addRideWithDistance, handleRideUpdate);
    return unsubscribe;
  }, [addRideWithDistance, handleRideUpdate]);

  const handleAcceptRide = useCallback(
    async (rideId: string) => {
      if (!driverId) {
        setError("Please sign in to accept rides");
        return;
      }
      if (!driverWalletAddress) {
        setError("Connect wallet before accepting rides");
        return;
      }
      if (blockedByActiveRide) {
        setError("Finish your current ride first");
        return;
      }

      setError(null);
      try {
        await acceptRide(rideId, driverId, driverWalletAddress);
        await refreshDriverRideState(driverId);
        setRides((prev) => prev.filter((value) => value.id !== rideId));
        onToast("Ride accepted", "success");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to accept ride");
      } finally {
        // no-op
      }
    },
    [blockedByActiveRide, driverId, driverWalletAddress, onToast, refreshDriverRideState]
  );

  const handleRejectRide = useCallback(
    (rideId: string) => {
      setRejectedRideIds((prev) => (prev.includes(rideId) ? prev : [...prev, rideId]));
      setRides((prev) => prev.filter((ride) => ride.id !== rideId));
      onToast("Ride hidden from your queue", "info");
    },
    [onToast]
  );

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
        <p className="text-sm text-slate-600">Loading nearby rides...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}
      {paymentMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {paymentMessage}
        </div>
      )}
      {activeRide ? (
        <article className="rounded-lg border border-cyan-200 bg-cyan-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-xs font-medium text-cyan-800">
              Current Accepted Ride
            </span>
            <span className="text-xs text-slate-500">
              {new Date(activeRide.created_at).toLocaleString()}
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <p className="text-slate-800">
              <span className="text-slate-500">Pickup:</span>{" "}
              {activeRide.pickup_place_name || "Pickup location"}
            </p>
            <p className="text-slate-800">
              <span className="text-slate-500">Destination:</span>{" "}
              {activeRide.destination_place_name || "Destination location"}
            </p>
          </div>
          <p className="mt-2 text-xs text-slate-600">
            {activeRide.escrow_state === "locked"
              ? "Funds locked on Algorand"
              : activeRide.escrow_state === "released"
                ? "Payment released on completion"
                : "Waiting for passenger to lock escrow"}
          </p>
          {!activeRide.driver_completed && (
            <button
              type="button"
              onClick={() => void onCompleteRide(activeRide)}
              disabled={isBusy}
              className="mt-3 w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Complete Ride
            </button>
          )}
          {activeRide.driver_completed && !activeRide.passenger_completed && (
            <p className="mt-3 text-xs text-amber-700">
              Waiting for passenger confirmation to complete ride and release payment.
            </p>
          )}
        </article>
      ) : (
        <>
          <div>
            <h2 className="text-xl font-bold text-slate-950">Available Nearby Rides</h2>
            <p className="mt-1 text-sm text-slate-600">
              Review requests within {MAX_DISTANCE_KM} km, then accept or reject them.
            </p>
            <p className="mt-2 text-xs text-cyan-700">
              Payments are locked in an Algorand smart contract escrow and released
              automatically after ride completion.
            </p>
          </div>
          {rides.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <p className="text-sm text-slate-600">
                No nearby rides. New bookings will appear here instantly.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {rides.map((ride) => (
                <article
                  key={ride.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      Waiting
                    </span>
                    <span className="text-sm font-semibold text-emerald-700">
                      {ride.distanceKm.toFixed(2)} km
                    </span>
                  </div>
                  <div className="mb-3 space-y-2 text-sm">
                    <p className="text-slate-800">
                      <span className="text-slate-500">Pickup:</span>{" "}
                      {ride.pickup_place_name || "Pickup location"}
                    </p>
                    <p className="text-slate-800">
                      <span className="text-slate-500">Destination:</span>{" "}
                      {ride.destination_place_name || "Destination location"}
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void handleAcceptRide(ride.id)}
                      disabled={Boolean(isBusy || blockedByActiveRide || !driverWalletAddress)}
                      className="rounded-lg bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRejectRide(ride.id)}
                      disabled={Boolean(isBusy)}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                  {blockedByActiveRide && (
                    <p className="mt-2 text-xs text-amber-700">Finish your current ride first</p>
                  )}
                  {!driverWalletAddress && (
                    <p className="mt-2 text-xs text-amber-700">Connect wallet before accepting rides</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

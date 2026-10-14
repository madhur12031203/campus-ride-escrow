"use client";

import { useEffect, useMemo, useState } from "react";
import { sendEscrowPayment } from "@/lib/algorand/escrow";
import {
  fetchMyRideBookings,
  markEscrowLocked,
  subscribeToMyRideBookings,
} from "@/lib/supabase/rideBookings";
import type { RideBookingRow } from "@/types";

type PassengerRideStatusProps = {
  passengerId: string;
  isBusy: boolean;
  onCompleteRide: (ride: RideBookingRow) => Promise<void>;
  paymentMessage?: string | null;
  walletAddress: string | null;
  appAddress: string;
  onToast: (message: string, tone?: "success" | "info" | "error") => void;
};

const ACTIVE_STATUSES: RideBookingRow["status"][] = ["waiting", "accepted"];

function StatusBadge({ status }: { status: RideBookingRow["status"] }) {
  const colors = {
    waiting: "bg-amber-100 text-amber-800",
    accepted: "bg-emerald-100 text-emerald-800",
    completed: "bg-blue-100 text-blue-800",
    cancelled: "bg-rose-100 text-rose-800",
  };

  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1).replace("_", " ")}
    </span>
  );
}

export default function PassengerRideStatus({
  passengerId,
  isBusy,
  onCompleteRide,
  paymentMessage,
  walletAddress,
  appAddress,
  onToast,
}: PassengerRideStatusProps) {
  const [rides, setRides] = useState<RideBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lockingRideId, setLockingRideId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchMyRideBookings(passengerId)
      .then((data) => setRides(data))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load rides"))
      .finally(() => setLoading(false));
  }, [onToast, passengerId]);

  useEffect(() => {
    const unsubscribe = subscribeToMyRideBookings(passengerId, (ride) => {
      setRides((prev) => {
        const exists = prev.some((value) => value.id === ride.id);
        if (exists) {
          const current = prev.find((value) => value.id === ride.id);
          if (current && current.status !== "accepted" && ride.status === "accepted") {
            onToast("Ride accepted", "success");
          }
          return prev.map((value) => (value.id === ride.id ? ride : value));
        }
        return [ride, ...prev];
      });
    });

    return unsubscribe;
  }, [onToast, passengerId]);

  const activeRide = useMemo(() => {
    const candidates = rides
      .filter((ride) => ACTIVE_STATUSES.includes(ride.status))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return candidates[0] ?? null;
  }, [rides]);

  const historyRides = useMemo(
    () =>
      rides
        .filter((ride) => !ACTIVE_STATUSES.includes(ride.status))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [rides]
  );

  useEffect(() => {
    if (!activeRide || activeRide.status !== "accepted") return;
    if (activeRide.escrow_state !== "pending_lock") return;
    if (!walletAddress || walletAddress !== activeRide.passenger_wallet) return;
    if (lockingRideId === activeRide.id) return;
    if (!appAddress) return;

    setLockingRideId(activeRide.id);
    void (async () => {
      try {
        const txnId = await sendEscrowPayment({
          senderAddress: walletAddress,
          appAddress,
          fare: 60,
        });
        await markEscrowLocked(activeRide.id, passengerId, txnId);
        onToast("Escrow locked", "success");
      } catch (lockError) {
        const message =
          lockError instanceof Error ? lockError.message : "Failed to lock escrow";
        setError(message);
        onToast("Escrow lock failed", "error");
      } finally {
        setLockingRideId(null);
      }
    })();
  }, [activeRide, appAddress, lockingRideId, onToast, passengerId, walletAddress]);

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
        <p className="text-sm text-slate-600">Loading your rides...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (rides.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-800">
        {activeRide ? "Current Active Ride" : "Ride History"}
      </h3>
      {paymentMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {paymentMessage}
        </div>
      )}
      {activeRide ? (
        <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <StatusBadge status={activeRide.status} />
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
                : "Escrow will lock as soon as driver accepts your ride"}
          </p>
          {activeRide.status === "accepted" && !activeRide.passenger_completed && (
              <button
                type="button"
                onClick={() => void onCompleteRide(activeRide)}
                disabled={isBusy}
                className="mt-3 w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Complete Ride
              </button>
            )}
          {activeRide.status === "accepted" &&
            activeRide.escrow_state === "pending_lock" &&
            (!walletAddress || walletAddress !== activeRide.passenger_wallet) && (
              <p className="mt-2 text-xs text-amber-700">
                Connect the passenger wallet used for booking to lock escrow.
              </p>
            )}
          {activeRide.status === "accepted" &&
            activeRide.passenger_completed &&
            !activeRide.driver_completed && (
              <p className="mt-3 text-xs text-amber-700">
                Waiting for driver confirmation to finish ride and release payment.
              </p>
            )}
        </article>
      ) : (
        historyRides.map((ride) => (
          <article
            key={ride.id}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-2 flex items-center justify-between">
              <StatusBadge status={ride.status} />
              <span className="text-xs text-slate-500">
                {new Date(ride.created_at).toLocaleString()}
              </span>
            </div>
            <p className="text-sm text-slate-800">
              {ride.pickup_place_name || "Pickup location"} to{" "}
              {ride.destination_place_name || "Destination location"}
            </p>
          </article>
        ))
      )}
    </div>
  );
}

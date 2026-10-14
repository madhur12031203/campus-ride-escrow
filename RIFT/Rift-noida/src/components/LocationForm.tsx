"use client";

import { useEffect, useRef, useState } from "react";
import type { LocationInput } from "@/types";

type Prediction = { placeId: string; text: string };

interface LocationFormProps {
  onSubmit?: (data: LocationInput) => void | Promise<void>;
  isLoading?: boolean;
}

function MapPinIcon() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-teal-600"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-red-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      className="h-5 w-5 shrink-0 text-slate-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}

async function fetchPredictions(input: string): Promise<Prediction[]> {
  const res = await fetch("/api/places", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  const json = await res.json();
  return json.predictions ?? [];
}

export default function LocationForm({ onSubmit, isLoading = false }: LocationFormProps) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");

  const [originSug, setOriginSug] = useState<Prediction[]>([]);
  const [destSug, setDestSug] = useState<Prediction[]>([]);
  const [active, setActive] = useState<"origin" | "destination" | null>(null);

  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!active) return;

    const value = active === "origin" ? origin : destination;
    const q = value.trim();

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (q.length < 3) {
      if (active === "origin") setOriginSug([]);
      else setDestSug([]);
      return;
    }

    debounceRef.current = window.setTimeout(async () => {
      try {
        const preds = await fetchPredictions(q);
        if (active === "origin") setOriginSug(preds);
        else setDestSug(preds);
      } catch {
        if (active === "origin") setOriginSug([]);
        else setDestSug([]);
      }
    }, 250);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [origin, destination, active]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!formRef.current?.contains(event.target as Node)) {
        setActive(null);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const o = origin.trim();
    const d = destination.trim();

    if (!o || !d) {
      setError("Please enter both pickup and drop locations.");
      return;
    }

    setError(null);
    setOriginSug([]);
    setDestSug([]);
    setActive(null);

    await onSubmit?.({ origin: o, destination: d });
  }

  const suggestions = active === "origin" ? originSug : active === "destination" ? destSug : [];

  function pickSuggestion(text: string) {
    if (active === "origin") setOrigin(text);
    if (active === "destination") setDestination(text);
    setOriginSug([]);
    setDestSug([]);
    setActive(null);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="relative w-full">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 shadow-sm">
        <div className="flex flex-col items-center gap-3">
          <div className="relative w-full flex-1">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition focus-within:border-teal-400">
              <MapPinIcon />
              <input
                id="origin"
                name="origin"
                type="text"
                value={origin}
                onFocus={() => setActive("origin")}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Pickup location"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 placeholder-slate-400 outline-none"
                disabled={isLoading}
                autoComplete="off"
              />
            </div>

            {active === "origin" && originSug.length > 0 && (
              <div className="absolute left-0 right-0 z-30 mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
                {originSug.slice(0, 6).map((p) => (
                  <button
                    type="button"
                    key={p.placeId}
                    onClick={() => pickSuggestion(p.text)}
                    className="block w-full truncate border-b border-slate-100 px-3 py-2.5 text-left text-sm text-slate-700 transition last:border-b-0 hover:bg-slate-50"
                  >
                    {p.text}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 px-1" aria-hidden>
            <ArrowRightIcon />
          </div>

          <div className="relative w-full flex-1">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition focus-within:border-teal-400">
              <FlagIcon />
              <input
                id="destination"
                name="destination"
                type="text"
                value={destination}
                onFocus={() => setActive("destination")}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Drop location"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-950 placeholder-slate-400 outline-none"
                disabled={isLoading}
                autoComplete="off"
              />
            </div>

            {active === "destination" && destSug.length > 0 && (
              <div className="absolute left-0 right-0 z-30 mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
                {destSug.slice(0, 6).map((p) => (
                  <button
                    type="button"
                    key={p.placeId}
                    onClick={() => pickSuggestion(p.text)}
                    className="block w-full truncate border-b border-slate-100 px-3 py-2.5 text-left text-sm text-slate-700 transition last:border-b-0 hover:bg-slate-50"
                  >
                    {p.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {active && suggestions.length === 0 && (active === "origin" ? origin.trim().length >= 3 : destination.trim().length >= 3) && (
        <p className="mt-2 text-center text-xs text-slate-500">No suggestions found.</p>
      )}

      {error && <p className="mt-3 text-center text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex justify-center">
        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-lg bg-teal-600 px-7 py-2.5 font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50"
        >
          {isLoading ? "Comparing..." : "Compare Prices"}
        </button>
      </div>
    </form>
  );
}

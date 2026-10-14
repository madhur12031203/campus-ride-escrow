"use client";

/**
 * Driver: Wrapper that captures driver location using Google Places Autocomplete,
 * then shows RealtimeRideList. Driver location is required for the 8 km distance filter (Haversine).
 */

import { useEffect, useRef, useState } from "react";
import RealtimeRideList from "./RealtimeRideList";
import type { RideBookingRow } from "@/types";

type DriverRealtimeViewProps = {
  isBusy: boolean;
  onCompleteRide: (ride: RideBookingRow) => Promise<void>;
  paymentMessage?: string | null;
  driverWalletAddress: string | null;
  onToast: (message: string, tone?: "success" | "info" | "error") => void;
};

type Prediction = { placeId: string; text: string };

async function fetchPredictions(input: string): Promise<Prediction[]> {
  try {
    const res = await fetch("/api/places", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });

    const responseText = await res.text();
    const json = responseText ? JSON.parse(responseText) : {};

    if (!res.ok) {
      throw new Error(json.error || "Failed to fetch places");
    }

    return json.predictions ?? [];
  } catch (error) {
    console.error("Error fetching predictions:", error);
    return [];
  }
}

async function fetchPlaceDetails(placeId: string): Promise<{
  placeId: string;
  placeName: string;
  lat: number;
  lng: number;
}> {
  try {
    const res = await fetch("/api/places/details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placeId }),
    });

    // Get response text first to safely parse JSON
    const responseText = await res.text();
    
    if (!responseText) {
      throw new Error("Empty response from server");
    }

    // Safely parse JSON
    let json;
    try {
      json = JSON.parse(responseText);
    } catch {
      throw new Error("Invalid JSON response from server");
    }

    // Check for HTTP errors
    if (!res.ok) {
      // Provide more helpful error messages based on status code
      let errorMessage = json?.error || `Server error: ${res.status}`;
      
      if (res.status === 403 || res.status === 401) {
        // Use the detailed error message from the API
        errorMessage = json?.error || "Google Maps API key is invalid or not authorized";
      } else if (res.status === 429) {
        errorMessage = "API quota exceeded. Please try again later.";
      } else if (res.status === 400) {
        errorMessage = json?.error || "Invalid place selected. Please try another location.";
      } else if (res.status === 500) {
        errorMessage = json?.error || "Unable to fetch place details. Please try again.";
      }
      
      throw new Error(errorMessage);
    }

    // Check for API-level errors
    if (json.error) {
      throw new Error(json.error);
    }

    // Validate required fields
    if (!json.lat || !json.lng) {
      throw new Error("Place location data is incomplete");
    }

    return json;
  } catch (error) {
    console.error("Error fetching place details:", error);
    // Re-throw with user-friendly message
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to fetch place details. Please try again.");
  }
}

function LocationIcon() {
  return (
    <svg className="h-5 w-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

export default function DriverRealtimeView({
  isBusy,
  onCompleteRide,
  paymentMessage,
  driverWalletAddress,
  onToast,
}: DriverRealtimeViewProps) {
  const [driverLat, setDriverLat] = useState<number | null>(null);
  const [driverLng, setDriverLng] = useState<number | null>(null);
  const [locationName, setLocationName] = useState("");
  const [suggestions, setSuggestions] = useState<Prediction[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingPlaceDetails, setIsLoadingPlaceDetails] = useState(false);
  
  const debounceRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLDivElement | null>(null);

  // Fetch autocomplete suggestions when typing
  useEffect(() => {
    if (!isActive) return;

    const query = locationName.trim();

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (query.length < 3) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = window.setTimeout(async () => {
      try {
        const preds = await fetchPredictions(query);
        setSuggestions(preds);
      } catch {
        setSuggestions([]);
      }
    }, 250);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [isActive, locationName]);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!inputRef.current?.contains(event.target as Node)) {
        setIsActive(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handlePickSuggestion = async (prediction: Prediction) => {
    setIsLoadingPlaceDetails(true);
    setError(null);
    
    try {
      const details = await fetchPlaceDetails(prediction.placeId);
      setLocationName(details.placeName);
      setDriverLat(details.lat);
      setDriverLng(details.lng);
      setSuggestions([]);
      setIsActive(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load place details");
    } finally {
      setIsLoadingPlaceDetails(false);
    }
  };

  const handleUseMyLocation = async () => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      return;
    }
    
    setIsLoadingPlaceDetails(true);
    setError(null);
    
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          
          // Use Google Geocoding API to get place name
          const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
          if (apiKey) {
            const res = await fetch(
              `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`
            );
            const data = await res.json();
            const placeName = data.results?.[0]?.formatted_address || `My Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
            setLocationName(placeName);
          } else {
            setLocationName(`My Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
          }
          
          setDriverLat(lat);
          setDriverLng(lng);
        } catch {
          setError("Could not get location name");
        } finally {
          setIsLoadingPlaceDetails(false);
        }
      },
      () => {
        setError("Could not get location");
        setIsLoadingPlaceDetails(false);
      }
    );
  };

  const hasLocation = driverLat != null && driverLng != null;
  const isPlacesEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

  function handleManualLocation() {
    const value = locationName.trim();
    if (!value) {
      setError("Enter your current location");
      return;
    }
    setDriverLat(28.5355);
    setDriverLng(77.391);
    setError(null);
    setSuggestions([]);
    setIsActive(false);
  }

  return (
    <div className="space-y-4">
      {!hasLocation ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {!isPlacesEnabled && (
            <p className="mb-3 text-xs text-amber-700">
              Google Maps key is missing, so manual driver location is enabled.
            </p>
          )}
          <p className="mb-3 text-sm font-medium text-slate-700">
            Enter your location to see nearby rides
          </p>
          <div className="relative" ref={inputRef}>
            <div className="flex min-h-[56px] items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 transition focus-within:border-sky-400">
              <LocationIcon />
              <div className="flex-1">
                <input
                  type="text"
                  value={locationName}
                  onFocus={() => setIsActive(true)}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="Your current location"
                  className="w-full bg-transparent text-sm text-slate-950 placeholder-slate-400 outline-none"
                  disabled={isLoadingPlaceDetails}
                  autoComplete="off"
                />
              </div>
            </div>
            {isActive && suggestions.length > 0 && (
              <div className="absolute left-0 right-0 z-30 mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
                {suggestions.slice(0, 6).map((p) => (
                  <button
                    type="button"
                    key={p.placeId}
                    onClick={() => void handlePickSuggestion(p)}
                    className="block w-full truncate border-b border-slate-100 px-3 py-2.5 text-left text-sm text-slate-700 transition last:border-b-0 hover:bg-slate-50"
                  >
                    {p.text}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={isPlacesEnabled ? handleUseMyLocation : handleManualLocation}
              disabled={isLoadingPlaceDetails}
              className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-50"
            >
              {isLoadingPlaceDetails ? "Loading..." : isPlacesEnabled ? "Use my location" : "Continue"}
            </button>
          </div>
          {error && (
            <p className="mt-2 text-sm text-rose-700">{error}</p>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-600">
              Your location: {locationName || "Current location selected"}
            </span>
            <button
              type="button"
              onClick={() => {
                setDriverLat(null);
                setDriverLng(null);
                setLocationName("");
              }}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              Change
            </button>
          </div>
          <RealtimeRideList
            driverLat={driverLat}
            driverLng={driverLng}
            isBusy={isBusy}
            onCompleteRide={onCompleteRide}
            paymentMessage={paymentMessage}
            driverWalletAddress={driverWalletAddress}
            onToast={onToast}
          />
        </>
      )}
    </div>
  );
}

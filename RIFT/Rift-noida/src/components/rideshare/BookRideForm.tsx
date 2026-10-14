"use client";

/**
 * Passenger: Book Ride form with Google Places Autocomplete.
 * Users select places from autocomplete → we fetch lat/lng from place ID.
 * On "Book Ride" → insert into ride_bookings with status = 'waiting'.
 * Stores both place names (for display) and lat/lng (for distance calculations).
 */

import { useEffect, useRef, useState } from "react";

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

type BookRideFormProps = {
  onBookRide: (input: {
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
    pickupPlaceName?: string | null;
    destinationPlaceName?: string | null;
  }) => Promise<void>;
  isBusy: boolean;
  hasActiveRide?: boolean;
  activeRideMessage?: string | null;
  walletConnected: boolean;
};

function LocationIcon() {
  return (
    <svg className="h-5 w-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg className="h-5 w-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
    </svg>
  );
}

export default function BookRideForm({
  onBookRide,
  isBusy,
  hasActiveRide = false,
  activeRideMessage,
  walletConnected,
}: BookRideFormProps) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [originPlaceId, setOriginPlaceId] = useState<string | null>(null);
  const [destinationPlaceId, setDestinationPlaceId] = useState<string | null>(null);
  const [originPlaceName, setOriginPlaceName] = useState<string | null>(null);
  const [destinationPlaceName, setDestinationPlaceName] = useState<string | null>(null);
  
  const [originSuggestions, setOriginSuggestions] = useState<Prediction[]>([]);
  const [destinationSuggestions, setDestinationSuggestions] = useState<Prediction[]>([]);
  const [activeField, setActiveField] = useState<"origin" | "destination" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingPlaceDetails, setIsLoadingPlaceDetails] = useState(false);
  
  const debounceRef = useRef<number | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const isPlacesEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

  // Fetch autocomplete suggestions when typing
  useEffect(() => {
    if (!activeField) return;
    if (!isPlacesEnabled) return;

    const value = activeField === "origin" ? origin : destination;
    const query = value.trim();

    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (query.length < 3) {
      if (activeField === "origin") setOriginSuggestions([]);
      if (activeField === "destination") setDestinationSuggestions([]);
      return;
    }

    debounceRef.current = window.setTimeout(async () => {
      try {
        const preds = await fetchPredictions(query);
        if (activeField === "origin") setOriginSuggestions(preds);
        if (activeField === "destination") setDestinationSuggestions(preds);
      } catch {
        if (activeField === "origin") setOriginSuggestions([]);
        if (activeField === "destination") setDestinationSuggestions([]);
      }
    }, 250);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [activeField, isPlacesEnabled, origin, destination]);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!formRef.current?.contains(event.target as Node)) {
        setActiveField(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handlePickSuggestion = async (prediction: Prediction, field: "origin" | "destination") => {
    setIsLoadingPlaceDetails(true);
    setError(null);
    
    try {
      const details = await fetchPlaceDetails(prediction.placeId);
      
      if (field === "origin") {
        setOrigin(details.placeName);
        setOriginPlaceId(details.placeId);
        setOriginPlaceName(details.placeName);
        setOriginSuggestions([]);
      } else {
        setDestination(details.placeName);
        setDestinationPlaceId(details.placeId);
        setDestinationPlaceName(details.placeName);
        setDestinationSuggestions([]);
      }
      
      setActiveField(null);
    } catch (err) {
      // Show user-friendly error message
      const errorMessage = err instanceof Error ? err.message : "Failed to load place details";
      setError(errorMessage);
      
      // Log full error for debugging
      console.error("Error fetching place details:", err);
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
          // Reverse geocode to get place name
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          
          // Use Google Geocoding API to get place name
          const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
          if (apiKey) {
            const res = await fetch(
              `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`
            );
            const data = await res.json();
            const placeName = data.results?.[0]?.formatted_address || `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
            setOrigin(placeName);
            setOriginPlaceName(placeName);
          } else {
            setOrigin(`My Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
            setOriginPlaceName(`My Location`);
          }
          
          // Store coordinates (we'll use these directly)
          setOriginPlaceId(`manual_${lat}_${lng}`);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!origin.trim() || !destination.trim()) {
      setError("Please enter both pickup and destination locations");
      return;
    }

    if (isPlacesEnabled && (!originPlaceId || !destinationPlaceId)) {
      setError("Please select both pickup and destination locations from the list");
      return;
    }
    if (!walletConnected) {
      setError("Connect wallet before booking a ride");
      return;
    }

    setIsLoadingPlaceDetails(true);

    try {
      let originLat: number;
      let originLng: number;
      let destLat = 28.544;
      let destLng = 77.401;

      if (!isPlacesEnabled) {
        originLat = 28.5355;
        originLng = 77.391;
        destLat = 28.544;
        destLng = 77.401;
      } else if (originPlaceId?.startsWith("manual_")) {
        const [, lat, lng] = originPlaceId.split("_");
        originLat = parseFloat(lat);
        originLng = parseFloat(lng);
      } else {
        const originDetails = await fetchPlaceDetails(originPlaceId as string);
        originLat = originDetails.lat;
        originLng = originDetails.lng;
      }

      if (isPlacesEnabled) {
        const destDetails = await fetchPlaceDetails(destinationPlaceId as string);
        destLat = destDetails.lat;
        destLng = destDetails.lng;
      }

      await onBookRide({
        originLat,
        originLng,
        destinationLat: destLat,
        destinationLng: destLng,
        pickupPlaceName: originPlaceName ?? origin,
        destinationPlaceName: destinationPlaceName ?? destination,
      });

      // Reset form after successful booking
      setOrigin("");
      setDestination("");
      setOriginPlaceId(null);
      setDestinationPlaceId(null);
      setOriginPlaceName(null);
      setDestinationPlaceName(null);
      
      // Form will remain visible but disabled - PassengerRideStatus will show "Waiting for driver"
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to book ride");
    } finally {
      setIsLoadingPlaceDetails(false);
    }
  };

  const isValid =
    originPlaceId &&
    destinationPlaceId &&
    !isBusy &&
    !isLoadingPlaceDetails &&
    !hasActiveRide &&
    walletConnected &&
    Boolean(origin.trim()) &&
    Boolean(destination.trim()) &&
    (!isPlacesEnabled || Boolean(originPlaceId && destinationPlaceId));

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Book a ride</h2>
          <p className="mt-1 text-sm text-slate-600">
            Choose verified locations, then publish the request to nearby drivers.
          </p>
        </div>
        <span className="w-fit rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700">
          Live matching
        </span>
        {!isPlacesEnabled && (
          <p className="text-xs text-amber-700 sm:max-w-xs sm:text-right">
            Google Maps key is missing, so manual pickup/drop text is enabled.
          </p>
        )}
      </div>

      <div className="relative">
        <div className="flex min-h-[72px] items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition focus-within:border-teal-400">
          <LocationIcon />
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-slate-500">Pickup</span>
              <button
                type="button"
                onClick={handleUseMyLocation}
                disabled={isLoadingPlaceDetails || !isPlacesEnabled}
                className="text-xs font-semibold text-teal-700 hover:text-teal-600 disabled:opacity-50"
              >
                Use my location
              </button>
            </div>
            <input
              type="text"
              value={origin}
              onFocus={() => setActiveField("origin")}
              onChange={(e) => {
                setOrigin(e.target.value);
                if (!isPlacesEnabled) {
                  setOriginPlaceName(e.target.value);
                }
              }}
              placeholder="Pickup location"
              className="w-full bg-transparent text-sm text-slate-950 placeholder-slate-400 outline-none"
              disabled={isBusy || isLoadingPlaceDetails}
              autoComplete="off"
            />
          </div>
        </div>
        {activeField === "origin" && originSuggestions.length > 0 && (
          <div className="absolute left-0 right-0 z-30 mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
            {originSuggestions.slice(0, 6).map((p) => (
              <button
                type="button"
                key={p.placeId}
                onClick={() => void handlePickSuggestion(p, "origin")}
                className="block w-full truncate border-b border-slate-100 px-3 py-2.5 text-left text-sm text-slate-700 transition last:border-b-0 hover:bg-slate-50"
              >
                {p.text}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative">
        <div className="flex min-h-[72px] items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition focus-within:border-teal-400">
          <FlagIcon />
          <div className="flex-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Destination</span>
            <input
              type="text"
              value={destination}
              onFocus={() => setActiveField("destination")}
              onChange={(e) => {
                setDestination(e.target.value);
                if (!isPlacesEnabled) {
                  setDestinationPlaceName(e.target.value);
                }
              }}
              placeholder="Drop location"
              className="mt-1 w-full bg-transparent text-sm text-slate-950 placeholder-slate-400 outline-none"
              disabled={isBusy || isLoadingPlaceDetails}
              autoComplete="off"
            />
          </div>
        </div>
        {activeField === "destination" && destinationSuggestions.length > 0 && (
          <div className="absolute left-0 right-0 z-30 mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
            {destinationSuggestions.slice(0, 6).map((p) => (
              <button
                type="button"
                key={p.placeId}
                onClick={() => void handlePickSuggestion(p, "destination")}
                className="block w-full truncate border-b border-slate-100 px-3 py-2.5 text-left text-sm text-slate-700 transition last:border-b-0 hover:bg-slate-50"
              >
                {p.text}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {hasActiveRide && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {activeRideMessage ?? "You already have an active ride"}
        </div>
      )}
      {!walletConnected && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Connect wallet before booking a ride
        </div>
      )}

      <button
        type="submit"
        disabled={!isValid}
        className="w-full rounded-lg bg-teal-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isBusy || isLoadingPlaceDetails ? "Processing…" : "Book Ride"}
      </button>
    </form>
  );
}

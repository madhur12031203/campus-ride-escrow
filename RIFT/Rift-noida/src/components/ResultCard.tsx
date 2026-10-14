"use client";

import Image from "next/image";
import type { FareResult } from "@/types";

interface ResultCardProps {
  result: FareResult;
  isBestDeal?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
}

function CrownIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width={18} height={18}>
      <path d="M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8L12 2Z" />
    </svg>
  );
}

export default function ResultCard({ result, isBestDeal, isSelected, onSelect }: ResultCardProps) {
  const iconPath = result.icon ? `/icons/${result.icon}` : null;
  const isHighlight = isBestDeal || isSelected;
  const cardBg = isHighlight
    ? "bg-amber-50 border-amber-200"
    : "bg-white border-slate-200";

  return (
    <div
      className={`flex flex-col rounded-lg border p-4 shadow-sm transition ${cardBg}`}
    >
      <div className="mb-3 flex items-center gap-2">
        {iconPath ? (
          <div className="relative h-12 w-12 overflow-hidden rounded-full bg-slate-50 ring-1 ring-slate-200">
            <Image
              src={iconPath}
              alt={result.provider}
              width={48}
              height={48}
              className="object-contain p-1"
              unoptimized
              onError={(e) => {
                e.currentTarget.style.display = "none";
                const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                if (fallback) fallback.style.display = "flex";
              }}
            />
            <span
              className="absolute inset-0 hidden items-center justify-center text-lg font-bold text-slate-500"
              style={{ display: "none" }}
            >
              {result.provider[0]}
            </span>
          </div>
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 text-lg font-bold text-slate-500 ring-1 ring-slate-200">
            {result.provider[0]}
          </div>
        )}
        <div>
          <p className="flex items-center gap-1.5 font-bold text-slate-950">
            {result.provider}
            {isBestDeal && (
              <span className="text-amber-400">
                <CrownIcon />
              </span>
            )}
          </p>
          <p className="text-sm text-slate-600">Est. Time: {result.duration.replace("~", "")}</p>
        </div>
      </div>
      <p className="mb-4 text-2xl font-bold text-slate-950">Rs {result.price}</p>
      <a
        href={result.bookingUrl || "#"}
        target="_blank"
        rel="noreferrer"
        onClick={onSelect}
        className={`mt-auto rounded-lg px-4 py-2 text-center text-sm font-semibold transition ${
          isSelected
            ? "bg-amber-400 text-slate-900 shadow-md shadow-amber-500/20"
            : isHighlight
              ? "bg-amber-500/90 text-slate-900 hover:bg-amber-400 shadow-md shadow-amber-500/20"
              : "bg-slate-900 text-white hover:bg-slate-800"
        }`}
      >
        Book Now
      </a>
    </div>
  );
}

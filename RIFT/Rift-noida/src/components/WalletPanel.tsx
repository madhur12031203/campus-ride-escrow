"use client";

import { useEffect, useMemo } from "react";
import { usePeraWallet } from "@/hooks/usePeraWallet";

type WalletPanelProps = {
  appId?: number;
  appAddress?: string;
  onAddressChange?: (address: string | null) => void;
};

function shortenAddress(value: string): string {
  return `${value.slice(0, 4)}...${value.slice(-3)}`;
}

function WalletIcon() {
  return (
    <svg className="h-5 w-5 text-teal-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

export default function WalletPanel({
  appId = Number(process.env.NEXT_PUBLIC_RIDE_ESCROW_APP_ID ?? 0),
  appAddress = process.env.NEXT_PUBLIC_RIDE_ESCROW_APP_ADDRESS ?? "",
  onAddressChange,
}: WalletPanelProps) {
  const isConfigValid = useMemo(
    () => Number.isFinite(appId) && appId > 0 && appAddress.length > 0,
    [appAddress, appId]
  );

  const { address, isConnecting, connectWallet, disconnectWallet } = usePeraWallet({
    appId,
    appAddress,
  });

  useEffect(() => {
    onAddressChange?.(address);
  }, [address, onAddressChange]);

  if (!isConfigValid) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
        <p className="text-sm text-amber-200">
          Wallet configuration incomplete. Set NEXT_PUBLIC_RIDE_ESCROW_APP_ID and
          NEXT_PUBLIC_RIDE_ESCROW_APP_ADDRESS.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg border border-teal-200 bg-teal-50">
            <WalletIcon />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">Algorand wallet</p>
            {address ? (
              <p className="mt-0.5 text-sm font-semibold text-slate-950" title={address}>
                {shortenAddress(address)}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-slate-600">Required for ride escrow</p>
            )}
          </div>
        </div>
        {address ? (
          <div className="flex items-center gap-2">
            <CheckIcon />
            <button
              type="button"
              onClick={() => void disconnectWallet()}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void connectWallet()}
            disabled={isConnecting}
            className="min-h-[44px] rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </div>
    </div>
  );
}

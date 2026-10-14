# Campus Ride - Algorand Escrow Ridesharing

## Project Title And Description
Campus Ride is a mobile-first campus ride-sharing web app built with Next.js, Supabase Realtime, and Algorand.
It connects passengers and drivers in real time, locks payments in Algorand escrow, and releases funds automatically when rides are completed.

## Problem Statement / Original Idea
Students need a safer and more transparent intra-campus ride coordination system than ad-hoc messaging groups.
This project solves that by combining:
- realtime matching (Supabase),
- wallet-based identity + trust (Pera Wallet),
- programmable settlement guarantees (Algorand escrow).

## Live Demo URL
https://rift-noida-fullstack.vercel.app/

## LinkedIn Demo Video URL
https://www.linkedin.com/posts/madhur-gupta1203_rifthackathon-moneymulingdetection-financialcrime-activity-7430422813305614336-8iSN?utm_source=share&utm_medium=member_android&rcm=ACoAAFK7xuEBQMXCrMSg9K9q_jFxHAzCMCRf5dM

## App ID (Testnet) And Explorer Link
- Algorand Testnet App ID: 755776791
- App Address: `GLYCD2SYQTCIBJFCCHBFDFLILGB5YLV5DNLOPOFKVYSJ7A67UCNJJTTQ2Q`

## Architecture Overview
1. Passenger signs in, connects Pera Wallet, and books a ride (`status = waiting`).
2. Driver receives ride in realtime and accepts (`status = accepted`, `driver_id`, `driver_wallet` set).
3. Passenger wallet sends ALGO to escrow app address; ride escrow state becomes `locked`.
4. Passenger or driver taps `Complete Ride`.
5. Smart-contract release path triggers payout to assigned driver wallet and marks ride `completed`.
6. Ride becomes non-active; both users can start a new ride.

Data + coordination:
- Supabase Postgres (`ride_bookings`, `users`, `driver_vehicles`, `ratings`)
- Supabase Realtime subscriptions for ride lifecycle updates.

Trust + settlement:
- Algorand Testnet escrow app + Pera Wallet signatures.

## Tech Stack
- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS
- Backend/Data: Supabase Auth, Postgres, Realtime, RLS
- Blockchain: Algorand Testnet
- Wallet: Pera Wallet (`@perawallet/connect`)
- Smart Contract Tooling: AlgoKit + Python contract project in `ride-escrow/`

## Installation And Setup
### 1. Clone
```bash
git clone https://github.com/madhur12031203/rift-noida-fullstack.git
cd RIFT/Rift-noida
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Create `.env.local` with:
```env
NEXT_PUBLIC_RIDE_ESCROW_APP_ID=755776791
NEXT_PUBLIC_RIDE_ESCROW_APP_ADDRESS=GLYCD2SYQTCIBJFCCHBFDFLILGB5YLV5DNLOPOFKVYSJ7A67UCNJJTTQ2Q

NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

NEXT_PUBLIC_SITE_URL=http://localhost:3000
ADMIN_EMAILS=admin@example.com

GEMINI_API_KEY=your-gemini-api-key
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-google-maps-browser-key
```

Never commit real `.env.local` values. Keep production secrets in Vercel Environment Variables.

### 4. Apply Database Migrations
```bash
supabase db push
```

### 5. Run The App
```bash
npm run dev
```

### 6. Production Build Check
```bash
npm run build
```

## Usage Guide
1. Login as passenger, connect wallet, book a ride.
2. Login as driver on a second laptop/session, connect wallet, and accept the ride.
3. Passenger sees accepted status and escrow lock confirmation.
4. Passenger/driver completes the ride; payment releases.

## Known Limitations
- Escrow release path in frontend is demo-safe and should be replaced with full ARC client call in production.
- Google Places requires an API key; without it, location search is gracefully disabled.
- Current explorer/status text is UI-level; deeper on-chain event indexing is not yet implemented.
- Notification system is in-app toast only.

## Team Members And Roles
- `<TEAM_MEMBER_1>` - Smart contract, AlgoKit integration, testing, and deployment
- `<TEAM_MEMBER_2>` - Frontend, realtime ride UX, Supabase schema, RLS, API routes, and product demo

import AuthForm from "@/components/auth/AuthForm";
import VideoBackground from "@/components/VideoBackground";

export default function PassengerLoginPage() {
  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center px-6">
      <VideoBackground />
      <div className="relative z-10 w-full max-w-md">
        <AuthForm
          role="passenger"
          title="Passenger"
          subtitle="Sign in or create an account to request rides, book seats, and pay through escrow."
          accentClass="bg-emerald-400"
        />
      </div>
    </main>
  );
}


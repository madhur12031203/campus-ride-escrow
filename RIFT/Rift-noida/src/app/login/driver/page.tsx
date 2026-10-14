import AuthForm from "@/components/auth/AuthForm";
import VideoBackground from "@/components/VideoBackground";

export default function DriverLoginPage() {
  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center px-6">
      <VideoBackground />
      <div className="relative z-10 w-full max-w-md">
        <AuthForm
          role="driver"
          title="Driver"
          subtitle="Sign in or create an account to accept requests and manage your ride availability."
          accentClass="bg-cyan-400"
        />
      </div>
    </main>
  );
}


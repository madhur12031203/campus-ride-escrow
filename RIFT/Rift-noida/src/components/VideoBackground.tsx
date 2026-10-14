export default function VideoBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[#f7f9fc]">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(239,246,255,0.96),rgba(248,250,252,0.98)_48%,rgba(236,253,245,0.9))]" />
        <div 
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(15,23,42,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,0.06) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
        <div className="absolute inset-x-0 top-0 h-px bg-slate-200" />
      </div>
    </div>
  );
}

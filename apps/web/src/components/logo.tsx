export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center bg-ink"
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
      aria-hidden="true"
    >
      <svg width={size * 0.53} height={size * 0.53} viewBox="0 0 24 24" fill="none" stroke="#C8FF3D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 4v16M5 12l9-8M9 9l9 11" />
      </svg>
    </span>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[17px] font-extrabold tracking-[-0.03em]">Kicko</span>
    </span>
  );
}

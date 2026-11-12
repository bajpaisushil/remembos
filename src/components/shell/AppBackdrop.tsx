/** Decorative page background: soft aurora glows, a faint top grid and a whisper of grain. */
export function AppBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="aurora absolute inset-0" />
      <div className="bg-grid absolute inset-x-0 top-0 h-[40rem]" />
      <div className="bg-noise absolute inset-0 opacity-[0.035] mix-blend-multiply dark:opacity-[0.06] dark:mix-blend-screen" />
    </div>
  );
}

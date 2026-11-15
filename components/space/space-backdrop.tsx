/**
 * Static backdrop for interior pages: pure CSS gradients in the existing
 * palette. No canvas, no animation loop, no extra download.
 */
export default function SpaceBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 bg-void">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 18% 0%, rgba(23,27,58,0.9) 0%, rgba(7,11,24,0.5) 45%, rgba(3,4,11,0) 75%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(70% 55% at 82% 12%, rgba(102,85,143,0.28) 0%, rgba(3,4,11,0) 70%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 100%, rgba(131,183,255,0.12) 0%, rgba(3,4,11,0) 70%)',
        }}
      />
    </div>
  )
}

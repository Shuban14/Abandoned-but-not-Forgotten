'use client'

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  /** Path of the existing standalone scene, e.g. `/space/index.html`. */
  src: string
  title: string
  /** Short name used in the loading copy, e.g. "the Moon". */
  label: string
  children?: React.ReactNode
}

const SLOW_AFTER_MS = 30_000

/**
 * Hosts one of the existing three.js apps (Launch Lab / Planet Explorer)
 * exactly as it was built: its own HTML, CSS and JS, served untouched from
 * `/space/`. This component only adds the surrounding shell, a themed loading
 * veil, a retry path and same-origin navigation messages from the frame.
 */
export default function ImmersiveFrame({ src, title, label, children }: Props) {
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    setReady(false)
    setFailed(false)
    timer.current = window.setTimeout(() => setFailed(true), SLOW_AFTER_MS)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [src, attempt])

  // The embedded apps ask the shell to change route instead of opening tabs
  // or trapping the visitor inside the frame.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; to?: string } | null
      if (!data || data.type !== 'navigate') return
      if (typeof data.to !== 'string' || !data.to.startsWith('/')) return
      router.push(data.to)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [router])

  const onLoad = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current)
    setReady(true)
    setFailed(false)
  }, [])

  const retry = useCallback(() => {
    setAttempt((n) => n + 1)
  }, [])

  return (
    <section className="relative h-svh w-full overflow-hidden bg-void" aria-label={title}>
      <iframe
        key={attempt}
        src={src}
        title={title}
        onLoad={onLoad}
        allow="fullscreen; autoplay"
        className="absolute inset-x-0 bottom-0 top-[72px] h-[calc(100svh-72px)] w-full border-0"
      />

      {/* Loading veil: stays inside the frame area so the nav never moves. */}
      <div
        aria-live="polite"
        aria-busy={!ready}
        className={`pointer-events-none absolute inset-x-0 bottom-0 top-[72px] flex items-center justify-center bg-void/95 transition-opacity duration-500 ${
          ready ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="size-6 animate-spin text-electric" aria-hidden />
          <p className="font-display text-[11px] uppercase tracking-[0.28em] text-moon">
            Preparing {label}
          </p>
          <p className="max-w-xs text-xs leading-relaxed text-moon/60">
            Building the 3D scene and loading NASA imagery.
          </p>
        </div>
      </div>

      {failed && !ready && (
        <div className="absolute inset-x-4 top-[92px] z-30 flex justify-center">
          <div className="glass flex w-full max-w-md flex-col items-start gap-3 rounded-2xl p-5">
            <p className="flex items-center gap-2 font-display text-[11px] uppercase tracking-[0.24em] text-gold">
              <AlertTriangle className="size-4" aria-hidden />
              Scene did not start
            </p>
            <p className="text-sm leading-relaxed text-moon/85">
              {label} is taking longer than expected. Your connection or the WebGL context may have
              been interrupted.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-2 rounded-full border border-electric/40 bg-electric/10 px-4 py-2 font-display text-[11px] uppercase tracking-[0.2em] text-starlight transition-colors hover:border-electric/80 hover:bg-electric/20"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Retry
              </button>
              <a
                href={src}
                className="font-display text-[11px] uppercase tracking-[0.2em] text-moon underline-offset-4 hover:text-starlight hover:underline"
              >
                Open standalone
              </a>
            </div>
          </div>
        </div>
      )}

      {children}
    </section>
  )
}

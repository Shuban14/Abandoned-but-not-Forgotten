'use client'

import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '@/lib/api-client'
import type { MissionInput, MissionTarget } from '@/lib/types'
import ImmersiveFrame from './immersive-frame'

type Toast = { kind: 'saving' | 'saved' | 'error'; text: string }

const TARGETS: MissionTarget[] = ['leo', 'moon', 'mars']

/** Defensive shape check; the server validates everything again. */
function toMissionInput(raw: unknown): MissionInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.siteId !== 'string') return null
  if (typeof r.target !== 'string' || !TARGETS.includes(r.target as MissionTarget)) return null
  if (typeof r.success !== 'boolean') return null
  const numbers = ['speedBudgetMps', 'requiredSpeedMps', 'twr', 'weightT', 'stages'] as const
  for (const key of numbers) {
    if (typeof r[key] !== 'number' || !Number.isFinite(r[key] as number)) return null
  }
  if (!Array.isArray(r.parts) || !r.parts.every((p) => typeof p === 'string')) return null
  return {
    siteId: r.siteId,
    target: r.target as MissionTarget,
    success: r.success,
    partial: r.partial === true,
    speedBudgetMps: r.speedBudgetMps as number,
    requiredSpeedMps: r.requiredSpeedMps as number,
    twr: r.twr as number,
    weightT: r.weightT as number,
    stages: r.stages as number,
    parts: r.parts as string[],
    failureCode: typeof r.failureCode === 'string' ? r.failureCode : null,
  }
}

/**
 * Hosts Launch Lab unchanged and listens for the mission report it posts when a
 * flight ends. The record is only shown as saved once the server confirms it.
 */
export default function GameShell() {
  const [toast, setToast] = useState<Toast | null>(null)
  const hideTimer = useRef<number | null>(null)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { source?: string; type?: string; mission?: unknown } | null
      if (!data || data.source !== 'launch-lab' || data.type !== 'mission-complete') return

      const mission = toMissionInput(data.mission)
      if (!mission) {
        setToast({ kind: 'error', text: 'Mission report could not be read.' })
        return
      }

      setToast({ kind: 'saving', text: 'Logging mission…' })
      api
        .saveMission(mission)
        .then((saved) => {
          setToast({
            kind: 'saved',
            text: saved.success
              ? `Mission logged · ${saved.target.toUpperCase()} · ${saved.siteName}`
              : `Attempt logged · ${saved.target.toUpperCase()} · ${saved.siteName}`,
          })
        })
        .catch((error: unknown) => {
          setToast({ kind: 'error', text: `Mission not saved — ${errorMessage(error)}` })
        })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (!toast) return
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    const linger = toast.kind === 'error' ? 12_000 : 7000
    hideTimer.current = window.setTimeout(() => setToast(null), linger)
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [toast])

  return (
    <ImmersiveFrame src="/space/index.html" title="Launch Lab — build it, launch it" label="Launch Lab">
      <div
        aria-live="polite"
        className={`pointer-events-none absolute bottom-5 left-4 z-30 transition-opacity duration-500 sm:left-6 ${
          toast ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {toast && (
          <div className="glass pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-full px-4 py-2.5">
            {toast.kind === 'saving' && <Loader2 className="size-3.5 animate-spin text-electric" aria-hidden />}
            {toast.kind === 'saved' && <CheckCircle2 className="size-3.5 text-[#3ddc84]" aria-hidden />}
            {toast.kind === 'error' && <TriangleAlert className="size-3.5 text-gold" aria-hidden />}
            <span className="text-xs leading-tight text-moon">{toast.text}</span>
            {toast.kind === 'saved' && (
              <Link
                href="/missions"
                className="ml-1 shrink-0 font-display text-[10px] uppercase tracking-[0.18em] text-electric underline-offset-4 hover:underline"
              >
                View log
              </Link>
            )}
          </div>
        )}
      </div>
    </ImmersiveFrame>
  )
}

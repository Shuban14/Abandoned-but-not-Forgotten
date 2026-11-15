import type { Metadata } from 'next'
import RelicArchive from '@/components/space/relic-archive'

export const metadata: Metadata = {
  title: 'The Relic Archive — Space Relics',
  description:
    'Every lander, rover and probe still on the Moon and Mars, served from the mission dataset, plus the launches you have flown.',
}

export default function MissionsPage() {
  return (
    <main className="relative min-h-svh">
      <RelicArchive />
    </main>
  )
}

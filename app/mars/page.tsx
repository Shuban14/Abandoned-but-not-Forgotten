import type { Metadata } from 'next'
import ComingSoon from '@/components/space/coming-soon'

export const metadata: Metadata = {
  title: 'The Red Planet — Space Relics',
  description: 'The Mars exploration module is coming soon.',
}

export default function MarsPage() {
  return <ComingSoon name="The Red Planet" tagline="Rust-red plains, patient rovers" tone="mars" />
}

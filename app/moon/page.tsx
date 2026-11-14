import type { Metadata } from 'next'
import ComingSoon from '@/components/space/coming-soon'

export const metadata: Metadata = {
  title: "Earth's Moon — Space Relics",
  description: 'The Moon exploration module is coming soon.',
}

export default function MoonPage() {
  return <ComingSoon name="Earth's Moon" tagline="Silver dust, silent footprints" tone="moon" />
}

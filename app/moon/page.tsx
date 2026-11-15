import type { Metadata } from 'next'
import ImmersiveFrame from '@/components/space/immersive-frame'

export const metadata: Metadata = {
  title: "Earth's Moon — Space Relics",
  description:
    'Explore the Moon in 3D: real LRO imagery and terrain, every landing site humanity left hardware on, live orbiter tracks and the stories behind them.',
}

export default function MoonPage() {
  return (
    <ImmersiveFrame
      src="/space/planets/index.html?body=moon"
      title="Planet Explorer — Earth's Moon"
      label="the Moon"
    />
  )
}

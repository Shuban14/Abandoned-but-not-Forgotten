import type { Metadata } from 'next'
import ImmersiveFrame from '@/components/space/immersive-frame'

export const metadata: Metadata = {
  title: 'The Red Planet — Space Relics',
  description:
    'Explore Mars in 3D: real Viking and MRO imagery, live rover tracks, every landing site, and the hardware still resting on the surface.',
}

export default function MarsPage() {
  return (
    <ImmersiveFrame
      src="/space/planets/index.html?body=mars"
      title="Planet Explorer — Mars"
      label="Mars"
    />
  )
}

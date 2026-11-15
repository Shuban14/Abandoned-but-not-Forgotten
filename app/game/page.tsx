import type { Metadata } from 'next'
import GameShell from '@/components/space/game-shell'

export const metadata: Metadata = {
  title: 'Launch Lab — Space Relics',
  description:
    'Assemble a satellite, choose a real launch site, plan an orbit and fly the mission. Every launch is logged to the Space Relics archive.',
}

export default function GamePage() {
  return <GameShell />
}

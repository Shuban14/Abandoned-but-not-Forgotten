export type PlanetId = 'moon' | 'mars'

export const PLANETS: Record<
  PlanetId,
  { id: PlanetId; tab: string; title: string; description: string; href: string; cta: string; accent: string }
> = {
  moon: {
    id: 'moon',
    tab: 'MOON',
    title: "Earth's Moon",
    description:
      "Our closest celestial neighbour. A world of ancient craters, historic lunar landings and humanity's first footsteps beyond Earth.",
    href: '/moon',
    cta: 'Enter the Moon',
    accent: '#83B7FF',
  },
  mars: {
    id: 'mars',
    tab: 'MARS',
    title: 'The Red Planet',
    description:
      'A fascinating world of dusty landscapes, ancient geological history and robotic explorers that continue to expand our understanding of the Solar System.',
    href: '/mars',
    cta: 'Enter Mars',
    accent: '#E99570',
  },
}

export const MISSIONS = [
  {
    id: 'lunar',
    index: '01',
    title: 'Lunar Exploration',
    eyebrow: 'The Moon',
    description:
      'From the first footprints in Tranquility Base to the rovers left parked in the dust, trace how humans walked, drove and worked on the Moon.',
    image: '/images/mission-lunar.png',
    alt: 'Astronaut footprints and a flag on grey lunar soil with Earth on the horizon',
    glow: '131,183,255',
    accent: '#83B7FF',
    href: '/moon',
    cta: 'Enter the Moon',
  },
  {
    id: 'mars',
    index: '02',
    title: 'Mars Exploration',
    eyebrow: 'The Red Planet',
    description:
      'Follow the landers and rovers that crossed dust plains and ancient riverbeds, sending home the first close views of another world.',
    image: '/images/mission-mars.png',
    alt: 'A rover on the rust-red dusty plains of Mars under a hazy orange sky',
    glow: '233,149,112',
    accent: '#E99570',
    href: '/mars',
    cta: 'Enter Mars',
  },
  {
    id: 'relics',
    index: '03',
    title: 'The Forgotten Relics',
    eyebrow: 'Left Behind',
    description:
      'Landers, probes and instruments still resting where they fell silent. Meet the machines that remain on worlds far from home.',
    image: '/images/mission-relics.png',
    alt: 'An abandoned lander half buried in dust under a deep violet sky',
    glow: '154,128,214',
    accent: '#9A80D6',
    href: '/missions',
    cta: 'Open the archive',
  },
] as const

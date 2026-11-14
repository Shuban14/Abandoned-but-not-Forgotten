import { Logo } from './navbar'

export default function SiteFooter() {
  return (
    <footer id="about" className="relative z-10 scroll-mt-4 px-5 pb-12 pt-10 sm:px-8">
      <div className="mx-auto max-w-6xl border-t border-orbit/20 pt-14">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <p className="font-hand text-2xl uppercase tracking-[0.18em] text-ivory">About Space Relics</p>
          <p className="mt-4 font-cinematic text-2xl italic leading-snug text-moon-hi sm:text-3xl">
            A museum of the machines and moments humanity has left among the stars.
          </p>
          <p className="mt-5 text-sm leading-relaxed text-moon/75">
            Space Relics is a living archive of historic missions and forgotten spacecraft resting on the Moon and Mars,
            designed as an interactive journey through the Solar System.
          </p>
        </div>
        <div className="mt-14 flex flex-col items-center justify-between gap-5 sm:flex-row">
          <Logo />
          <p className="text-xs tracking-wide text-moon/55">
            Concept prototype built for the NASA Space Apps Challenge.
          </p>
        </div>
      </div>
    </footer>
  )
}

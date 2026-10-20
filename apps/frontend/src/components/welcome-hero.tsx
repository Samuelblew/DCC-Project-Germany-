import f14Tomcat from '@/assets/f14-tomcat.png'
import { cn } from '@/lib/utils'
import './welcome-hero.css'

type WelcomeHeroProps = {
  appVersion?: string
  className?: string
}

export function WelcomeHero({ appVersion, className }: WelcomeHeroProps) {
  const versionLabel = appVersion?.trim() ? `v${appVersion.trim()}` : 'DCC'

  return (
    <div className={cn('welcome-hero', className)}>
      <div className="welcome-hero__bg-grid" aria-hidden />
      <div className="welcome-hero__bg-horizon" aria-hidden />
      <div className="welcome-hero__sun" aria-hidden />

      <div className="welcome-hero__f14-stage" aria-hidden>
        <div className="welcome-hero__f14-sun" />
        <div className="welcome-hero__f14-photo-wrap">
          <img className="welcome-hero__f14-photo" src={f14Tomcat} alt="" />
          <div className="welcome-hero__f14-photo-tint" />
          <div className="welcome-hero__f14-photo-scan" />
        </div>
      </div>

      <div className="welcome-hero__content">
        <div className="welcome-hero__eyebrow">
          <span className="welcome-hero__dot" aria-hidden />
          {versionLabel} · Alpha preview
        </div>
        <h1 className="welcome-hero__wordmark retro-font">
          <span className="welcome-hero__wordmark-line1">DIGITAL</span>
          <span className="welcome-hero__wordmark-line2">
            CREW CHIEF
            <span className="welcome-hero__wordmark-glow" aria-hidden>
              CREW CHIEF
            </span>
          </span>
        </h1>
        <div className="welcome-hero__tagline pixel-font">
          100% Flying, 0% Configuration
          <span className="welcome-hero__caret" aria-hidden />
        </div>
        <p className="welcome-hero__pitch">
          A dynamic campaign generator for DCS World. Spin up a persistent theatre, watch flight
          groups move in real time, and export a <code>.miz</code> you can fly — no config, no
          scripting.
        </p>
      </div>
    </div>
  )
}

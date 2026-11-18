import { useEffect, useState } from 'react'
import { DOWNLOAD_URL } from '../constants'
import {
  trackDiscordClicked,
  trackDownloadClicked,
  trackDownloadModalOpened,
  trackSourceClicked
} from '../tracking'
import { CloseIcon, DlIcon } from './icons'

export function Footer() {
  return (
    <footer className="footer">
      <div>© 2026 Digital Crew Chief · MIT License</div>
      <div className="links">
        <a href="/changelog">Changelog</a>
        <a href="/privacy">Privacy</a>
        <a href="https://discord.gg/jZZ3pFpY3e" onClick={trackDiscordClicked}>
          Discord
        </a>
        <a href="https://codeberg.org/rhyver/dcc" onClick={trackSourceClicked}>
          Codeberg
        </a>
      </div>
    </footer>
  )
}

export function DownloadModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!isOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="download-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="download-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="download-modal-title"
        aria-describedby="download-modal-copy"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="download-modal-close"
          type="button"
          aria-label="Close download warning"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
        <div className="download-modal-kicker">Alpha release</div>
        <h2 id="download-modal-title">Digital Crew Chief is still early.</h2>
        <p id="download-modal-copy">
          This is an alpha version. Some features are unfinished or missing, and you may hit rough
          edges while building campaigns. Download it if you are comfortable testing an early public
          release.
        </p>
        <div className="download-modal-actions">
          <a
            className="btn btn-primary"
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            onClick={trackDownloadClicked}
          >
            <DlIcon />
            <span>Download alpha</span>
            <span className="meta">v0.5.0 Alpha · Win</span>
          </a>
        </div>
      </div>
    </div>
  )
}

export function Nav({ onDownloadClick }: { onDownloadClick?: () => void }) {
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false)

  const handleDownloadClick =
    onDownloadClick ??
    (() => {
      trackDownloadModalOpened()
      setIsDownloadModalOpen(true)
    })

  return (
    <>
      <nav className="nav">
        <a className="nav-brand" href="/">
          <img className="nav-logo" src="/favicon.png" alt="" />
          <div className="nav-name">
            <span className="accent">DIGITAL</span> CREW CHIEF
          </div>
        </a>
        <div className="nav-links">
          <a className="nav-link" href="/changelog">
            Changelog
          </a>
          <a
            className="nav-link"
            href="https://discord.gg/jZZ3pFpY3e"
            onClick={trackDiscordClicked}
          >
            Community
          </a>
          <button className="nav-cta" type="button" onClick={handleDownloadClick}>
            <DlIcon /> Download
          </button>
        </div>
      </nav>
      {!onDownloadClick && (
        <DownloadModal isOpen={isDownloadModalOpen} onClose={() => setIsDownloadModalOpen(false)} />
      )}
    </>
  )
}

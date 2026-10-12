import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { installAvailable, promptInstall, subscribeInstall } from '../lib/pwa.js'
import { Button } from './ui.jsx'

// The install offer: a banner while the browser has an install prompt parked (lib/pwa.js) and
// the user has not dismissed or installed. Hidden on iOS — Safari has no beforeinstallprompt,
// and a banner that cannot act there is noise.
const DISMISS_KEY = 'gym_pwa_dismiss'
const readDismiss = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export default function InstallBanner() {
  const [dismissed, setDismissed] = useState(readDismiss)
  const [available, setAvailable] = useState(installAvailable)
  useEffect(() => subscribeInstall(() => setAvailable(installAvailable())), [])
  if (dismissed || !available) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* a blocked storage only costs the banner coming back next open */
    }
    setDismissed(true)
  }

  return (
    <div className="pwa-banner">
      <div className="pwa-copy">
        <b>{t('Install GymTask')}</b>
        <span>{t('Add it to your home screen and it opens like an app.')}</span>
      </div>
      <div className="pwa-actions">
        <Button
          onClick={async () => {
            await promptInstall()
          }}
        >
          {t('Install')}
        </Button>
        <button type="button" className="pwa-x" aria-label={t('Hide')} onClick={dismiss}>
          ✕
        </button>
      </div>
    </div>
  )
}

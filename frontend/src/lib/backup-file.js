// The backup file: the whole profile state as one JSON download. Shared by the Settings
// "Export backup (JSON)" row and the auto-backup (S.autoBackup — the store downloads one when
// the app is left, at most once a day), so both make exactly the same file.
import { todayISO } from './format.js'

export const backupFileName = (now = new Date()) => 'gytask-backup-' + todayISO(now) + '.json'

export function downloadBackup(S) {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = backupFileName()
  a.click()
  URL.revokeObjectURL(a.href)
}

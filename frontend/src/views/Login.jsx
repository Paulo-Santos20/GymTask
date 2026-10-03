import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { askAddDeviceData } from '../sheets.jsx'
import { auth, firebaseConfigured } from '../lib/firebase.js'
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword
} from 'firebase/auth'

// Firebase auth/* codes → source-string keys; the pt-BR wording lives in locales/pt-BR.js.
// Anything unmapped (or a non-Firebase failure such as a sync error) falls back to the
// caller's generic message, so the user never sees a raw English SDK string.
const AUTH_ERRORS = {
  'auth/invalid-credential': 'E-mail or password is incorrect',
  'auth/invalid-login-credentials': 'E-mail or password is incorrect',
  'auth/user-not-found': 'E-mail or password is incorrect',
  'auth/wrong-password': 'E-mail or password is incorrect',
  'auth/email-already-in-use': 'This e-mail is already registered',
  'auth/weak-password': 'Password too weak (minimum 6 characters)',
  'auth/invalid-email': 'Invalid e-mail address',
  'auth/missing-email': 'Enter your e-mail',
  'auth/missing-password': 'Enter your password',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/network-request-failed': 'Connection failed. Check your internet and try again.',
  'auth/operation-not-allowed': 'E-mail/password sign-in is not enabled in this Firebase project.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/invalid-action-code': 'The reset link expired or is invalid. Request a new one.',
  'auth/expired-action-code': 'The reset link expired or is invalid. Request a new one.',
}

const fail = (e, fallback) => {
  const msg = typeof e?.code === 'string' && e.code.startsWith('auth/')
    ? t(AUTH_ERRORS[e.code] || fallback)
    : (e?.message || t(fallback))
  useUI.getState().toast(msg)
}

export default function Login() {
  const { setUser, adoptProfile, setGuest } = useStore()
  const config = useStore(s => s.config)
  const canGuest = guestAllowed(config)
  const [mode, setMode] = useState('signin')   // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)

  // The store's profile shape is { id, name } (setUser checks id for the local-data owner);
  // the Firebase credential supplies both. Everything after that is exactly what sign-in
  // always did: adopt the server's copy of this profile (asking about device-only entries),
  // then welcome the user.
  const finishSignIn = async (fbUser, created) => {
    const u = {
      id: fbUser.uid,
      name: fbUser.displayName || (fbUser.email || '').split('@')[0] || 'Atleta',
      email: fbUser.email || null,
    }
    setUser(u)
    await adoptProfile(askAddDeviceData)
    useUI.getState().toast(t(created ? 'Welcome, {0}' : 'Welcome back, {0}', u.name))
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const cred = mode === 'signup'
        ? await createUserWithEmailAndPassword(auth, email.trim(), pass)
        : await signInWithEmailAndPassword(auth, email.trim(), pass)
      await finishSignIn(cred.user, mode === 'signup')
    } catch (e) {
      fail(e, mode === 'signup' ? 'Registration failed' : 'Sign-in failed')
    } finally { setBusy(false) }
  }

  const sendReset = async () => {
    if (busy) return
    if (!email.trim()) { useUI.getState().toast(t('Enter your e-mail')); return }
    setBusy(true)
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setNotice(t('Reset e-mail sent. Check your inbox.'))
    } catch (e) {
      fail(e, 'Sign-in failed')
    } finally { setBusy(false) }
  }

  const toggleMode = () => { setMode(m => (m === 'signin' ? 'signup' : 'signin')); setNotice(null) }

  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>GymTask</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Sign-in and sync across your devices come with the GymTask server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  const guestBtn = canGuest
    ? <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>
    : null

  // No credentials yet: say exactly what to configure instead of rendering a form whose
  // submit could only throw. Guest mode is local, so it still works.
  if (!firebaseConfigured) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      <div className="card small muted" style={{ textAlign: 'left' }}>{t('Configure Firebase in the .env file to sign in.')}</div>
      <div style={{ height: 14 }} />
      {guestBtn}
    </div>
  )

  const signing = mode === 'signin'
  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      <input
        className="input" type="email" inputMode="email" autoComplete="email" autoFocus
        placeholder={t('E-mail')} aria-label={t('E-mail')} maxLength={120} value={email}
        onChange={e => setEmail(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
      />
      <div style={{ height: 10 }} />
      <input
        className="input" type="password" autoComplete={signing ? 'current-password' : 'new-password'}
        placeholder={t('Password')} aria-label={t('Password')} maxLength={128} value={pass}
        onChange={e => setPass(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
      />
      {notice && <div className="card small" style={{ marginTop: 12, textAlign: 'left' }}>{notice}</div>}
      <div style={{ height: 14 }} />
      <Button variant="primary" disabled={busy} onClick={submit}>
        {busy ? t(signing ? 'Signing in' : 'Creating account') : t(signing ? 'Sign in' : 'Create account')}
      </Button>
      {signing && <>
        <div style={{ height: 10 }} />
        <Button variant="ghost" disabled={busy} onClick={sendReset}>{t('Forgot my password?')}</Button>
      </>}
      <div className="dim small" style={{ marginTop: 18 }}>
        {signing ? t("Don't have an account?") : t('Already have an account?')}
      </div>
      <div style={{ height: 6 }} />
      <Button variant="ghost" disabled={busy} onClick={toggleMode}>
        {signing ? t('Create account') : t('Sign in')}
      </Button>
      <div style={{ height: 10 }} />
      {guestBtn}
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}

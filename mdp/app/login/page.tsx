'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb, cleanError, IS_DEMO } from '@/lib/supabase';
import { Band } from '@/components/Shell';
import { normPhone, nameProblem } from '@/lib/me';

type Mode = 'signin' | 'signup' | 'forgot';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => { const m = new URLSearchParams(location.search).get('mode'); if (m === 'signup' || m === 'forgot') setMode(m); }, []);
  const go = (m: Mode) => { setMode(m); setError(''); setDone(''); };
  const next = () => { const n = new URLSearchParams(location.search).get('next'); return n && n.startsWith('/') ? n : '/'; };

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setDone('');
    const em = email.trim();
    if (mode === 'signin') {
      setBusy(true);
      const { error } = await sb().auth.signInWithPassword({ email: em, password });
      setBusy(false);
      if (error) { setError(/invalid login/i.test(error.message) ? 'That email and password don\'t match. Check for typos, or reset your password below.' : /not confirmed/i.test(error.message) ? 'Confirm your email first: open the link we sent you, then sign in.' : cleanError(error.message)); return; }
      router.push(next());
      return;
    }
    if (mode === 'forgot') {
      if (!em) { setError('Enter the email you signed up with.'); return; }
      setBusy(true);
      const { error } = await sb().auth.resetPasswordForEmail(em, { redirectTo: location.origin + '/' });
      setBusy(false);
      if (error) { setError(cleanError(error.message)); return; }
      setDone(`We sent a reset link to ${em}. Open it on this phone to set a new password. Check spam if it isn't there in a few minutes.`);
      return;
    }
    // Sign up: same checks as booking, so a new member can book straight away.
    const np = nameProblem(name); if (np) { setError(np); return; }
    const ph = normPhone(phone); if (!ph) { setError('Enter a Philippine mobile number, like 0917 123 4567.'); return; }
    if (password.length < 6) { setError('Use a password with at least 6 characters.'); return; }
    setBusy(true);
    const { data, error } = await sb().auth.signUp({ email: em, password, options: { data: { full_name: name.trim(), phone: ph }, emailRedirectTo: location.origin + '/' } });
    setBusy(false);
    if (error) { setError(/already registered/i.test(error.message) ? 'There\'s already an account with this email. Sign in, or reset your password.' : cleanError(error.message)); return; }
    if (data.session) { router.push(next()); return; }
    setDone(`Almost there. We sent a confirmation link to ${em}. Open it, then sign in here with your new password.`);
    setMode('signin');
  }

  const title = mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Sign in';
  return (
    <>
      <Band>
        <h1 className="h1" style={{ marginTop: 10 }}>{title}</h1>
        <p className="sub" style={{ marginTop: 6 }}>{IS_DEMO ? 'This is the demo. Use a demo account; real MDP passwords don\'t work here.'
          : mode === 'signup' ? 'For Match Day Pickle open play, DUPR nights and tournaments.'
          : mode === 'forgot' ? 'We\'ll email you a link to set a new one.'
          : 'Already a member? Use the same email and password as before. Your bookings, wallet and rating come with you.'}</p>
      </Band>
      <form className="section" onSubmit={submit}>
        {error && <div className="err" role="alert">{error}</div>}
        {done && <div className="okmsg" role="status">{done}</div>}
        {mode === 'signup' && <>
          <label className="field"><span>Full name</span><input className="input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name, no initials" /></label>
          <label className="field"><span>Mobile number</span><input className="input" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0917 123 4567" /></label>
        </>}
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode !== 'forgot' && <label className="field"><span>Password</span><input className="input" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={mode === 'signup' ? 6 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        <button className="btn pink" disabled={busy}>{busy ? 'One moment…' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : 'Sign in'}</button>
        <div className="stack" style={{ marginTop: 18, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          {mode !== 'signin' && <button type="button" className="link" onClick={() => go('signin')}>I have an account. Sign in</button>}
          {mode !== 'signup' && <button type="button" className="link" onClick={() => go('signup')}>New to MDP? Create an account</button>}
          {mode !== 'forgot' && <button type="button" className="link" onClick={() => go('forgot')}>Forgot your password?</button>}
        </div>
      </form>
    </>
  );
}

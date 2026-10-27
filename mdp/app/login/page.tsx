'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb, cleanError, IS_DEMO } from '@/lib/supabase';
import { Band } from '@/components/Shell';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) { setError(cleanError(error.message)); return; }
    const next = new URLSearchParams(location.search).get('next');
    router.push(next && next.startsWith('/') ? next : '/');
  }
  return (
    <>
      <Band>
        <h1 className="h1" style={{ marginTop: 10 }}>Sign in</h1>
        <p className="sub" style={{ marginTop: 6 }}>{IS_DEMO ? 'This is the demo. Use a demo account; real MDP passwords don\'t work here.' : 'Use the same email and password as before. Your bookings, wallet and rating come with you.'}</p>
      </Band>
      <form className="section" onSubmit={submit}>
        {error && <div className="err" role="alert">{error}</div>}
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="btn pink" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </>
  );
}

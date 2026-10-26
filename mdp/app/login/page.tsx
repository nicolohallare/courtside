'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb, cleanError } from '@/lib/supabase';

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
    <form className="auth-wrap" onSubmit={submit}>
      <div className="auth-ttl">Welcome Back</div>
      <div className="auth-sub">Sign in with your Match Day Pickle account: the same email and password as the current app.</div>
      {error && <div className="form-err" style={{ display: 'block' }}>{error}</div>}
      <div className="fg"><label className="flbl">Email</label><input className="finp" type="email" autoComplete="email" required placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="fg"><label className="flbl">Password</label><input className="finp" type="password" autoComplete="current-password" required placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <button className="btn btn-g" disabled={busy}>{busy ? 'Signing in…' : 'Sign In'}</button>
      <div className="auth-switch">Forgot your password? Reset it in the <a href="https://matchdaypickleop.netlify.app/" style={{ color: 'var(--pk)', fontWeight: 700 }}>current app</a>.</div>
    </form>
  );
}

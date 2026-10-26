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
    router.push('/me/');
  }
  return (
    <main className="page">
      <h1>Sign in</h1>
      <p className="muted">Use your Match Day Pickle account: the same email and password as the current app.</p>
      <form className="panel" onSubmit={submit}>
        <label className="field"><span>Email</span><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
          style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--rule)', borderRadius: 'var(--radius-s)', minHeight: 44 }} /></label>
        {error && <p className="err">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted" style={{ marginTop: 12 }}>Forgot your password? Reset it in the <a href="https://matchdaypickleop.netlify.app/">current MDP app</a>.</p>
      </form>
    </main>
  );
}

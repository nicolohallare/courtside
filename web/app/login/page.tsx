'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { sb } from '@/lib/supabase';

function LoginInner() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const router = useRouter();
  const next = useSearchParams().get('next') || '/me';

  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await sb().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setErr('That code didn’t work. Check the latest email, or send a new code.');
    else router.replace(next);
  }

  return (
    <main className="page">
      <h1>Sign in</h1>
      <div className="panel">
        {!sent ? (
          <form onSubmit={send}>
            <label className="field"><span>Email</span>
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn primary block" disabled={busy}>Email me a sign-in code</button>
            <p className="small muted" style={{ marginTop: 12 }}>One account works at every club on Courtside.</p>
          </form>
        ) : (
          <form onSubmit={verify}>
            <p>We sent a 6-digit code to <strong>{email}</strong>.</p>
            <label className="field"><span>Code</span>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <button className="btn primary block" disabled={busy}>Sign in</button>
            <p style={{ marginTop: 12 }}><button type="button" className="linkbtn" onClick={() => { setSent(false); setCode(''); }}>Use a different email</button></p>
          </form>
        )}
        {err && <p className="err" role="alert">{err}</p>}
      </div>
    </main>
  );
}

export default function Login() { return <Suspense><LoginInner /></Suspense>; }

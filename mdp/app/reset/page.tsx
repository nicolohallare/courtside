'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb, cleanError, useSession } from '@/lib/supabase';
import { Band, Empty, Loading, useToast } from '@/components/Shell';

// Where the reset link from the email lands (the app sends it here once the link signs the member in).
export default function Reset() {
  const router = useRouter();
  const toast = useToast();
  const { userId, ready } = useSession();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!ready) return <Loading />;
  if (!userId) return <Empty title="This reset link has expired"><Link className="link" href="/login/?mode=forgot">Send a new one</Link></Empty>;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('');
    if (pw.length < 6) { setError('Use at least 6 characters.'); return; }
    if (pw !== pw2) { setError('The two passwords don\'t match.'); return; }
    setBusy(true);
    const { error } = await sb().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setError(cleanError(error.message)); return; }
    toast('Password changed. You\'re signed in.');
    router.push('/');
  }
  return (
    <>
      <Band><h1 className="h1" style={{ marginTop: 10 }}>Set a new password</h1></Band>
      <form className="section" onSubmit={submit}>
        {error && <div className="err" role="alert">{error}</div>}
        <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="field"><span>Type it again</span><input className="input" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <button className="btn pink" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </>
  );
}

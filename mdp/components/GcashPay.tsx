'use client';
import { useRef, useState } from 'react';
import { sb } from '@/lib/supabase';
import { uploadReceipt } from '@/lib/sessions';
import { peso } from '@/lib/format';
import { useToast } from './Shell';

/** Step 2: send the exact amount to MDP's GCash and upload the receipt. */
export function GcashPay({ amount, name, number, acct, uploadQuery = '', busy, onSubmit }: {
  amount: number; name: string; number: string | null; acct: string | null; uploadQuery?: string; busy: boolean;
  onSubmit: (proofUrl: string, ref: string) => void;
}) {
  const toast = useToast();
  const [preview, setPreview] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'up' | 'ok' | 'fail'>('idle');
  const [ref, setRef] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Please pick an image (JPG or PNG)', true); return; }
    if (f.size > 5 * 1024 * 1024) { toast('Image too large (max 5 MB)', true); return; }
    setPreview(URL.createObjectURL(f)); setState('up'); setPct(0); setUrl(null);
    try {
      const { data } = await sb().auth.getSession();
      const u = await uploadReceipt(f, data.session?.access_token ?? '', uploadQuery, setPct);
      setUrl(u); setState('ok');
    } catch (e) { setState('fail'); toast('⚠️ ' + (e as Error).message, true); }
  }
  return (
    <div className="gw">
      <div className="g-hero">
        <div className="g-eye">Step 2 of 2 · Pay via GCash</div>
        <div className="g-ttl">Send Payment</div>
        <div className="g-sub">Send the exact amount below to Match Day Pickle, then upload your receipt.</div>
      </div>
      <div className="amt-badge">
        <div className="amt-lbl">Amount to send via GCash</div>
        <div className="amt-val">{peso(amount)}</div>
        <div className="amt-name">for {name}</div>
      </div>
      <div className="steps">
        <div className="step"><div className="step-n">1</div><div><div className="step-ttl">Open GCash → Send Money</div><div className="step-dsc">Tap &quot;Express Send&quot;</div></div></div>
        <div className="step"><div className="step-n">2</div><div><div className="step-ttl">Enter the number and exact amount</div><div className="step-dsc">Add your full name in the message</div></div></div>
        <div className="step"><div className="step-n">3</div><div><div className="step-ttl">Screenshot the confirmation</div><div className="step-dsc">Upload it below. It&apos;s checked automatically.</div></div></div>
      </div>
      <div className="gbox">
        <div className="gbox-ttl">Send to</div>
        <div className="num-row">
          <div><div className="num-lbl">Mobile Number</div><div className="num-val">{number ?? '—'}</div><div className="num-name">{acct ?? ''}</div></div>
          <button className="copy-btn" onClick={() => { navigator.clipboard?.writeText(number ?? ''); toast('Number copied'); }}>Copy</button>
        </div>
        <label className="flbl">Payment screenshot</label>
        {!preview ? (
          <div className="upload-zone" onClick={() => input.current?.click()}>
            <div className="upload-icon">📸</div><div className="upload-ttl">Tap to upload screenshot</div><div className="upload-sub">JPG or PNG · Max 5MB</div>
          </div>
        ) : (
          <div className="upload-prev" style={{ display: 'block' }}>
            <img src={preview} alt="Your GCash receipt" />
            <button className="rm-img" onClick={() => { setPreview(null); setUrl(null); setState('idle'); if (input.current) input.current.value = ''; }}>✕</button>
            <div className="upload-prev-status">
              <span>{state === 'up' ? `Uploading… ${pct}%` : state === 'ok' ? '✓ Uploaded · ready to submit' : '✗ Upload failed. Tap ✕ and try again.'}</span>
              <div className="upload-prev-bar"><div className="upload-prev-bar-fill" style={{ width: (state === 'ok' ? 100 : pct) + '%' }} /></div>
            </div>
          </div>
        )}
        <input ref={input} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
        <label className="flbl" style={{ marginTop: 12 }}>GCash reference number <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span></label>
        <input className="finp" inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value.replace(/\D/g, '').slice(0, 13))} placeholder="13 digits, on your receipt" />
      </div>
      <button className="btn btn-g" disabled={busy || state !== 'ok' || !url} onClick={() => url && onSubmit(url, ref)}>
        {busy ? 'Submitting…' : state === 'up' ? 'Waiting for upload…' : 'Submit payment'}
      </button>
    </div>
  );
}

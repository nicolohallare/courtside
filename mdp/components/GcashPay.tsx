'use client';
import { useRef, useState } from 'react';
import { sb } from '@/lib/supabase';
import { uploadReceipt } from '@/lib/sessions';
import { useToast } from './Shell';
import { Icon } from './Icon';

/** Send the exact amount to the GCash number shown, then upload the receipt. It's checked automatically. */
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
    if (!f.type.startsWith('image/')) { toast('Pick a screenshot (JPG or PNG).', true); return; }
    if (f.size > 5 * 1024 * 1024) { toast('That image is over 5 MB. Crop it or take a new screenshot.', true); return; }
    setPreview(URL.createObjectURL(f)); setState('up'); setPct(0); setUrl(null);
    try {
      const { data } = await sb().auth.getSession();
      setUrl(await uploadReceipt(f, data.session?.access_token ?? '', uploadQuery, setPct)); setState('ok');
    } catch (e) { setState('fail'); toast((e as Error).message, true); }
  }
  const clear = () => { setPreview(null); setUrl(null); setState('idle'); if (input.current) input.current.value = ''; };

  return (
    <div className="stack">
      <div className="send-to">
        <div style={{ flex: 1 }}>
          <div className="small muted">Send to GCash</div>
          <div className="num">{number ?? '—'}</div>
          <div className="small muted">{acct ?? ''}</div>
        </div>
        <button className="btn sm ghost inline" onClick={() => { navigator.clipboard?.writeText(number ?? ''); toast('Number copied'); }}><Icon name="copy" />Copy</button>
      </div>
      <ol className="howto card">
        <li>Open GCash, tap Send Money, then Express Send.</li>
        <li>Send exactly the amount above. Put &ldquo;{name}&rdquo; in the message.</li>
        <li>Screenshot the confirmation and upload it here.</li>
      </ol>
      {!preview
        ? <button className="drop" onClick={() => input.current?.click()}><Icon name="upload" /><b>Upload your GCash receipt</b><span className="small muted">JPG or PNG, up to 5 MB</span></button>
        : <div className="receipt">
            <img src={preview} alt="Your GCash receipt" />
            <button className="x" onClick={clear} aria-label="Remove receipt">✕</button>
            <div className="st">{state === 'up' ? `Uploading ${pct}%` : state === 'ok' ? 'Uploaded. Ready to send.' : 'Upload failed. Remove it and try again.'}</div>
            {state === 'up' && <div className="bar"><i style={{ width: pct + '%' }} /></div>}
          </div>}
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      <label className="field"><span>GCash reference number (optional)</span>
        <input className="input" inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value.replace(/\D/g, '').slice(0, 13))} placeholder="13 digits, on your receipt" />
      </label>
      <button className="btn pink" disabled={busy || state !== 'ok' || !url} onClick={() => url && onSubmit(url, ref)}>
        {busy ? 'Sending…' : state === 'up' ? 'Uploading receipt…' : 'Send receipt'}
      </button>
      <p className="small muted" style={{ textAlign: 'center' }}>Receipts are checked automatically, usually within a minute. Your spot is held while we check.</p>
    </div>
  );
}

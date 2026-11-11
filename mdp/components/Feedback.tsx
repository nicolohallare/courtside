'use client';
import { useEffect, useState } from 'react';
import { sb, SB_URL } from '@/lib/supabase';
import { supportApi } from '@/lib/admin';
import { Sheet, useToast } from './Shell';

interface Mine { id: string; kind: string; description: string; status: string; admin_reply: string | null; created_at: string }
const KINDS = [['bug', 'Problem'], ['question', 'Question'], ['feature', 'Idea'], ['other', 'Other']] as const;

/** Send a problem, question or idea to the admins, with an optional screenshot, and see their replies. */
export function Feedback({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState('bug');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<Mine[]>([]);
  useEffect(() => { supportApi<{ tickets: Mine[] }>('my-tickets').then((r) => setMine(r.tickets ?? [])).catch(() => {}); }, []);

  async function send() {
    if (text.trim().length < 3) { toast('Tell us a bit more first.', true); return; }
    setBusy(true);
    try {
      let shot: string | null = null;
      if (file) {
        const { data } = await sb().auth.getSession();
        const r = await fetch(`${SB_URL}/functions/v1/support`, { method: 'POST', body: file, headers: {
          'Content-Type': file.type || 'image/jpeg', 'x-file-type': file.type || 'image/jpeg', 'x-mdp-action': 'upload-screenshot',
          Authorization: `Bearer ${data.session?.access_token ?? ''}` } });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || 'The screenshot didn\'t upload');
        shot = j.url;
      }
      await supportApi('create-ticket', 'POST', { kind, description: text.trim(), screenshot_url: shot, user_agent: navigator.userAgent, app_version: 'v2' });
      toast('Sent. An admin will reply here.'); onClose();
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  return (
    <Sheet title="Report a problem or send feedback" onClose={onClose}>
      <div className="seg" style={{ marginBottom: 12 }}>{KINDS.map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
      <label className="field"><span>What happened?</span><textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="For payments, include the session and the GCash reference." /></label>
      <label className="field"><span>Screenshot (optional)</span><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <button className="btn pink" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
      {mine.length > 0 && <div className="stack" style={{ marginTop: 18 }}>
        <div className="h3">Your earlier messages</div>
        {mine.slice(0, 5).map((t) => (
          <div key={t.id} className="card small">
            <div className="between"><b>{new Date(t.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</b><span className={'tag ' + (t.status === 'resolved' ? 'ok' : 'wait')}>{t.status === 'resolved' ? 'Resolved' : t.status === 'reviewing' ? 'Being checked' : 'Open'}</span></div>
            <p style={{ marginTop: 4 }}>{t.description}</p>
            {t.admin_reply && <p style={{ marginTop: 6 }}><b>Admin:</b> {t.admin_reply}</p>}
          </div>
        ))}
      </div>}
    </Sheet>
  );
}

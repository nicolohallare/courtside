'use client';
import { useEffect, useState } from 'react';
import { rpc } from '@/lib/supabase';
import { Loading, Sheet, useToast } from './Shell';

export interface Rules { version: number; title: string; intro: string | null; sections: { heading: string; body: string }[]; already_accepted: boolean }
export const loadRules = () => rpc<Rules | null>('current_rules');

/** The club's house rules. With onAccept, it asks the member to agree before going on. */
export function RulesSheet({ onClose, onAccept }: { onClose: () => void; onAccept?: () => void }) {
  const toast = useToast();
  const [r, setR] = useState<Rules | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadRules().then(setR).catch(() => setR(null)); }, []);
  async function accept() {
    if (!r) { onAccept?.(); return; }
    setBusy(true);
    try { await rpc('accept_rules', { p_version: r.version }); onAccept?.(); }
    catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  return (
    <Sheet title={r?.title ?? 'House rules'} onClose={onClose}>
      {r === undefined ? <Loading rows={2} /> : !r ? <p className="sub">No house rules posted.</p> : (
        <div className="stack">
          {r.intro && <p className="sub">{r.intro}</p>}
          {r.sections.map((x, i) => <div key={i}><b>{x.heading}</b><p className="small" style={{ marginTop: 2, whiteSpace: 'pre-line' }}>{x.body}</p></div>)}
          {onAccept && <button className="btn pink" disabled={busy} onClick={accept}>{busy ? 'Saving…' : 'I agree, continue'}</button>}
        </div>
      )}
    </Sheet>
  );
}

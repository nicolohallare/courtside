'use client';
// Players without DUPR say their level once, before their first booking. The host sees it as
// "self-rated" and can change it; a DUPR rating replaces it as soon as the player connects.
import { useState } from 'react';
import { rpc } from '@/lib/supabase';
import { Sheet, useToast } from '@/components/Shell';

export const LEVEL_CHOICES: { k: string; v: 'N' | 'LI' | 'HI'; label: string; desc: string }[] = [
  { k: 'B', v: 'N', label: 'Beginner', desc: 'New to pickleball. Still learning to serve, score and keep a rally going.' },
  { k: 'N', v: 'N', label: 'Novice', desc: 'Can serve, keep score and play a full game. Knows the kitchen rule.' },
  { k: 'LI', v: 'LI', label: 'Low-Intermediate', desc: 'Dinks, plays to place the ball, and gets to the kitchen line.' },
  { k: 'HI', v: 'HI', label: 'High-Intermediate', desc: 'Steady third shots, resets and hand battles. Around DUPR 3.5 and up.' },
];
export const LEVEL_NAMES: Record<string, string> = { N: 'Novice', LI: 'Low-Intermediate', HI: 'High-Intermediate' };

export function LevelSheet({ onClose, onDone }: { onClose: () => void; onDone: (v: string) => void }) {
  const toast = useToast();
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    const c = LEVEL_CHOICES.find((x) => x.k === pick); if (!c) return;
    setBusy(true);
    try { await rpc('set_my_level', { p_level: c.v }); onDone(c.v); }
    catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }
  return (
    <Sheet title="What's your level?" onClose={onClose}>
      <p className="small muted" style={{ marginBottom: 12 }}>So the host puts you with players at your level. You only answer this once. Connect DUPR in Me and your rating takes over.</p>
      <div className="stack">
        {LEVEL_CHOICES.map((c) => (
          <label key={c.k} className={'check' + (pick === c.k ? ' on' : '')}>
            <input type="radio" name="my-level" checked={pick === c.k} onChange={() => setPick(c.k)} />
            <span><b>{c.label}</b><br /><span className="small muted">{c.desc}</span></span>
          </label>
        ))}
      </div>
      <button className="btn pink" style={{ marginTop: 14 }} disabled={busy || !pick} onClick={save}>{busy ? 'Saving…' : 'Continue'}</button>
    </Sheet>
  );
}

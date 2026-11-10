'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AdminBand, AdminOnly } from '@/components/AdminBits';
import { Loading, useToast } from '@/components/Shell';
import { fmtDate, manilaToday, peso } from '@/lib/format';
import { useMe } from '@/lib/me';
import { mdpApi } from '@/lib/supabase';
import { loadAdminSessions, nextSameWeekday, repeatOf, type AdminSess } from '@/lib/admin';

export default function EditSession() {
  return <AdminOnly><Form /></AdminOnly>;
}

type F = Record<string, string | boolean>;

const WINDOW_DAYS = { varsity: 14, member: 5 } as const;
const WINDOWS_TEXT = 'Varsity 2 weeks before, Members 5 days, Community 3 days, Flagged 1 hour.';
const openIso = (date: string, days: number, time: string) => {
  const [y, m, dd] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, dd - days, h - 8, mi, 0)).toISOString();
};

function toForm(s: Partial<AdminSess> & { dupr_access?: string | null }): F {
  const date = String(s.session_date ?? '');
  const str = (x: unknown) => (x === null || x === undefined ? '' : String(x));
  return {
    session_type: s.session_type === 'coaching' ? 'coaching' : 'open_play',
    label: str(s.label), session_date: date, time_start: str(s.time_start).slice(0, 5), time_end: str(s.time_end).slice(0, 5), venue: str(s.venue),
    fee: str(s.fee), max_players: str(s.max_players), courts: str(s.courts), venue_fee: str(s.venue_fee),
    gcash_number: str(s.gcash_number), gcash_name: str(s.gcash_name), backup_gcash_number: str(s.backup_gcash_number), backup_gcash_name: str(s.backup_gcash_name),
    notes: str(s.notes), requires_approval: !!s.requires_approval, dupr_access: str(s.dupr_access),
    coach_name: str(s.coach_name), court_fee: str(s.court_fee), ballboy_fee: str(s.ballboy_fee), coach_fee: str(s.coach_fee),
    coach_gcash_number: str(s.coach_gcash_number), coach_gcash_name: str(s.coach_gcash_name),
  };
}

function Form() {
  const router = useRouter();
  const toast = useToast();
  const { profile } = useMe();
  const [mode, setMode] = useState<{ k: 'new' | 'edit' | 'repeat'; src?: AdminSess } | null>(null);
  const [f, setF] = useState<F | null>(null);
  const [recent, setRecent] = useState<AdminSess[]>([]);
  const [busy, setBusy] = useState(false);
  const [publish, setPublish] = useState(true);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    loadAdminSessions().then((list) => {
      const real = list.filter((s) => !s.is_cancelled).sort((a, b) => b.session_date.localeCompare(a.session_date));
      // One example per weekly slot (same name and venue), newest first, to start from.
      const seen = new Set<string>(); setRecent(real.filter((s) => { const k = s.label + '|' + s.venue; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 6));
      const id = q.get('id'), from = q.get('from');
      if (id) { const s = list.find((x) => x.id === id); if (s) { setMode({ k: 'edit', src: s }); setF(toForm(s)); } return; }
      const src = (from && list.find((x) => x.id === from)) || real[0];
      if (src) { const date = q.get('date') || nextSameWeekday(src.session_date); setMode({ k: from ? 'repeat' : 'new', src }); setF(toForm({ ...src, ...repeatOf(src, date) })); }
      else { setMode({ k: 'new' }); setF(toForm({ session_date: manilaToday(), time_start: '19:00', time_end: '22:00', fee: 350, max_players: 24, courts: 3 })); }
    }).catch((e) => toast((e as Error).message, true));
  }, [toast]);

  if (!f || !mode) return <><AdminBand title="Session" back={{ href: '/admin/sessions/', label: 'Sessions' }} /><Loading /></>;
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const training = f.session_type === 'coaching';
  const txt = (k: string, label: string, props: Record<string, unknown> = {}) => (
    <label className="field"><span>{label}</span><input className="input" value={String(f[k] ?? '')} onChange={set(k)} {...props} /></label>
  );

  function startFrom(s: AdminSess) {
    const date = nextSameWeekday(s.session_date);
    setMode({ k: 'new', src: s }); setF(toForm({ ...s, ...repeatOf(s, date) }));
  }

  async function save() {
    if (!f) return;
    const n = (k: string) => (String(f[k]).trim() === '' ? null : Number(f[k]));
    const t = (k: string) => String(f[k] ?? '').trim();
    if (!t('label') || !t('session_date') || !t('venue') || !t('gcash_number') || !t('gcash_name')) { toast('Fill in the name, date, venue and GCash details.', true); return; }
    if (!/^(09\d{9}|639\d{9})$/.test(t('gcash_number').replace(/\D/g, ''))) { toast('The GCash number should look like 09XXXXXXXXX.', true); return; }
    if (!!t('backup_gcash_number') !== !!t('backup_gcash_name')) { toast('Backup GCash: fill in both the number and the name, or neither.', true); return; }
    const body: Record<string, unknown> = {
      label: t('label'), session_date: t('session_date'), venue: t('venue'), time_start: t('time_start'), time_end: t('time_end'),
      fee: n('fee') ?? 0, max_players: n('max_players') ?? 24, courts: n('courts'), venue_fee: n('venue_fee') ?? 0,
      gcash_number: t('gcash_number'), gcash_name: t('gcash_name'), backup_gcash_number: t('backup_gcash_number') || null, backup_gcash_name: t('backup_gcash_name') || null,
      notes: t('notes'), requires_approval: !!f.requires_approval, dupr_access: t('dupr_access') || null,
      session_type: training ? 'coaching' : 'open_play', is_active: true, visibility: mode?.src?.visibility ?? 'public',
      // Standard booking windows, the same for every session (Nov 2026): Varsity 2 weeks before the start,
      // Members 5 days. Community (3 days) and Flagged (1 hour) follow the tier rules in the database.
      varsity_reg_opens_at: openIso(t('session_date'), WINDOW_DAYS.varsity, t('time_start') || '18:00'),
      public_reg_opens_at: openIso(t('session_date'), WINDOW_DAYS.member, t('time_start') || '18:00'),
    };
    if (mode?.k !== 'edit' && mode?.src) { body.venue_id = mode.src.venue_id; body.gcash_owner_user_id = mode.src.gcash_owner_user_id; }
    if (training) {
      const court = n('court_fee') ?? 0, ball = n('ballboy_fee') ?? 0, coach = n('coach_fee') ?? 0;
      if (!t('coach_gcash_number') || !t('coach_gcash_name')) { toast('Training needs the coach\'s GCash number and name.', true); return; }
      Object.assign(body, { coach_name: t('coach_name') || null, court_fee: court, ballboy_fee: ball, coach_fee: coach, fee: court + ball + coach, coach_gcash_number: t('coach_gcash_number'), coach_gcash_name: t('coach_gcash_name') });
    } else Object.assign(body, { coach_name: null, court_fee: 0, ballboy_fee: 0, coach_fee: 0, coach_gcash_number: null, coach_gcash_name: null });

    setBusy(true);
    try {
      if (mode?.k === 'edit' && mode.src) {
        const res = await mdpApi<{ _reconciliation?: Record<string, number> }>('update-session', '', { method: 'PATCH', body: { id: mode.src.id, ...body } });
        const r = res?._reconciliation; const bits = r ? [r.auto_applied && `${r.auto_applied} charged from wallet`, r.refunded && `${r.refunded} refunded to wallet`, r.reverted_to_pending && `${r.reverted_to_pending} asked to pay the difference`].filter(Boolean) : [];
        toast('Saved' + (bits.length ? '. ' + bits.join(', ') : ''));
        router.push('/admin/session/?id=' + mode.src.id);
      } else {
        const made = await mdpApi<{ id: string }>('create-session', '', { method: 'POST', body });
        if (publish) await mdpApi('publish-session', '', { method: 'POST', body: { session_id: made.id } });
        toast(publish ? 'Published. Members can book when registration opens.' : 'Saved as a draft');
        router.push('/admin/session/?id=' + made.id);
      }
    } catch (e) { toast((e as Error).message, true); }
    setBusy(false);
  }

  const editing = mode.k === 'edit';
  return (
    <>
      <AdminBand title={editing ? 'Edit session' : 'New session'} back={{ href: editing && mode.src ? '/admin/session/?id=' + mode.src.id : '/admin/sessions/', label: editing ? 'Session' : 'Sessions' }}
        sub={!editing && mode.src ? `Filled in from ${mode.src.label}, ${fmtDate(mode.src.session_date)}. Change what's different.` : undefined} />

      {!editing && recent.length > 1 && (<>
        <div className="small muted pad" style={{ paddingTop: 14, fontWeight: 700 }}>Start from</div>
        <div className="chips" aria-label="Start from" style={{ paddingTop: 8 }}>
          {recent.map((s) => <button key={s.id} className={'chip' + (mode.src?.id === s.id ? ' on' : '')} onClick={() => startFrom(s)}>{s.label}</button>)}
        </div>
      </>)}

      <div className="section">
        {profile?.super_admin && (
          <div className="seg" style={{ marginBottom: 16 }}>
            <button className={!training ? 'on' : ''} onClick={() => setF({ ...f, session_type: 'open_play' })}>Open play</button>
            <button className={training ? 'on' : ''} onClick={() => setF({ ...f, session_type: 'coaching' })}>Training</button>
          </div>
        )}
        {txt('label', 'Name', { placeholder: 'e.g. Tuesday Open Play' })}
        <div className="form-grid">
          {txt('session_date', 'Date', { type: 'date' })}
          {txt(training ? 'max_players' : 'fee', training ? 'Players per slot' : 'Fee per player (₱)', { type: 'number', inputMode: 'numeric' })}
          {txt('time_start', 'Starts', { type: 'time' })}
          {txt('time_end', 'Ends', { type: 'time' })}
        </div>
        {txt('venue', 'Venue')}
        <p className="small muted" style={{ marginTop: -6, marginBottom: 14 }}>Booking opens: {WINDOWS_TEXT}</p>
        {!training && <div className="form-grid">{txt('max_players', 'Max players', { type: 'number', inputMode: 'numeric' })}{txt('courts', 'Courts', { type: 'number', inputMode: 'numeric' })}</div>}

        {training && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="h3" style={{ marginBottom: 10 }}>Coach</div>
            {txt('coach_name', 'Coach\'s name')}
            <div className="form-grid">{txt('court_fee', 'Court (₱ total)', { type: 'number' })}{txt('ballboy_fee', 'Ball boy (₱ total)', { type: 'number' })}</div>
            {txt('coach_fee', 'Coach (₱ per person)', { type: 'number' })}
            <div className="form-grid">{txt('coach_gcash_number', 'Coach GCash number', { inputMode: 'tel' })}{txt('coach_gcash_name', 'Coach GCash name')}</div>
            <p className="small muted">Solo price {peso((Number(f.court_fee) || 0) + (Number(f.ballboy_fee) || 0) + (Number(f.coach_fee) || 0))}. Pairs split the court and ball boy.</p>
          </div>
        )}

        <div className="form-grid">{txt('gcash_number', 'GCash number', { inputMode: 'tel', placeholder: '09XXXXXXXXX' })}{txt('gcash_name', 'GCash name')}</div>

        <label className="field"><span>DUPR</span>
          <select className="input" value={String(f.dupr_access)} onChange={set('dupr_access')}>
            <option value="">Anyone can join</option>
            <option value="BASIC_L1">Needs a DUPR account (games sent to DUPR)</option>
            <option value="PREMIUM_L1">DUPR+ members only</option>
          </select>
        </label>

        <details className="more">
          <summary>More: backup GCash, notes, host approval</summary>
          <div style={{ marginTop: 8 }} />
          <div className="form-grid">{txt('backup_gcash_number', 'Backup GCash number', { inputMode: 'tel' })}{txt('backup_gcash_name', 'Backup GCash name')}</div>
          {txt('venue_fee', 'Venue fee paid at the door (₱)', { type: 'number', inputMode: 'numeric' })}
          <label className={'check' + (f.requires_approval ? ' on' : '')} style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={!!f.requires_approval} onChange={(e) => setF({ ...f, requires_approval: e.target.checked })} />
            <span><b>Host approves players</b><br /><span className="small muted">Players ask to join and pay only after you accept them.</span></span>
          </label>
          <label className="field"><span>Notes for players</span><textarea className="input" rows={3} value={String(f.notes)} onChange={set('notes')} /></label>
        </details>

        {!editing && (
          <label className={'check' + (publish ? ' on' : '')} style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
            <span><b>Publish now</b><br /><span className="small muted">Booking opens the standard way: {WINDOWS_TEXT}</span></span>
          </label>
        )}
        <button className="btn pink" disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save changes' : publish ? 'Create and publish' : 'Save as draft'}</button>
      </div>
      <div style={{ height: 24 }} />
    </>
  );
}

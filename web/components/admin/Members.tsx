'use client';
import { useCallback, useEffect, useState } from 'react';
import { rpc, sb } from '@/lib/supabase';
import { ROLE_LABEL, type Role, fmtDay } from '@/lib/format';
import { Loading, useToast } from '@/components/ui';
import type { AdminProps } from './Overview';

interface Member { user_id: string; full_name: string; phone: string | null; role: Role; note: string | null; joined_at: string; rules_version_accepted: number | null; bookings: number }
interface RoleRule { role: Role; window_hours: number; max_guests: number }
const ASSIGNABLE: Role[] = ['member', 'varsity', 'flagged', 'host', 'admin', 'owner', 'banned'];
const BOOKING_ROLES: Role[] = ['varsity', 'member', 'flagged'];

export default function Members({ club, isAdmin }: AdminProps) {
  const toast = useToast();
  const [rows, setRows] = useState<Member[] | null>(null);
  const [rules, setRules] = useState<RoleRule[]>([]);
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    setRows(await rpc<Member[]>('club_members', { p_club: club.id }));
    const { data } = await sb().from('club_role_rules').select('*').eq('club_id', club.id);
    setRules((data ?? []) as RoleRule[]);
  }, [club.id]);
  useEffect(() => { load(); }, [load]);

  async function setRole(m: Member, role: Role) {
    let note: string | null = null;
    if (['flagged', 'banned'].includes(role)) { note = prompt(`Why is ${m.full_name} ${role}? (staff only)`); if (!note) return; }
    try { await rpc('set_member_role', { p_club: club.id, p_user: m.user_id, p_role: role, p_note: note }); toast(`${m.full_name} is now ${ROLE_LABEL[role].toLowerCase()}`); load(); }
    catch (e) { toast((e as Error).message, true); load(); }
  }
  async function saveRule(e: React.FormEvent<HTMLFormElement>, role: Role) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    try { await rpc('set_role_rule', { p_club: club.id, p_role: role, p_window_hours: Math.round(Number(f.get('days')) * 24), p_max_guests: Number(f.get('guests')) }); toast('Saved'); load(); }
    catch (err) { toast((err as Error).message, true); }
  }

  if (!rows) return <Loading />;
  const shown = rows.filter((m) => !q || (m.full_name + (m.phone ?? '')).toLowerCase().includes(q.toLowerCase()));
  const pending = rows.filter((m) => m.role === 'pending');

  return (
    <div>
      {pending.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--hold)' }}>
          <h3>Asking to join</h3>
          {pending.map((m) => (
            <div key={m.user_id} className="row between" style={{ padding: '4px 0' }}>
              <span>{m.full_name} <span className="small muted">{m.phone}</span></span>
              {isAdmin && <span><button className="btn sm court" onClick={() => setRole(m, 'member')}>Approve</button> <button className="linkbtn small" onClick={() => setRole(m, 'banned')}>Decline</button></span>}
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          <h2>Who can book when</h2>
          <div className="panel">
            <p className="small muted" style={{ marginTop: 0 }}>How long before a session each group can book, and how many guests they can bring. Enforced on the server.</p>
            {BOOKING_ROLES.map((role) => { const r = rules.find((x) => x.role === role); return (
              <form key={role} className="row" onSubmit={(e) => saveRule(e, role)} style={{ marginBottom: 6 }}>
                <strong style={{ width: 90 }}>{ROLE_LABEL[role]}</strong>
                <label className="row small" style={{ gap: 4 }}><input type="number" name="days" min={0} max={90} step={0.25} defaultValue={r ? +(r.window_hours / 24).toFixed(2) : 3} style={{ width: 80 }} />days before</label>
                <label className="row small" style={{ gap: 4 }}><input type="number" name="guests" min={0} max={10} defaultValue={r?.max_guests ?? 1} style={{ width: 64 }} />guests</label>
                <button className="btn sm">Save</button>
              </form>); })}
            <p className="small muted">Tip: flagged players at 0.04 days (1 hour) with 0 guests matches MDP’s setup.</p>
          </div>
        </>
      )}

      <h2>Members ({rows.length})</h2>
      <input type="text" placeholder="Search name or mobile" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      <div className="panel grid-wrap">
        <table className="t">
          <thead><tr><th>Name</th><th>Joined</th><th>Games</th><th>Role</th></tr></thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.user_id}>
                <td><strong>{m.full_name}</strong><div className="small muted">{m.phone}</div>{m.note && <div className="small err">{m.note}</div>}</td>
                <td className="small">{fmtDay(m.joined_at)}</td>
                <td className="num">{m.bookings}</td>
                <td>{isAdmin ? (
                  <select value={m.role} onChange={(e) => setRole(m, e.target.value as Role)} style={{ width: 'auto' }}>
                    {(m.role === 'pending' ? ['pending' as Role, ...ASSIGNABLE] : ASSIGNABLE).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>) : ROLE_LABEL[m.role]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

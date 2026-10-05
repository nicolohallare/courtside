'use client';
import { useEffect, useState } from 'react';
import { rpc, sb } from '@/lib/supabase';
import { useToast } from '@/components/ui';
import type { AdminProps } from './Overview';

export default function Settings({ club, onChange }: AdminProps) {
  const toast = useToast();
  const [rules, setRules] = useState<{ version: number; body: string } | null>(null);
  useEffect(() => {
    sb().from('house_rules').select('version, body').eq('club_id', club.id).order('version', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setRules(data));
  }, [club.id]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const patch: Record<string, unknown> = {};
    for (const k of ['name', 'tagline', 'venue_name', 'address', 'city', 'gcash_number', 'gcash_name', 'join_policy']) patch[k] = String(f.get(k) ?? '');
    for (const k of ['refund_cutoff_hours', 'court_booking_days_ahead', 'court_min_minutes', 'court_max_minutes', 'court_slot_minutes']) patch[k] = Number(f.get(k));
    patch.is_published = f.get('is_published') === 'on';
    try { await rpc('update_club', { p_club: club.id, p_patch: patch }); toast('Settings saved'); onChange(); }
    catch (err) { toast((err as Error).message, true); }
  }
  async function publishRules(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const body = String(new FormData(e.currentTarget).get('body') ?? '');
    if (!confirm('Publish these rules? Every member will be asked to accept them again before their next booking.')) return;
    try { const v = await rpc<number>('publish_house_rules', { p_club: club.id, p_body: body }); setRules({ version: v, body }); toast(`House rules version ${v} published`); }
    catch (err) { toast((err as Error).message, true); }
  }

  return (
    <div>
      <form className="panel" onSubmit={save}>
        <h2>Club</h2>
        <label className="field"><span>Name</span><input type="text" name="name" defaultValue={club.name} required /></label>
        <label className="field"><span>Short description</span><input type="text" name="tagline" defaultValue={club.tagline ?? ''} /></label>
        <div className="row">
          <label className="field grow"><span>Venue</span><input type="text" name="venue_name" defaultValue={club.venue_name ?? ''} /></label>
          <label className="field grow"><span>City</span><input type="text" name="city" defaultValue={club.city ?? ''} /></label>
        </div>
        <label className="field"><span>Address</span><input type="text" name="address" defaultValue={club.address ?? ''} /></label>

        <h2 style={{ marginTop: 18 }}>Getting paid</h2>
        <p className="small muted">Players send GCash transfers to this number. Receipts are checked against it automatically, so it must be the club’s own account.</p>
        <div className="row">
          <label className="field grow"><span>Club GCash number</span><input type="tel" name="gcash_number" defaultValue={club.gcash_number ?? ''} placeholder="09XXXXXXXXX" /></label>
          <label className="field grow"><span>Name on the GCash account</span><input type="text" name="gcash_name" defaultValue={club.gcash_name ?? ''} /></label>
        </div>
        <p className="small">Instant pay (QR Ph, Maya, cards): {club.techpay_enabled ? <span className="tag ok">On</span> : <span className="tag">Not set up</span>} <span className="muted">The platform team switches this on after TechPay onboarding.</span></p>

        <h2 style={{ marginTop: 18 }}>Policies</h2>
        <div className="row">
          <label className="field grow"><span>New members</span>
            <select name="join_policy" defaultValue={club.join_policy}><option value="open">Anyone can join</option><option value="approval">Admins approve each one</option></select></label>
          <label className="field grow"><span>Free cancellation until (hours before)</span><input type="number" name="refund_cutoff_hours" min={0} max={336} defaultValue={club.refund_cutoff_hours} /></label>
        </div>
        <div className="row">
          <label className="field grow"><span>Court rentals: days ahead</span><input type="number" name="court_booking_days_ahead" min={1} max={90} defaultValue={club.court_booking_days_ahead} /></label>
          <label className="field grow"><span>Slot length</span>
            <select name="court_slot_minutes" defaultValue={club.court_slot_minutes}><option value={30}>30 min</option><option value={60}>60 min</option></select></label>
          <label className="field grow"><span>Shortest booking (min)</span>
            <select name="court_min_minutes" defaultValue={club.court_min_minutes}>{[30, 60, 90, 120].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label className="field grow"><span>Longest booking (min)</span><input type="number" name="court_max_minutes" min={30} max={720} step={30} defaultValue={club.court_max_minutes} /></label>
        </div>
        <label className="row" style={{ gap: 8, margin: '8px 0 16px' }}><input type="checkbox" name="is_published" defaultChecked={club.is_published} /> Club is visible to players</label>
        <button className="btn primary">Save settings</button>
      </form>

      <form className="panel" onSubmit={publishRules}>
        <h2>House rules</h2>
        <p className="small muted">{rules ? `Version ${rules.version} is live. ` : ''}Players accept these before their first booking, and again whenever you publish a new version.</p>
        <textarea name="body" defaultValue={rules?.body ?? ''} style={{ minHeight: 220 }} placeholder="Arrive 10 minutes early. Paddles down when the host calls time. No-shows without notice may lose early booking." />
        <button className="btn court" style={{ marginTop: 10 }}>Publish rules</button>
      </form>
    </div>
  );
}

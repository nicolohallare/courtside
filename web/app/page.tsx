'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { sb, useSession } from '@/lib/supabase';
import type { Club } from '@/lib/format';
import { Loading } from '@/components/ui';

export default function Home() {
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const { userId } = useSession();

  useEffect(() => {
    sb().from('clubs').select('*').eq('is_published', true).order('name').then(({ data }) => setClubs((data ?? []) as Club[]));
  }, []);
  useEffect(() => {
    if (!userId) return;
    sb().from('memberships').select('club_id').eq('user_id', userId)
      .then(({ data }) => setMine(new Set((data ?? []).map((m: { club_id: string }) => m.club_id))));
  }, [userId]);

  const sorted = (clubs ?? []).slice().sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)));
  return (
    <main className="page">
      <h1>Find your game</h1>
      <p className="muted">Book open play or rent a court. You pay the club directly, and every payment is checked.</p>
      {!clubs ? <Loading /> : clubs.length === 0 ? (
        <div className="panel"><p>No clubs are live yet.</p></div>
      ) : (
        <div className="panel">
          {sorted.map((c) => (
            <Link key={c.id} href={`/c/${c.slug}`} className="session" style={{ gridTemplateColumns: '1fr auto' }}>
              <div>
                <h3>{c.name}</h3>
                <div className="muted small">{[c.venue_name, c.city].filter(Boolean).join(', ')}</div>
              </div>
              {mine.has(c.id) && <span className="tag ok" style={{ alignSelf: 'center' }}>Your club</span>}
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

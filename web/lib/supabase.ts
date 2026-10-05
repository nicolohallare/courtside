'use client';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'missing-key';

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}

export const FUNCTIONS_URL = `${url}/functions/v1`;

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    sb().auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = sb().auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  return { session, ready, userId: session?.user.id ?? null };
}

/** Call an RPC and turn Postgres errors into plain messages. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(cleanError(error.message));
  return data as T;
}

export function cleanError(m: string): string {
  return m.replace(/^.*?ERROR:\s*/, '').replace(/\s*\(SQLSTATE.*$/, '');
}

export async function callFunction<T = unknown>(name: string, body: unknown, query = ''): Promise<T> {
  const { data } = await sb().auth.getSession();
  const r = await fetch(`${FUNCTIONS_URL}/${name}${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${data.session?.access_token ?? key}`,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error ?? `Request failed (${r.status})`);
  return j as T;
}

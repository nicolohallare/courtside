'use client';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

// Until DUPR approves, this app runs on a separate DEMO copy of the MDP database
// (Supabase branch "dupr-demo"): same structure, sample members, no link to the live app.
// Going live = point these at the main MDP project (uhfsyzsgqcrcguqvgnnb).
// The anon key is public by design; every table is protected by row-level security.
export const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://tzebodcfdvowrnhvfdij.supabase.co';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6ZWJvZGNmZHZvd3JuaHZmZGlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNjEwMjMsImV4cCI6MjEwODYzNzAyM30.wHIAf92O39cIEOA7S5Ht7ffolo7atF5Ckx6xQadJl7Y';
export const IS_DEMO = SB_URL.includes('tzebodcfdvowrnhvfdij');

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (!client) client = createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mdp-next-auth' } });
  return client;
}

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

export function cleanError(m: string): string {
  return m.replace(/^.*?ERROR:\s*/, '').replace(/\s*\(SQLSTATE.*$/, '');
}

/** Call a database function and turn its errors into plain messages. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(cleanError(error.message));
  return data as T;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await sb().auth.getSession();
  return { apikey: SB_KEY, Authorization: `Bearer ${data.session?.access_token ?? SB_KEY}`, 'Content-Type': 'application/json' };
}

/** The current app's server (mdp-api): sessions, rosters, bookings. Reads are GETs. */
export async function mdpApi<T = unknown>(action: string, query = '', init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${SB_URL}/functions/v1/mdp-api${query ? '?' + query : ''}`, {
    method: init.method ?? 'GET',
    headers: { ...(await authHeaders()), 'x-mdp-action': action },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error ?? `Request failed (${r.status})`);
  return j as T;
}

/** A server function that takes ?a=<action> (dupr, and later tournaments). */
export async function fn<T = unknown>(name: string, action: string, body?: unknown): Promise<T> {
  const r = await fetch(`${SB_URL}/functions/v1/${name}?a=${encodeURIComponent(action)}`, {
    method: body === undefined ? 'GET' : 'POST', headers: await authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error ?? `Request failed (${r.status})`);
  return j as T;
}

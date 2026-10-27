'use client';
import { mdpApi } from './supabase';

// Same public key as the current app; the private half is the VAPID_PRIVATE_KEY secret on the server.
const VAPID_PUBLIC = 'BIx4ae4O9vCw8Fy-weQvmdXCxm2UtTYJDJ80UzYlGl8qRN4H4sAnkowoLAsmCN-Osa_M-0j6W2Fa8sKHwBv8nbA';

export type PushState = 'unsupported' | 'needs-install' | 'off' | 'on' | 'blocked';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function registerSw() {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  if (!('PushManager' in window) || !('Notification' in window)) return isIos() && !installed() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const key = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Ask for permission, subscribe this device and save it with the server. */
export async function turnOnPush(): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
  const reg = await navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready);
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID_PUBLIC) }));
  const j = sub.toJSON();
  await mdpApi('save-push-subscription', '', { method: 'POST', body: { endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth, user_agent: navigator.userAgent } });
  return 'on';
}

'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
// Old link: My Slots is now Bookings.
export default function Slots() { const r = useRouter(); useEffect(() => { r.replace('/bookings/'); }, [r]); return null; }

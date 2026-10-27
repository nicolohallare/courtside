// Line icons, 24px grid, stroke follows currentColor.
const P: Record<string, string> = {
  play: 'M5 19 19 5M8.5 5.5a6 6 0 1 0 0 .01M15 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  paddle: 'M14.5 3.5a5.5 5.5 0 0 1 4 9.4l-4.6 4.6a3 3 0 0 1-4.2 0l-.2-.2-4.2 4.2-1.8-1.8 4.2-4.2-.2-.2a3 3 0 0 1 0-4.2l4.6-4.6a5.5 5.5 0 0 1 2.4-1Z',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8.5 20h7M10 17h4',
  court: 'M4 4h16v16H4zM4 12h16M12 4v5M12 15v5M4 8.5h16M4 15.5h16',
  ticket: 'M3 8a2 2 0 0 0 0 4v0a2 2 0 0 0 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6H3v2ZM9 6v12',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  back: 'M15 5l-7 7 7 7',
  chev: 'M9 5l7 7-7 7',
  pin: 'M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12ZM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3Z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2ZM16 14.5h.01',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a7 7 0 0 1 4 7',
  copy: 'M8 8h11v13H8zM5 16V3h11',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v6M12 7.5h.01',
  out: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3',
  plus: 'M12 5v14M5 12h14',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0',
};
export function Icon({ name, className }: { name: keyof typeof P | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={'ic' + (className ? ' ' + className : '')}>
      <path d={P[name] ?? ''} />
    </svg>
  );
}

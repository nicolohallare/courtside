// DUPR's wordmark, as supplied for the old app: white on dark, DUPR navy (#001762) on light.
export function DuprLogo({ h = 14, light = false, className }: { h?: number; light?: boolean; className?: string }) {
  return <img src={light ? '/dupr-logo.png' : '/dupr-logo-navy.png'} alt="DUPR" className={'dupr-logo' + (className ? ' ' + className : '')} style={{ height: h, width: 'auto' }} />;
}

/** Small pill: [DUPR] + label, e.g. "DUPR | Night", "DUPR | Rated". */
export function DuprTag({ label, dark = false }: { label: string; dark?: boolean }) {
  return <span className={'dupr-tag' + (dark ? ' dark' : '')}><DuprLogo h={10} light={dark} />{label}</span>;
}

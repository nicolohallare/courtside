// A static site: every page runs in the browser and talks to Supabase directly,
// so it can be hosted anywhere (Netlify) with no server of its own.
export default { output: 'export', trailingSlash: true, images: { unoptimized: true } };

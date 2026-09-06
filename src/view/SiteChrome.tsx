/**
 * Site-wide chrome shared by all three page types (Layout.tsx / HomePage.tsx
 * / TagPage.tsx) — the theme-resolution machinery and the toggle button, so
 * neither gets hand-duplicated independently into 3 files (DESIGN.md §5.1's
 * explicit requirement).
 *
 * Four pieces, always used together:
 *   - `HeadAssets`   — the tiny inline blocking theme-resolution script, plus
 *                      the stylesheet <link>. Goes in <head>, on every page.
 *   - `SiteBar`      — a home link + the theme toggle button. Goes at the top
 *                      of <body>, on every page.
 *   - `ThemeToggleScript` — the <script type="module"> that wires up the
 *                      toggle button's click behaviour. Non-blocking,
 *                      deferred by `type="module"`'s default behaviour, so it
 *                      never risks the flash-of-wrong-theme the inline script
 *                      in `HeadAssets` exists to prevent. Goes near the end
 *                      of <body>, on every page.
 *
 * Contract kept from the old Hugo-era site (DESIGN.md §5.1): the `data-theme`
 * attribute name on <html>, and the `localStorage['theme']` key.
 *
 * Fixed from the old Hugo-era site: the toggle is a real <button> with
 * `aria-pressed` (not an `<a href="#" role="button">`), paired with a
 * visually-hidden accessible label alongside the sun/moon emoji.
 *
 * The stylesheet/script URLs below are resolved via `build/assets.ts` rather
 * than hardcoded: every deployed asset path is content-hashed, so a deploy
 * that actually changes `theme.css`/`theme-toggle.ts` always ships under a
 * new URL (see `assets.ts`'s docstring for why — cache-busting, so a stale
 * cached bundle can't masquerade as a real bug).
 */

import { themeStylesheetPath, themeToggleScriptPath } from "../../build/assets.js";

/**
 * The one deliberate exception to "no inline scripts" (DESIGN.md §5.1):
 * blocking, so it runs before first paint and there's no flash of the wrong
 * theme. Kept under 10 lines. Only handles the *explicit override* case —
 * the system-preference case needs no JS at all, it's a pure CSS media query
 * (see src/styles/theme.css). Runs identically on every page because every
 * page renders it via the same `HeadAssets` component.
 */
const THEME_INIT_SCRIPT = `(function(){
try{
var t=localStorage.getItem('theme');
if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);
}catch(e){}
})();`;

export function HeadAssets() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <link rel="stylesheet" href={themeStylesheetPath()} />
    </>
  );
}

export function ThemeToggleButton() {
  return (
    <button type="button" id="theme-toggle" class="theme-toggle" aria-pressed="false">
      <span aria-hidden="true">🌗</span>
      <span class="visually-hidden">Toggle dark mode</span>
    </button>
  );
}

export function SiteBar() {
  return (
    <div class="site-bar">
      <a class="site-title" href="/">
        Recipes
      </a>
      <ThemeToggleButton />
    </div>
  );
}

export function ThemeToggleScript() {
  return <script type="module" src={themeToggleScriptPath()}></script>;
}

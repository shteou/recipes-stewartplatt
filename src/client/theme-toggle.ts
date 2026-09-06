/**
 * Theme toggle button behaviour — shared across all three page types (home,
 * tag, recipe) since `src/view/SiteChrome.tsx` renders the same button
 * markup on every page. Deliberately independent of `hydrate.tsx`/
 * `#recipe-data`: it must work identically on pages with no recipe data at
 * all.
 *
 * Non-blocking (a `type="module"` script, deferred by default) — the only
 * blocking piece of the theme story is the tiny inline script in <head>
 * (see SiteChrome.tsx's `HeadAssets`), which exists purely to avoid a flash
 * of the wrong theme on load. This script only needs to run before the user
 * can plausibly click the button, so a normal deferred load is fine.
 *
 * Keeps the same contract as the inline script and the CSS: the `data-theme`
 * attribute on <html>, and the `localStorage['theme']` key.
 */

type Theme = "light" | "dark";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The theme actually in effect right now: an explicit override if one is set on <html>, else the system preference. */
function currentTheme(): Theme {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark" || explicit === "light") return explicit;
  return systemPrefersDark() ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // Storage disabled (private browsing, quota, etc.) -- the attribute
    // still applies for this page view, it just won't persist.
  }
}

function init(): void {
  const button = document.getElementById("theme-toggle");
  if (!(button instanceof HTMLButtonElement)) return;

  function syncPressed(): void {
    button!.setAttribute("aria-pressed", String(currentTheme() === "dark"));
  }

  // Reflect whatever theme is actually in effect (explicit or system) as
  // soon as this script runs, not just after the first click.
  syncPressed();

  button.addEventListener("click", () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    syncPressed();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

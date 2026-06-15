// Embed protocol (game side). When Chip's runs inside the Old Games desktop
// shell (an <iframe>), it reports its current level title up to the host so the
// host's Win95 title bar reads e.g. "Chip's Challenge: LESSON 1". When running
// standalone, it just keeps document.title in sync. The host validates the
// message origin on its end; see the shell's src/embed.ts for the mirror.

const SOURCE = 'oldgame';

function inIframe(): boolean {
  try {
    return window.parent != null && window.parent !== window;
  } catch {
    return true; // cross-origin access threw => we are framed
  }
}

let lastTitle = '';

/** Report the current level title (e.g. "LESSON 1") to the host and the tab. */
export function reportTitle(levelTitle: string): void {
  if (levelTitle === lastTitle) return;
  lastTitle = levelTitle;
  document.title = `Chip's Challenge: ${levelTitle}`;
  if (inIframe()) {
    window.parent.postMessage({ source: SOURCE, type: 'title', value: levelTitle }, '*');
  }
}

/** Announce to the host that the game has loaded. */
export function reportReady(): void {
  if (inIframe()) {
    window.parent.postMessage({ source: SOURCE, type: 'ready' }, '*');
  }
}

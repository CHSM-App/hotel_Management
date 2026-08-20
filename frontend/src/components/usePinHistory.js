import { useEffect } from 'react';

/**
 * Keeps Back (and therefore Forward) from moving a signed-in user off the page
 * they are on.
 *
 * Why this is needed at all: signing in navigates with `replace`, which
 * overwrites the /login entry — but that only helps when login was the entry
 * immediately behind. A full page load, a bookmark, a typed URL or an
 * earlier session all leave entries further back that Back still reaches, and
 * landing on a sign-in form you have already satisfied reads as being signed
 * out.
 *
 * How it works: push one throwaway entry on mount, so the entry the user is
 * sitting on is not the last one. A Back press then pops that throwaway rather
 * than leaving the app, `popstate` fires, and we immediately push it again.
 * The net effect is that the address never changes and the page never
 * re-renders — Back is a no-op. Because Back never moves them, there is no
 * forward entry to return to, so Forward is a no-op too.
 *
 * What this deliberately does NOT do: it cannot disable the browser's buttons
 * or delete history entries — no page can, and anything that appears to is
 * fighting the browser. It only makes the *destination* of a Back press be
 * where they already are.
 *
 * The listener is removed on unmount, so signing out (which navigates away)
 * restores completely normal Back/Forward behaviour.
 *
 * @param {boolean} active - only pin while this is true; pass the signed-in
 *   check so the pin is never applied to a signed-out visitor, who has every
 *   right to press Back and leave.
 */
export default function usePinHistory(active) {
  useEffect(() => {
    if (!active) return undefined;

    // The throwaway entry that Back will consume instead of leaving the page.
    window.history.pushState(null, '', window.location.href);

    const onPopState = () => {
      // Put it straight back. This runs after the browser has already popped,
      // so the entry count stays level rather than growing on every press.
      window.history.pushState(null, '', window.location.href);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [active]);
}

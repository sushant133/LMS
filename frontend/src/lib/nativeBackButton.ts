/**
 * Android hardware / gesture back button.
 *
 * @capacitor/app registers an OnBackPressedCallback as soon as the plugin loads, and
 * that callback is *enabled* whether or not the web layer listens for "backButton".
 * With no JS listener its default branch only calls `webView.goBack()` when the
 * WebView can go back — and does nothing at all when it cannot. Because the SPA
 * pushes a history entry per navigation, back walked the history forever and the
 * app could never be dismissed. Handling the event ourselves (see NativeAppBridge)
 * puts the exit back in our hands.
 *
 * Anything that opens on top of a page — the mobile nav drawer, a modal — can
 * register a handler here so back closes it first instead of leaving the screen.
 * Handlers run last-registered-first; the first one returning true consumes the press.
 */

export type NativeBackHandler = () => boolean;

const handlers: NativeBackHandler[] = [];

/** Register an overlay-close handler. Returns the unregister function. */
export const registerBackHandler = (handler: NativeBackHandler): (() => void) => {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
};

/** True when a registered handler consumed the back press. */
export const runBackHandlers = (): boolean => {
  for (let index = handlers.length - 1; index >= 0; index -= 1) {
    const handler = handlers[index];
    if (!handler) continue;
    try {
      if (handler()) return true;
    } catch {
      // A broken overlay handler must not trap the back button
    }
  }
  return false;
};

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "components/ui/button";
import { isChunkLoadError, reloadOnce } from "lib/staleChunkRecovery";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Change this to clear a caught error automatically — pass the current pathname so
   * navigating to another section recovers without a manual reload.
   */
  resetKey?: string;
  /** Full-screen treatment for the root boundary; the inline card suits a section. */
  variant?: "page" | "section";
}

interface ErrorBoundaryState {
  error: Error | null;
  reloadPending: boolean;
}

/**
 * Stops one broken component from blanking the whole app.
 *
 * Without a boundary, React 18 unmounts the entire root on any uncaught render error, so
 * `#root` empties out and the user sees a plain white page with no way back — the state
 * only clears on a full reload. Every route in this app is code-split, so the most common
 * trigger is a chunk that no longer exists after a deploy (the PWA runs `autoUpdate`, so a
 * new service worker can drop the old precache under a tab that is still open).
 *
 * Chunk failures are self-healing: reload once and the current build's assets come back.
 * Anything else is a real bug, so we show it rather than reload-looping on it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, reloadPending: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Navigating elsewhere should not keep showing the previous section's failure.
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null, reloadPending: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // reloadOnce() returns false when its cooldown suppressed the reload, which means
      // the reload already failed to help — fall through to the manual card instead of
      // leaving the user staring at a "Reloading..." message that never resolves.
      this.setState({ reloadPending: reloadOnce() });
      return;
    }

    console.error("Unhandled UI error:", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null, reloadPending: false });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error, reloadPending } = this.state;
    const { children, variant = "section" } = this.props;

    if (!error) {
      return children;
    }

    if (reloadPending) {
      return (
        <div className="px-6 py-12 text-center text-sm text-slate-500">
          Updating to the latest version...
        </div>
      );
    }

    const isStaleBuild = isChunkLoadError(error);
    const title = isStaleBuild ? "This page needs a refresh" : "Something went wrong";
    const detail = isStaleBuild
      ? "The app was updated while this tab was open, so part of it could not load."
      : error.message || "An unexpected error occurred while rendering this section.";

    const card = (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-3xl border border-slate-200 bg-white px-8 py-10 text-center shadow-sm">
        <div>
          <p className="text-base font-semibold text-slate-800">{title}</p>
          <p className="mt-2 break-words text-sm text-slate-500">{detail}</p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {!isStaleBuild && (
            <Button type="button" variant="outline" size="sm" onClick={this.handleRetry}>
              Try again
            </Button>
          )}
          <Button type="button" size="sm" onClick={this.handleReload}>
            Reload page
          </Button>
        </div>
      </div>
    );

    if (variant === "page") {
      return <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">{card}</div>;
    }

    return <div className="py-10">{card}</div>;
  }
}

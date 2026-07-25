import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { BannerRecord } from "@phit-erp/shared";
import { Button } from "components/ui/button";
import { cn } from "lib/utils";

interface DashboardBannerPopupProps {
  banners: BannerRecord[];
}

/**
 * Shows active banners one at a time.
 * Closing/canceling the current banner advances to the next;
 * when the last one is closed, the popup finishes.
 */
export const DashboardBannerPopup = ({
  banners,
}: DashboardBannerPopupProps) => {
  const activeBanners = useMemo(
    () => banners.filter((banner) => banner.isActive && banner.imageUrl),
    [banners],
  );

  /** Index into activeBanners; advances on each cancel until past the end. */
  const [queueIndex, setQueueIndex] = useState(0);
  const [closing, setClosing] = useState(false);
  /** Bump to re-trigger open animation when moving to the next banner. */
  const [openKey, setOpenKey] = useState(0);

  // If the banner list shrinks (e.g. admin disables one), keep index in range.
  useEffect(() => {
    if (queueIndex > activeBanners.length) {
      setQueueIndex(activeBanners.length);
    }
  }, [activeBanners.length, queueIndex]);

  const banner = activeBanners[queueIndex];
  const total = activeBanners.length;
  const position = queueIndex + 1;
  const remainingAfterThis = Math.max(0, total - queueIndex - 1);
  const isLast = remainingAfterThis === 0;

  const handleClose = () => {
    if (closing || !banner) return;
    setClosing(true);
    window.setTimeout(() => {
      setQueueIndex((current) => current + 1);
      setClosing(false);
      setOpenKey((key) => key + 1);
    }, 220);
  };

  // Finished the queue (or no banners).
  if (!banner) {
    return null;
  }

  return (
    <div
      key={openKey}
      className={cn(
        "fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6",
        "bg-slate-950/60 backdrop-blur-[2px]",
        closing
          ? "animate-[fadeOut_0.22s_ease-in_forwards]"
          : "animate-[fadeIn_0.28s_ease-out]",
      )}
      role="dialog"
      aria-modal="true"
      aria-label={`Institution banner ${position} of ${total}`}
    >
      <div
        className={cn(
          "relative w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl",
          closing
            ? "animate-[scaleOut_0.22s_ease-in_forwards]"
            : "animate-[scaleIn_0.28s_ease-out]",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-3 top-3 z-10 h-9 w-9 rounded-full bg-black/50 p-0 text-white hover:bg-black/70 hover:text-white"
          aria-label={isLast ? "Close banner" : "Close and show next banner"}
          onClick={handleClose}
        >
          <X className="h-5 w-5" />
        </Button>

        <div className="relative bg-slate-950">
          <img
            src={banner.imageUrl}
            alt={`Institution banner ${position} of ${total}`}
            className="max-h-[min(78vh,900px)] w-full object-contain"
          />
        </div>

        {total > 1 ? (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-3">
            <p className="text-sm text-slate-600">
              Banner{" "}
              <span className="font-medium text-slate-900">{position}</span> of{" "}
              <span className="font-medium text-slate-900">{total}</span>
              {isLast ? (
                <span className="text-slate-500"> · Last banner</span>
              ) : (
                <span className="text-slate-500">
                  {" "}
                  · Close to view the next
                </span>
              )}
            </p>
            <Button type="button" size="sm" onClick={handleClose}>
              {isLast ? "Done" : "Close & next"}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end border-t border-slate-100 bg-white px-4 py-3">
            <Button type="button" size="sm" onClick={handleClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { BannerRecord } from "@phit-erp/shared";
import { Button } from "components/ui/button";
import { cn } from "lib/utils";

interface DashboardBannerPopupProps {
  banners: BannerRecord[];
}

export const DashboardBannerPopup = ({ banners }: DashboardBannerPopupProps) => {
  const [dismissed, setDismissed] = useState(false);
  const [closing, setClosing] = useState(false);
  const [index, setIndex] = useState(0);

  const activeBanners = useMemo(
    () => banners.filter((banner) => banner.isActive && banner.imageUrl),
    [banners]
  );

  const open = activeBanners.length > 0 && !dismissed;

  useEffect(() => {
    if (!open || activeBanners.length <= 1) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % activeBanners.length);
    }, 6000);

    return () => window.clearInterval(timer);
  }, [activeBanners.length, open]);

  if (!open) {
    return null;
  }

  const currentIndex = Math.min(index, activeBanners.length - 1);
  const banner = activeBanners[currentIndex]!;
  const hasMultiple = activeBanners.length > 1;

  const handleClose = () => {
    setClosing(true);
    window.setTimeout(() => {
      setDismissed(true);
      setClosing(false);
    }, 220);
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6",
        "bg-slate-950/60 backdrop-blur-[2px]",
        closing ? "animate-[fadeOut_0.22s_ease-in_forwards]" : "animate-[fadeIn_0.28s_ease-out]"
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Institution banner"
    >
      <div
        className={cn(
          "relative w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl",
          closing ? "animate-[scaleOut_0.22s_ease-in_forwards]" : "animate-[scaleIn_0.28s_ease-out]"
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-3 top-3 z-10 h-9 w-9 rounded-full bg-black/50 p-0 text-white hover:bg-black/70 hover:text-white"
          aria-label="Close banner"
          onClick={handleClose}
        >
          <X className="h-5 w-5" />
        </Button>

        <div className="relative bg-slate-950">
          <img
            src={banner.imageUrl}
            alt="Institution banner"
            className="max-h-[min(78vh,900px)] w-full object-contain"
          />

          {hasMultiple ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute left-3 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-black/45 p-0 text-white hover:bg-black/65 hover:text-white"
                aria-label="Previous banner"
                onClick={() => setIndex((value) => (value - 1 + activeBanners.length) % activeBanners.length)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-3 top-1/2 h-10 w-10 -translate-y-1/2 rounded-full bg-black/45 p-0 text-white hover:bg-black/65 hover:text-white"
                aria-label="Next banner"
                onClick={() => setIndex((value) => (value + 1) % activeBanners.length)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          ) : null}
        </div>

        {hasMultiple ? (
          <div className="flex items-center justify-center gap-2 border-t border-slate-100 bg-white px-4 py-3">
            {activeBanners.map((item, itemIndex) => (
              <button
                key={item._id}
                type="button"
                aria-label={`Show banner ${itemIndex + 1}`}
                className={cn(
                  "h-2.5 rounded-full transition-all",
                  itemIndex === currentIndex ? "w-7 bg-brand-600" : "w-2.5 bg-slate-300 hover:bg-slate-400"
                )}
                onClick={() => setIndex(itemIndex)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};
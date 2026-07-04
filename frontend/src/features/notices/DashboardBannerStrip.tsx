import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { BannerRecord } from "@nepal-school-erp/shared";
import { Button } from "components/ui/button";
import { api, unwrap } from "lib/api";
import { queryClient } from "lib/queryClient";
import { cn } from "lib/utils";

const SESSION_DISMISS_KEY = "banner-session-dismissed";

const getSessionDismissed = (): string[] => {
  try {
    const raw = sessionStorage.getItem(SESSION_DISMISS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
};

const addSessionDismissed = (bannerId: string) => {
  const current = new Set(getSessionDismissed());
  current.add(bannerId);
  sessionStorage.setItem(SESSION_DISMISS_KEY, JSON.stringify([...current]));
};

interface DashboardBannerStripProps {
  banners?: BannerRecord[];
  className?: string;
}

export const DashboardBannerStrip = ({ banners: initialBanners, className }: DashboardBannerStripProps) => {
  const [index, setIndex] = useState(0);
  const [sessionDismissed, setSessionDismissed] = useState<string[]>(() => getSessionDismissed());
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);

  const activeQuery = useQuery({
    queryKey: ["banners", "active"],
    queryFn: () => unwrap<BannerRecord[]>(api.get("/banners/active")),
    enabled: initialBanners === undefined,
    staleTime: 60_000
  });

  const dismissMutation = useMutation({
    mutationFn: async (bannerId: string) => {
      await api.post(`/banners/${bannerId}/dismiss`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["banners"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
  });

  const visibleBanners = useMemo(() => {
    const source = initialBanners ?? activeQuery.data ?? [];
    return source.filter((banner) => !sessionDismissed.includes(banner._id) && !hiddenIds.includes(banner._id));
  }, [activeQuery.data, hiddenIds, initialBanners, sessionDismissed]);

  if (visibleBanners.length === 0) {
    return null;
  }

  const currentIndex = Math.min(index, visibleBanners.length - 1);
  const banner = visibleBanners[currentIndex]!;
  const hasMultiple = visibleBanners.length > 1;

  const handleDismiss = () => {
    if (banner.dismissible) {
      setHiddenIds((current) => [...current, banner._id]);
      if (banner.showOnce) {
        void dismissMutation.mutateAsync(banner._id);
      } else {
        addSessionDismissed(banner._id);
        setSessionDismissed(getSessionDismissed());
      }
    }
    setIndex((value) => Math.min(value, Math.max(visibleBanners.length - 2, 0)));
  };

  const backgroundStyle = banner.backgroundColor ? { backgroundColor: banner.backgroundColor } : undefined;
  const textStyle = banner.textColor ? { color: banner.textColor } : undefined;

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-emerald-200 shadow-sm", className)} style={backgroundStyle}>
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5" style={textStyle}>
        {banner.imageUrl ? (
          <img
            src={banner.imageUrl}
            alt={banner.title}
            className="h-28 w-full shrink-0 rounded-xl object-cover sm:h-24 sm:w-40"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold">{banner.title}</h3>
              <div
                className="prose prose-sm mt-1 max-w-none text-inherit [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: banner.description }}
              />
            </div>
            {banner.dismissible ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0"
                aria-label="Dismiss banner"
                onClick={handleDismiss}
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          {banner.buttonText && banner.buttonUrl ? (
            <Button asChild size="sm" className="mt-3 bg-emerald-600 hover:bg-emerald-700">
              <a href={banner.buttonUrl} target="_blank" rel="noopener noreferrer">
                {banner.buttonText}
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {hasMultiple ? (
        <div className="flex items-center justify-between border-t border-emerald-100/80 bg-white/50 px-4 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={currentIndex === 0}
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-slate-600">
            {currentIndex + 1} of {visibleBanners.length}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={currentIndex >= visibleBanners.length - 1}
            onClick={() => setIndex((value) => Math.min(visibleBanners.length - 1, value + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
};
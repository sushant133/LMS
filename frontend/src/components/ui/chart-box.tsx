import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "lib/utils";

type ChartBoxProps = {
  children: ReactNode;
  /** Fixed height in px for the chart area (default 288 = h-72). */
  height?: number;
  className?: string;
  /** Shown while the container has no layout size (hidden tab, etc.). */
  fallback?: ReactNode;
};

/**
 * Sized host for Recharts ResponsiveContainer.
 * Avoids the common "width(0) and height(0)" warning when charts mount
 * inside `hidden` tabs or flex parents without a measurable box.
 */
export const ChartBox = ({
  children,
  height = 288,
  className,
  fallback = null,
}: ChartBoxProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const { width, height: h } = el.getBoundingClientRect();
      setReady(width > 0 && h > 0);
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    // Re-check after paint (tab becomes visible, fonts, layout shifts)
    const raf = requestAnimationFrame(update);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn("w-full min-w-0", className)}
      style={{ height, minHeight: height }}
    >
      {ready ? children : fallback}
    </div>
  );
};

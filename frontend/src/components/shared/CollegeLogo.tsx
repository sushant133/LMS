import { COLLEGE_LOGO_URL } from "@phit-erp/shared";
import { cn } from "lib/utils";

type CollegeLogoVariant = "default" | "light";

interface CollegeLogoProps {
  className?: string;
  alt?: string;
  src?: string;
  /** Use "light" on dark backgrounds (login hero, sidebar). */
  variant?: CollegeLogoVariant;
}

const variantClass: Record<CollegeLogoVariant, string> = {
  default: "",
  light: "brightness-0 invert"
};

const resolveLogoSrc = (src: string): string => {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }

  if (typeof window === "undefined") {
    return src;
  }

  return new URL(src.startsWith("/") ? src : `/${src}`, window.location.origin).href;
};

export const CollegeLogo = ({
  className,
  alt = "College logo",
  src = COLLEGE_LOGO_URL,
  variant = "default"
}: CollegeLogoProps) => (
  <img
    src={resolveLogoSrc(src)}
    alt={alt}
    className={cn("object-contain", variantClass[variant], className)}
  />
);
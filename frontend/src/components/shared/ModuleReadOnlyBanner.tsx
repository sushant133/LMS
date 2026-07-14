/**
 * Previously showed “Access to modify this module has been disabled by the Administrator.”
 * Staff should not see that message — modules without write access simply hide write actions,
 * and modules without any access are hidden from the sidebar entirely.
 */
export const ModuleReadOnlyBanner = (_props: {
  show?: boolean;
  message?: string;
  className?: string;
}) => null;

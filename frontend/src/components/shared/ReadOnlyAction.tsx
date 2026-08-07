import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "components/ui/button";

type ReadOnlyActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

/**
 * Formerly disabled buttons for global College Administrator read-only.
 * Write rights are now per-module (Module Access). This is a plain Button.
 */
export const ReadOnlyAction = ({ children, disabled, title, ...props }: ReadOnlyActionProps) => {
  return (
    <Button {...props} disabled={disabled} title={title}>
      {children}
    </Button>
  );
};

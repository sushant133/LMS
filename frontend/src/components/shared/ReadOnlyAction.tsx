import type { ButtonHTMLAttributes, ReactNode } from "react";
import { READ_ONLY_ACCESS_MESSAGE } from "@phit-erp/shared";
import { Button } from "components/ui/button";
import { useReadOnlyAccess } from "hooks/useNormalizedRole";

type ReadOnlyActionProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export const ReadOnlyAction = ({ children, disabled, title, ...props }: ReadOnlyActionProps) => {
  const { isReadOnly } = useReadOnlyAccess();

  return (
    <Button
      {...props}
      disabled={disabled || isReadOnly}
      title={isReadOnly ? READ_ONLY_ACCESS_MESSAGE : title}
    >
      {children}
    </Button>
  );
};
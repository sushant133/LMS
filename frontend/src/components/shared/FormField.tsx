import type { ReactNode } from "react";
import { Label } from "components/ui/label";

interface FormFieldProps {
  label: string;
  children: ReactNode;
}

export const FormField = ({ label, children }: FormFieldProps) => (
  <div className="space-y-2">
    <Label>{label}</Label>
    {children}
  </div>
);


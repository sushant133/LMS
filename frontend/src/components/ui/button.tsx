import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "lib/utils";

const buttonVariants = cva(
  // max-w-full + min-w-0 keep long labels inside the parent card on phones;
  // text-center/leading-tight keep a wrapped 2-line label readable.
  "inline-flex max-w-full min-w-0 cursor-pointer items-center justify-center rounded-xl text-center text-sm leading-tight font-medium transition disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-brand-600 text-white hover:bg-brand-700",
        secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
        outline:
          "border border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
        ghost: "text-slate-700 hover:bg-slate-100",
        destructive: "bg-red-600 text-white hover:bg-red-700",
      },
      // min-h (not h): a label that wraps to two lines grows the button
      // instead of spilling its text above and below the border.
      size: {
        default: "min-h-10 px-4 py-2",
        sm: "min-h-8 rounded-lg px-3 py-1.5",
        lg: "min-h-11 px-6 py-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

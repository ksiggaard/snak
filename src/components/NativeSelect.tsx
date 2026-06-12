import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A token-styled native `<select>`. WebKitGTK paints the closed control with
 * its own native button face (ignoring bg/text colors — unreadable in dark
 * mode), so `appearance-none` strips it and a lucide chevron stands in for
 * the native arrow. The popped-open option list stays native and follows the
 * `color-scheme` set in index.css.
 */
export function NativeSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select
        {...props}
        className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-full w-full cursor-pointer appearance-none rounded-md border py-1 pr-7 pl-2 text-sm outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2"
      />
    </div>
  );
}

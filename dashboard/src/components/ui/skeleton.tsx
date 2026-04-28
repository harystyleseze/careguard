import { cn } from "../../lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-slate-200",
        "motion-reduce:animate-none motion-reduce:bg-slate-100",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };

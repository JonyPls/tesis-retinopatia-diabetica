import * as React from "react";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type AppModalContentProps = React.ComponentPropsWithoutRef<typeof DialogContent>;

function AppModalContent({ className, children, ...props }: AppModalContentProps) {
  return (
    <DialogContent
      className={cn(
        "max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col [&>button.absolute]:opacity-100 [&>button.absolute]:hover:bg-muted-foreground/15 [&>button.absolute]:hover:text-foreground [&>button.absolute]:transition-colors",
        className,
      )}
      {...props}
    >
      {children}
    </DialogContent>
  );
}

interface AppModalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  iconClassName?: string;
}

function AppModalHeader({
  icon,
  title,
  subtitle,
  className,
  iconClassName,
  ...props
}: AppModalHeaderProps) {
  return (
    <DialogHeader
      className={cn(
        "flex-row items-start gap-4 space-y-0 bg-background px-5 py-5 text-left shrink-0 sm:px-6",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-emerald-800 dark:text-emerald-200",
          iconClassName,
        )}
      >
        {icon}
      </div>
      <div className="min-w-0 pr-8">
        <DialogTitle className="text-xl text-emerald-900">{title}</DialogTitle>
        {subtitle && (
          <DialogDescription className="mt-1 leading-relaxed">
            {subtitle}
          </DialogDescription>
        )}
      </div>
    </DialogHeader>
  );
}

function AppModalBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto border-y border-border bg-muted/40 px-5 py-4 sm:px-6",
        className,
      )}
      {...props}
    />
  );
}

function AppModalFooter({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogFooter>) {
  return (
    <DialogFooter
      className={cn(
        "gap-3 bg-background px-5 py-4 shrink-0 sm:space-x-0 sm:px-6",
        className,
      )}
      {...props}
    />
  );
}

export { AppModalBody, AppModalContent, AppModalFooter, AppModalHeader };

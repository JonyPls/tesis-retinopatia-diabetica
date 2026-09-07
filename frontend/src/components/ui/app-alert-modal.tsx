import * as React from "react";
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type AppAlertModalContentProps = React.ComponentPropsWithoutRef<
  typeof AlertDialogContent
>;

function AppAlertModalContent({
  className,
  children,
  ...props
}: AppAlertModalContentProps) {
  return (
    <AlertDialogContent
      className={cn(
        "max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col",
        className,
      )}
      {...props}
    >
      {children}
    </AlertDialogContent>
  );
}

interface AppAlertModalHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  iconClassName?: string;
}

function AppAlertModalHeader({
  icon,
  title,
  subtitle,
  className,
  iconClassName,
  ...props
}: AppAlertModalHeaderProps) {
  return (
    <AlertDialogHeader
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
        <AlertDialogTitle className="text-xl text-emerald-900">
          {title}
        </AlertDialogTitle>
        {subtitle && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
    </AlertDialogHeader>
  );
}

function AppAlertModalBody({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogDescription>) {
  return (
    <div className="border-y border-border bg-muted/40 px-5 py-4 sm:px-6">
      <AlertDialogDescription
        className={cn("leading-relaxed", className)}
        {...props}
      />
    </div>
  );
}

function AppAlertModalFooter({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogFooter>) {
  return (
    <AlertDialogFooter
      className={cn(
        "gap-3 bg-background px-5 py-4 shrink-0 sm:space-x-0 sm:px-6",
        className,
      )}
      {...props}
    />
  );
}

export {
  AppAlertModalBody,
  AppAlertModalContent,
  AppAlertModalFooter,
  AppAlertModalHeader,
};

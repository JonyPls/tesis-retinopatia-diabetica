import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ACCESS_DENIED_EVENT } from "@/lib/api";
import { useAuthStore } from "../store/authStore";
import { canAccessModule, isModuleAccessDenial, tokenIsCurrent, verifyDashboardSession, verifyModuleAccess, type ModuleName } from "../moduleAccess";

type Decision = { module: ModuleName; token: string; path: string; result: "checking" | "allowed" | "denied" | "unauthenticated" | "error" };

export function ModuleRoute({ module, children }: { module: ModuleName; children: JSX.Element }) {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated());
  const [decision, setDecision] = useState<Decision | null>(null);
  const [retry, setRetry] = useState(0);
  const { pathname } = useLocation();
  const { token, user, isAuthenticated, logout, denyModule, deniedModules } = useAuthStore();

  useEffect(() => useAuthStore.persist.onFinishHydration(() => setHydrated(true)), []);

  const sessionValid = hydrated && isAuthenticated && !!token && !!user && tokenIsCurrent(token);
  const eligible = sessionValid && canAccessModule(user, module, deniedModules);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !token || !user) return;
    if (!tokenIsCurrent(token)) {
      logout();
      return;
    }
    if (!canAccessModule(user, module, deniedModules)) return;

    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      setDecision({ module, token, path: pathname, result: "checking" });
      try {
        const result = module === "dashboard" ? await verifyDashboardSession() : await verifyModuleAccess(module);
        if (active) {
          if (result === "denied") denyModule(module);
          setDecision({ module, token, path: pathname, result });
        }
      } catch {
        if (active) setDecision({ module, token, path: pathname, result: "error" });
      } finally {
        checking = false;
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void check(); };
    const onAccessDenied = (event: Event) => {
      const { url, method } = (event as CustomEvent<{ url?: string; method?: string }>).detail ?? {};
      if (isModuleAccessDenial(module, url, method)) denyModule(module);
    };
    if (module !== "dashboard") window.addEventListener(ACCESS_DENIED_EVENT, onAccessDenied);
    document.addEventListener("visibilitychange", onVisibility);
    void check();
    return () => {
      active = false;
      window.removeEventListener(ACCESS_DENIED_EVENT, onAccessDenied);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hydrated, isAuthenticated, token, user, module, pathname, logout, denyModule, retry]);

  if (!hydrated) return <p role="status" className="p-6 text-sm text-muted-foreground">Comprobando sesión...</p>;
  if (!sessionValid) return <Navigate to="/" replace />;
  if (!eligible) return <Navigate to="/dashboard" replace />;
  const result = decision?.token === token && decision.module === module && decision.path === pathname ? decision.result : "checking";
  if (result === "denied") return <Navigate to="/dashboard" replace />;
  if (result === "unauthenticated") return <Navigate to="/" replace />;
  if (result === "error") return <div role="alert" className="p-6 text-sm text-muted-foreground">
    No se pudo verificar el acceso. <button type="button" className="text-primary underline" onClick={() => setRetry((value) => value + 1)}>Reintentar</button>
  </div>;
  if (result === "checking") return <p role="status" className="p-6 text-sm text-muted-foreground">Comprobando acceso...</p>;
  return children;
}

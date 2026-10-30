import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ACCESS_DENIED_EVENT } from "@/lib/api";
import { useAuthStore, type User } from "../store/authStore";
import { canAccessModule, isModuleAccessDenial, tokenIsCurrent, verifyDashboardSession, verifyModuleAccess, type ModuleName } from "../moduleAccess";

type AccessContext = { module: ModuleName; token: string | null; user: User | null; path: string };
type Decision = { context: AccessContext; authorized: boolean; result: "checking" | "allowed" | "denied" | "unauthenticated" | "error" };

export function ModuleRoute({ module, children }: { module: ModuleName; children: JSX.Element }) {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated());
  const [decision, setDecision] = useState<Decision | null>(null);
  const [retry, setRetry] = useState(0);
  const { pathname } = useLocation();
  const { token, user, isAuthenticated, logout, denyModule, deniedModules } = useAuthStore();
  const context = useMemo(() => ({ module, token, user, path: pathname }), [module, token, user, pathname]);
  const latestContext = useRef(context);
  latestContext.current = context;

  useEffect(() => useAuthStore.persist.onFinishHydration(() => setHydrated(true)), []);

  const sessionValid = hydrated && isAuthenticated && !!token && !!user && tokenIsCurrent(token);
  const eligible = sessionValid && canAccessModule(user, module, deniedModules);

  useEffect(() => {
    const { token, user, module } = context;
    if (!hydrated || !isAuthenticated || !token || !user) return;
    if (!tokenIsCurrent(token)) {
      logout();
      return;
    }
    if (!eligible) return;

    let active = true;
    let revoked = false;
    let checking = false;
    let controller: AbortController | null = null;
    const current = () => {
      const session = useAuthStore.getState();
      return active && !revoked && latestContext.current === context &&
        session.isAuthenticated && session.token === token && session.user === user &&
        canAccessModule(session.user, module, session.deniedModules);
    };
    const check = async () => {
      if (!current()) return;
      // También comprobar expiración al recuperar foco mientras hay una sonda pendiente.
      if (!tokenIsCurrent(token)) {
        logout();
        return;
      }
      if (checking) return;
      checking = true;
      controller = new AbortController();
      setDecision((previous) => ({ context, result: "checking",
        authorized: previous?.context === context && previous.authorized }));
      try {
        const result = module === "dashboard"
          ? await verifyDashboardSession(controller.signal)
          : await verifyModuleAccess(module, controller.signal);
        if (!current()) return;
        if (result === "unauthenticated" || !tokenIsCurrent(token)) {
          logout();
          return;
        }
        if (result === "denied") {
          revoked = true;
          denyModule(module);
        }
        setDecision({ context, result, authorized: result === "allowed" });
      } catch {
        if (current() && !controller.signal.aborted) {
          if (!tokenIsCurrent(token)) {
            logout();
            return;
          }
          setDecision((previous) => ({ context, result: "error",
            authorized: previous?.context === context && previous.authorized }));
        }
      } finally {
        checking = false;
      }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void check(); };
    const onFocus = () => { if (document.visibilityState !== "hidden") void check(); };
    const onAccessDenied = (event: Event) => {
      const { url, method } = (event as CustomEvent<{ url?: string; method?: string }>).detail ?? {};
      if (current() && isModuleAccessDenial(module, url, method)) {
        revoked = true;
        controller?.abort();
        denyModule(module);
      }
    };
    if (module !== "dashboard") window.addEventListener(ACCESS_DENIED_EVENT, onAccessDenied);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    void check();
    return () => {
      active = false;
      controller?.abort(); // Solo sondas GET; nunca operaciones clínicas.
      window.removeEventListener(ACCESS_DENIED_EVENT, onAccessDenied);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [hydrated, isAuthenticated, context, eligible, logout, denyModule, retry]);

  if (!hydrated) return <p role="status" className="p-6 text-sm text-muted-foreground">Comprobando sesión...</p>;
  if (!sessionValid) return <Navigate to="/" replace />;
  if (!eligible) return <Navigate to="/dashboard" replace />;
  const matching = decision?.context === context;
  const result = matching ? decision.result : "checking";
  const authorized = matching && decision.authorized;
  if (result === "denied") return <Navigate to="/dashboard" replace />;
  if (result === "unauthenticated") return <Navigate to="/" replace />;
  if (result === "error" && !authorized) return <div role="alert" className="p-6 text-sm text-muted-foreground">
    No se pudo verificar el acceso. <button type="button" className="text-primary underline" onClick={() => setRetry((value) => value + 1)}>Reintentar</button>
  </div>;
  if (!authorized) return <p role="status" className="p-6 text-sm text-muted-foreground">Comprobando acceso...</p>;
  // La posición de children no cambia al comprobar ni al mostrar un aviso.
  return <>
    {result === "error" && <div role="status" className="mb-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">
      No se pudo volver a verificar el acceso. Se conserva su trabajo.{" "}
      <button type="button" className="text-primary underline" onClick={() => setRetry((value) => value + 1)}>Reintentar</button>
    </div>}
    {children}
  </>;
}

import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { tokenIsCurrent } from "../moduleAccess";
import { useAuthStore } from "../store/authStore";

// Protege el shell durante la restauración de sesión. ModuleRoute conserva
// la verificación del servidor para cada contenido, sin desmontar el layout.
export function SessionRoute() {
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated());
  const { token, user, isAuthenticated, logout } = useAuthStore();
  const { pathname } = useLocation();
  const tokenCurrent = !!token && tokenIsCurrent(token);

  useEffect(() => useAuthStore.persist.onFinishHydration(() => setHydrated(true)), []);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !token || !user) return;
    const check = () => {
      const current = useAuthStore.getState();
      if (current.token === token && current.user === user && !tokenIsCurrent(token)) logout();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") check(); };
    check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hydrated, isAuthenticated, token, user, logout, pathname]);

  if (!hydrated) return <p role="status" className="p-6 text-sm text-muted-foreground">Comprobando sesión...</p>;
  if (!isAuthenticated || !user || !tokenCurrent) return <Navigate to="/" replace />;
  return <Outlet />;
}

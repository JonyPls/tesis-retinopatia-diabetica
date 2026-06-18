import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthStore } from "@/store/authStore";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound.tsx";
import Patients from "./pages/Patients";
import PatientProfile from "./pages/PatientProfile";
import Diagnosis from "./pages/Diagnosis";
import Placeholder from "./pages/Placeholder";
import ClinicalReports from "./pages/ClinicalReports";

const queryClient = new QueryClient();

// Protege rutas que requieren autenticación
const PrivateRoute = ({ children }: { children: JSX.Element }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? children : <Navigate to="/" replace />;
};

// Protege rutas que requieren roles específicos
const RoleRoute = ({
  children,
  roles,
}: {
  children: JSX.Element;
  roles: string[];
}) => {
  const { isAuthenticated, hasRole } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (!hasRole(roles)) return <Navigate to="/dashboard" replace />;
  return children;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          {/* RUTA PÚBLICA */}
          <Route path="/" element={<Login />} />

          {/* RUTAS PROTEGIDAS — cualquier usuario autenticado */}
          <Route path="/dashboard"     element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/pacientes"     element={<PrivateRoute><Patients /></PrivateRoute>} />
          <Route path="/pacientes/:id" element={<PrivateRoute><PatientProfile /></PrivateRoute>} />
          <Route path="/diagnostico"   element={<PrivateRoute><Diagnosis /></PrivateRoute>} />
          <Route path="/informes"      element={<PrivateRoute><ClinicalReports /></PrivateRoute>} />

          {/* RUTAS PROTEGIDAS — solo Admin y Gerente General */}
          <Route path="/configuracion" element={
            <RoleRoute roles={["Admin", "Gerente General"]}>
              <Placeholder title="Configuración" subtitle="Preferencias del sistema y del usuario" />
            </RoleRoute>
          } />

          {/* RUTA 404 */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
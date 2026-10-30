import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "../components/LoginForm";
import { useLogin } from "../hooks/useLogin";
import logoClinica from "@/assets/logo.png";

export default function Login() {
  const hook = useLogin();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-100 via-white to-teal-200 p-4">
      <Card className="w-full max-w-md shadow-xl border-0 overflow-hidden animate-in fade-in zoom-in-95 slide-in-from-bottom-10 duration-700 ease-out">
        <div className="h-1.5 w-full bg-gradient-to-r from-teal-600 via-teal-400 to-teal-600" />
        <CardHeader className="space-y-2 text-center pt-8">
          <img
            src={logoClinica}
            alt="Logo Centro Oftalmológico del Norte"
            className="w-24 h-24 sm:w-28 sm:h-28 mx-auto mb-3 object-contain"
          />
          <CardTitle className="text-2xl font-bold tracking-tight text-slate-900">
            Bienvenido
          </CardTitle>
          <CardDescription className="text-sm">
            Sistema web de clasificación de Retinopatía Diabética
          </CardDescription>
        </CardHeader>
        <LoginForm
          username={hook.username}
          setUsername={hook.setUsername}
          password={hook.password}
          setPassword={hook.setPassword}
          error={hook.error}
          isLoading={hook.isLoading}
          isSuccess={hook.isSuccess}
          showPassword={hook.showPassword}
          setShowPassword={hook.setShowPassword}
          handleSubmit={hook.handleSubmit}
        />
      </Card>
    </div>
  );
}

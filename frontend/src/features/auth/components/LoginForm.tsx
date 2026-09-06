import React from "react";
import { CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoginFormProps {
  username: string;
  setUsername: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  error: string;
  isLoading: boolean;
  isSuccess: boolean;
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
  handleSubmit: (e: React.FormEvent) => void;
}

export function LoginForm({
  username,
  setUsername,
  password,
  setPassword,
  error,
  isLoading,
  isSuccess,
  showPassword,
  setShowPassword,
  handleSubmit,
}: LoginFormProps) {
  return (
    <form onSubmit={handleSubmit}>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="username">Usuario</Label>
          <Input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            disabled={isLoading || isSuccess}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading || isSuccess}
              className="pr-10"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              <span className="sr-only">
                {showPassword ? "Ocultar Contraseña" : "Mostrar Contraseña"}
              </span>
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm border border-red-200">
            {error}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          type="submit"
          className={cn(
            "w-full shadow-md text-white border-0 transition-all duration-300",
            isSuccess 
              ? "bg-green-600 hover:bg-green-700" 
              : "bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600"
          )}
          disabled={isLoading || isSuccess}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando...
            </>
          ) : isSuccess ? (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Verificado
            </>
          ) : (
            "Ingresar"
          )}
        </Button>
      </CardFooter>
    </form>
  );
}

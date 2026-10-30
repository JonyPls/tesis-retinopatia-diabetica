// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Login from "../features/auth/pages/Login";
import { useAuthStore } from "../features/auth/store/authStore";

vi.mock("../features/auth/api/authService", () => ({ login: vi.fn() }));

function renderLogin() {
  return render(<MemoryRouter initialEntries={["/"]}><Login /></MemoryRouter>);
}

beforeEach(() => {
  useAuthStore.getState().logout();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  useAuthStore.getState().logout();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("Pantalla de inicio de sesión", () => {
  it("muestra el título, un logo destacado y el texto de ayuda sin labels externos", () => {
    renderLogin();
    expect(screen.getByRole("heading", { name: "Bienvenido" })).toBeInTheDocument();
    expect(screen.queryByText("Iniciar Sesión")).not.toBeInTheDocument();
    const logo = screen.getByRole("img", { name: "Logo Centro Oftalmológico del Norte" });
    expect(logo).toHaveClass("w-24", "h-24", "object-contain");
    expect(screen.queryByText("Usuario", { selector: "label" })).not.toBeInTheDocument();
    expect(screen.queryByText("Contraseña", { selector: "label" })).not.toBeInTheDocument();
    expect(screen.getByText("Si no puedes ingresar, contacta al administrador")).toBeInTheDocument();
  });

  it("usa placeholders e iconos dentro de los campos", () => {
    renderLogin();
    const username = screen.getByPlaceholderText("Usuario");
    const password = screen.getByPlaceholderText("Contraseña");
    expect(username).toHaveAttribute("aria-label", "Usuario");
    expect(password).toHaveAttribute("aria-label", "Contraseña");
    expect(username).toHaveClass("pl-9");
    expect(password).toHaveClass("pl-9", "pr-10");
    expect(username.parentElement?.querySelector("svg.lucide-user")).toHaveAttribute("aria-hidden", "true");
    expect(password.parentElement?.querySelector("svg.lucide-lock")).toHaveAttribute("aria-hidden", "true");
  });

  it("conserva el botón Ingresar y el control de mostrar u ocultar contraseña", () => {
    renderLogin();
    const password = screen.getByPlaceholderText("Contraseña");
    expect(password).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar Contraseña" }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar Contraseña" }));
    expect(password).toHaveAttribute("type", "password");
  });
});

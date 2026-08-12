import { Spin } from "antd";
import { type ReactNode, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "./authStore";
import { PasswordChangeGate } from "./PasswordChangeGate";

export function RequireAuth({ children }: { children: ReactNode }) {
  const ready = useAuthStore((state) => state.ready);
  const token = useAuthStore((state) => state.token);
  const mustChangePassword = useAuthStore((state) => state.user?.mustChangePassword);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  if (!ready) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Spin size="large" /></div>;
  if (!token) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <PasswordChangeGate />;
  return <>{children}</>;
}

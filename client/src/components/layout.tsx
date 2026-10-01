import { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <main className="h-screen overflow-auto relative">
        {children}
      </main>
    </div>
  );
}

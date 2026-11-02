import { MainNav } from "@/components/main-nav";
import { ToastProvider } from "@/components/toast";

// App shell: skip link, main nav, toast offset above the bottom nav (4rem under 768).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="[--bottom-nav:4rem] md:[--bottom-nav:0px]">
    <ToastProvider>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:bg-surface-card focus:px-4 focus:py-3 focus:text-text-primary"
      >
        Skip to content
      </a>
      <MainNav />
      <div className="md:pl-20 xl:pl-60">{children}</div>
    </ToastProvider>
    </div>
  );
}

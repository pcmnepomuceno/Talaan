import { MainNav } from "@/components/main-nav";
import { SkipLink } from "@/components/skip-link";
import { ToastProvider } from "@/components/toast";

// App shell: skip link, main nav, toast offset above the bottom nav (4rem under 768).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="[--bottom-nav:4rem] md:[--bottom-nav:0px]">
    <ToastProvider>
      <SkipLink />
      <MainNav />
      <div className="md:pl-22 xl:pl-60">{children}</div>
    </ToastProvider>
    </div>
  );
}

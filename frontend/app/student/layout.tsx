import AppHeader from "@/components/AppHeader";
import ScrollToTopButton from "@/components/ScrollToTopButton";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <div className="pt-14">{children}</div>
      <ScrollToTopButton />
    </>
  );
}

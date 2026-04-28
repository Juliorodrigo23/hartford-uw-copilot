import { AboutMe } from "@/components/intro/AboutMe";
import { OverviewMap } from "@/components/intro/OverviewMap";
import HeroLazy from "@/components/intro/HeroLazy";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
      <HeroLazy />
      <div className="mt-6">
        <AboutMe />
      </div>
      <div className="mt-6">
        <OverviewMap />
      </div>
    </div>
  );
}

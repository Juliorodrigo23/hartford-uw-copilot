import { OverviewMap } from "@/components/intro/OverviewMap";
import { RecruiterHero } from "@/components/intro/RecruiterHero";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-10">
      <RecruiterHero />
      <div className="mt-6">
        <OverviewMap />
      </div>
    </div>
  );
}

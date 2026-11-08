import { Palette } from "lucide-react";
import { useStore } from "@/store";
import { DirectorCard } from "@/components/settings/DirectorCard";
import { KeyCard } from "@/components/settings/KeyCard";
import { ModelsCard } from "@/components/settings/ModelsCard";
import { SpendingCard } from "@/components/settings/SpendingCard";
import { Button } from "@/ui/button";
import { Card } from "@/components/settings/common";
import { SectionTitle } from "@/ui/surface";

export default function Settings() {
  const setRoute = useStore((s) => s.setRoute);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-[1180px] grid-cols-2 content-start gap-4 px-9 pt-11 pb-10">
        <h1 className="heading col-span-2 mb-1 text-[28px]">Settings</h1>
        <KeyCard />
        <DirectorCard />
        <SpendingCard />
        <ModelsCard />
        <Card>
          <SectionTitle>About</SectionTitle>
          <p className="text-[13px] leading-relaxed text-text-2">
            Horschamp talks to the Higgsfield API from the app's Rust side only. Your keys stay in the OS
            keychain and every generation asks you to confirm its estimated cost first. Outputs are saved to
            your library folder because Higgsfield deletes them after 7 days.
          </p>
          <p className="text-[12px] leading-relaxed text-text-3">
            Horschamp is an unofficial, open-source client. It is not affiliated with, endorsed by or
            sponsored by Higgsfield. Higgsfield is a trademark of its owner. You use your own Higgsfield
            account and API key, under Higgsfield's terms of use.
          </p>
          <Button variant="ghost" className="self-start" onClick={() => setRoute("design")}>
            <Palette /> Design system
          </Button>
        </Card>
      </div>
    </div>
  );
}

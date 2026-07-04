import { useState } from "react";
import { Image, Megaphone } from "lucide-react";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Button } from "components/ui/button";
import { useAuth } from "features/auth/AuthProvider";
import { BannerManager } from "features/notices/BannerManager";
import { NoticeManager } from "features/notices/NoticeManager";
import { cn } from "lib/utils";

type NoticeTab = "board" | "banners";

export const NoticesPage = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN" || user?.role === "COLLEGE_ADMIN";
  const [tab, setTab] = useState<NoticeTab>("board");

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="Notices"
        description={
          isAdmin
            ? "Manage college announcements and dashboard banners from one place."
            : "View announcements for your role, class, and subjects."
        }
      />

      {isAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={tab === "board" ? "default" : "outline"}
            className={cn(tab === "board" && "bg-emerald-600 hover:bg-emerald-700")}
            onClick={() => setTab("board")}
          >
            <Megaphone className="mr-2 h-4 w-4" />
            Notice Board
          </Button>
          <Button
            type="button"
            variant={tab === "banners" ? "default" : "outline"}
            className={cn(tab === "banners" && "bg-emerald-600 hover:bg-emerald-700")}
            onClick={() => setTab("banners")}
          >
            <Image className="mr-2 h-4 w-4" />
            Banner Management
          </Button>
        </div>
      ) : null}

      {tab === "banners" && isAdmin ? <BannerManager /> : <NoticeManager embedded />}
    </PageContent>
  );
};
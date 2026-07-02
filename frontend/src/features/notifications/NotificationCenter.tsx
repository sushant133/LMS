import { useMutation, useQuery } from "@tanstack/react-query";
import type { NotificationRecord } from "@nepal-school-erp/shared";
import { toast } from "sonner";
import { PageContent } from "components/layout/PageContent";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent } from "components/ui/card";
import { api, unwrap } from "lib/api";
import { cn } from "lib/utils";
import { queryClient } from "lib/queryClient";

export const NotificationCenter = () => {
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => unwrap<NotificationRecord[]>(api.get("/notifications"))
  });

  const markRead = useMutation({
    mutationFn: (id: string) => unwrap(api.put(`/notifications/${id}/read`)),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  const markAllRead = useMutation({
    mutationFn: () => unwrap(api.put("/notifications/read-all")),
    onSuccess: async () => {
      toast.success("All notifications marked read");
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  });

  return (
    <PageContent className="space-y-6">
      <PageHeader
        title="Notifications"
        description="In-app alerts and SMS delivery status for attendance, assignments, fees, and more."
        action={<Button variant="secondary" onClick={() => markAllRead.mutate()}>Mark all read</Button>}
      />
      <div className="space-y-3">
        {(notificationsQuery.data ?? []).map((n) => (
          <Card key={n._id} className={cn("min-w-0", n.read ? "opacity-70" : "")}>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-900">{n.title}</p>
                  <Badge>{n.type}</Badge>
                  <Badge>{n.channel}</Badge>
                  {n.smsStatus !== "SKIPPED" ? <Badge>{n.smsStatus}</Badge> : null}
                </div>
                <p className="mt-1 text-sm text-slate-600">{n.message}</p>
              </div>
              {!n.read ? (
                <Button className="shrink-0 self-start" size="sm" variant="secondary" onClick={() => markRead.mutate(n._id)}>
                  Mark read
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </PageContent>
  );
};
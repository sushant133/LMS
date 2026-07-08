import type { NoticeRecord } from "@phit-erp/shared";
import { EmptyState } from "components/shared/EmptyState";
import { PageContent } from "components/layout/PageContent";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";

export type EnrichedNoticeRecord = NoticeRecord & {
  authorName?: string;
  subjectName?: string;
};

interface StudentNoticeBoardProps {
  notices: EnrichedNoticeRecord[];
}

export const StudentNoticeBoard = ({ notices }: StudentNoticeBoardProps) => {
  if (notices.length === 0) {
    return <EmptyState title="No notices yet" description="Announcements for your class and subjects will appear here." />;
  }

  return (
    <PageContent className="space-y-4">
      {notices.map((notice) => (
        <Card key={notice._id} className="min-w-0 border-brand-100">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-lg text-slate-900">{notice.title}</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Posted by {notice.authorName ?? "College"} · {notice.publishDateBs}
                  {notice.subjectName ? ` · ${notice.subjectName}` : ""}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{notice.content}</p>
            {notice.expiresAtBs ? <p className="mt-3 text-xs text-slate-500">Valid until {notice.expiresAtBs}</p> : null}
          </CardContent>
        </Card>
      ))}
    </PageContent>
  );
};
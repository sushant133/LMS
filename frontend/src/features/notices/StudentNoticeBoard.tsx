import type { NoticeRecord } from "@phit-erp/shared";
import { EmptyState } from "components/shared/EmptyState";
import { PageContent } from "components/layout/PageContent";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { resolveMediaUrl } from "lib/api";
import { cn } from "lib/utils";

export type EnrichedNoticeRecord = NoticeRecord & {
  authorName?: string;
  subjectName?: string;
};

interface NoticeImageGalleryProps {
  images: NonNullable<NoticeRecord["images"]>;
  /** Small thumbnails for list rows instead of the full reading layout. */
  compact?: boolean;
}

/** Notice images; each opens the full-size file in a new tab. */
export const NoticeImageGallery = ({
  images,
  compact = false,
}: NoticeImageGalleryProps) => {
  if (images.length === 0) return null;

  return (
    <div
      className={cn(
        "mt-3 grid gap-2",
        compact
          ? "grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] max-w-md"
          : images.length === 1
            ? "grid-cols-1"
            : "grid-cols-2 sm:grid-cols-3",
      )}
    >
      {images.map((image) => (
        <a
          key={image.url}
          href={resolveMediaUrl(image.url)}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition hover:border-brand-300"
        >
          <img
            src={resolveMediaUrl(
              compact || images.length > 1
                ? image.thumbnailUrl || image.url
                : image.url,
            )}
            alt={image.originalName ?? "Notice image"}
            loading="lazy"
            className={cn(
              "w-full object-cover",
              compact
                ? "aspect-square"
                : images.length === 1
                  ? "max-h-[28rem] object-contain"
                  : "aspect-video",
            )}
          />
        </a>
      ))}
    </div>
  );
};

interface StudentNoticeBoardProps {
  notices: EnrichedNoticeRecord[];
}

export const StudentNoticeBoard = ({ notices }: StudentNoticeBoardProps) => {
  if (notices.length === 0) {
    return (
      <EmptyState
        title="No notices yet"
        description="Announcements for your class and subjects will appear here."
      />
    );
  }

  return (
    <PageContent className="space-y-4">
      {notices.map((notice) => (
        <Card key={notice._id} className="min-w-0 border-brand-100">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-lg text-slate-900">
                  {notice.title}
                </CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Posted by {notice.authorName ?? "College"} ·{" "}
                  {notice.publishDateBs}
                  {notice.subjectName ? ` · ${notice.subjectName}` : ""}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {notice.content}
            </p>
            {notice.images?.length ? (
              <NoticeImageGallery images={notice.images} />
            ) : null}
            {notice.expiresAtBs ? (
              <p className="mt-3 text-xs text-slate-500">
                Valid until {notice.expiresAtBs}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </PageContent>
  );
};

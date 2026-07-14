import { useMutation, useQuery } from "@tanstack/react-query";
import {
  canManageInstitution,
  formatAcademicYearLabel,
  type AcademicCalendarEventInput,
  type AcademicCalendarEventRecord,
  type AcademicCalendarFilters,
} from "@phit-erp/shared";
import {
  Download,
  Eye,
  FileSpreadsheet,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EmptyState } from "components/shared/EmptyState";
import { PageHeader } from "components/shared/PageHeader";
import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "components/ui/card";
import { Input } from "components/ui/input";
import { Select } from "components/ui/select";
import { Table, TableBody, TableHead, Td, Th } from "components/ui/table";
import { useAuth } from "features/auth/AuthProvider";
import { api, unwrap } from "lib/api";
import { downloadPdfFromElementById, printElementById } from "lib/printUtils";
import { queryClient } from "lib/queryClient";
import { parseErrorMessage } from "lib/utils";
import { AcademicCalendarMonth } from "./AcademicCalendarMonth";
import { EventDetailDialog } from "./EventDetailDialog";
import { EventFormDialog } from "./EventFormDialog";
import {
  buildAcademicYearMonths,
  defaultCalendarFilters,
  eventTypeOptions,
  exportEventsExcel,
  filterEventsLocally,
  formatMonthKey,
  getEventTypeColor,
  getEventTypeLabel,
  groupEventsByDate,
  legendGroups,
  resolvePreferredAcademicYear,
  storedEventsOnly,
} from "./academicCalendarUtils";

export const AcademicCalendarHub = () => {
  const { user } = useAuth();
  const canManage = canManageInstitution(user?.role ?? "");
  const schoolAcademicYearBs = user?.school?.academicYearBs ?? "";
  const [academicYearBs, setAcademicYearBs] = useState(schoolAcademicYearBs);
  const [draftFilters, setDraftFilters] = useState<AcademicCalendarFilters>(
    defaultCalendarFilters(),
  );
  const [appliedFilters, setAppliedFilters] = useState<AcademicCalendarFilters>(
    defaultCalendarFilters(),
  );
  const [selectedDateBs, setSelectedDateBs] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<
    AcademicCalendarEventRecord[]
  >([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] =
    useState<AcademicCalendarEventRecord | null>(null);

  const yearsQuery = useQuery({
    queryKey: ["academic-calendar", "years"],
    queryFn: () => unwrap<string[]>(api.get("/academic-calendar/years")),
  });

  const dashboardQuery = useQuery({
    queryKey: ["academic-calendar", "dashboard", academicYearBs],
    queryFn: () =>
      unwrap<{ todayBs: string; academicYearBs?: string }>(
        api.get("/academic-calendar/dashboard", {
          params: academicYearBs ? { academicYearBs } : undefined,
        }),
      ),
    enabled: Boolean(academicYearBs) || yearsQuery.isSuccess,
  });

  const eventsQuery = useQuery({
    queryKey: ["academic-calendar", "events", academicYearBs],
    queryFn: () =>
      unwrap<AcademicCalendarEventRecord[]>(
        api.get("/academic-calendar/events", { params: { academicYearBs } }),
      ),
    enabled: Boolean(academicYearBs),
  });

  const resolvedYear =
    academicYearBs ||
    resolvePreferredAcademicYear(
      yearsQuery.data,
      schoolAcademicYearBs || dashboardQuery.data?.academicYearBs,
    );
  const todayBs = dashboardQuery.data?.todayBs ?? "";
  const allMonths = buildAcademicYearMonths(resolvedYear);
  const months = appliedFilters.monthBs
    ? allMonths.filter(
        (month) =>
          formatMonthKey(month.year, month.month) === appliedFilters.monthBs,
      )
    : allMonths;
  const events = eventsQuery.data ?? [];
  const filteredEvents = useMemo(
    () => filterEventsLocally(events, appliedFilters),
    [events, appliedFilters],
  );
  const eventsByDate = useMemo(
    () => groupEventsByDate(filteredEvents),
    [filteredEvents],
  );

  /** Admin event table: stored range events only (no auto Saturdays). */
  const managedEvents = useMemo(
    () => storedEventsOnly(filteredEvents),
    [filteredEvents],
  );

  /** Day-scoped list when a calendar cell is selected. */
  const dateScopedEvents = useMemo(() => {
    if (!selectedDateBs) return [];
    return eventsByDate.get(selectedDateBs) ?? [];
  }, [eventsByDate, selectedDateBs]);

  const saveMutation = useMutation({
    mutationFn: async ({
      payload,
      isEdit,
    }: {
      payload: AcademicCalendarEventInput;
      isEdit: boolean;
    }) => {
      if (isEdit && editingEvent) {
        return unwrap<AcademicCalendarEventRecord>(
          api.put(`/academic-calendar/events/${editingEvent._id}`, payload),
        );
      }
      return unwrap<AcademicCalendarEventRecord>(
        api.post("/academic-calendar/events", payload),
      );
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["academic-calendar"] });
      setFormOpen(false);
      setEditingEvent(null);
      setDetailOpen(false);
      toast.success(variables.isEdit ? "Event updated" : "Event saved");
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (eventId: string) =>
      unwrap(api.delete(`/academic-calendar/events/${eventId}`)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["academic-calendar"] });
      setDetailOpen(false);
      toast.success("Event deleted");
    },
    onError: (error) => toast.error(parseErrorMessage(error)),
  });

  const handleDateClick = (
    dateBs: string,
    dayEvents: AcademicCalendarEventRecord[],
  ) => {
    setSelectedDateBs(dateBs);
    setSelectedEvents(dayEvents);

    if (canManage && dayEvents.length === 0) {
      setEditingEvent(null);
      setFormOpen(true);
      return;
    }

    if (dayEvents.length > 0) {
      setDetailOpen(true);
    }
  };

  const openCreateForm = () => {
    setEditingEvent(null);
    setSelectedDateBs(selectedDateBs || todayBs);
    setFormOpen(true);
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ ...draftFilters, academicYearBs: resolvedYear });
  };

  const handleExportExcel = () => {
    const rows = selectedDateBs ? dateScopedEvents : managedEvents;
    exportEventsExcel(
      rows,
      `academic-calendar-${resolvedYear.replace("/", "-")}.xlsx`,
    );
  };

  const handlePrint = () => printElementById("academic-calendar-print");
  const handleDownloadPdf = () =>
    downloadPdfFromElementById(
      "academic-calendar-print",
      `academic-calendar-${resolvedYear.replace("/", "-")}.pdf`,
    );

  const handleDelete = (event: AcademicCalendarEventRecord) => {
    if (event.isSystemGenerated) {
      toast.error(
        "Saturday holidays are automatic. Create a Working Day override instead.",
      );
      return;
    }
    const start = event.startDateBs || event.dateBs;
    const end = event.endDateBs || event.dateBs;
    const rangeLabel = start === end ? start : `${start} → ${end}`;
    if (
      !window.confirm(
        `Delete "${event.name}" (${rangeLabel})? This removes the event from every date in the range.`,
      )
    ) {
      return;
    }
    deleteMutation.mutate(event._id);
  };

  // Always land on the institution's current academic year.
  useEffect(() => {
    if (academicYearBs) return;

    const preferred = resolvePreferredAcademicYear(
      yearsQuery.data,
      schoolAcademicYearBs || dashboardQuery.data?.academicYearBs,
    );
    if (preferred) {
      setAcademicYearBs(preferred);
    }
  }, [
    academicYearBs,
    yearsQuery.data,
    schoolAcademicYearBs,
    dashboardQuery.data?.academicYearBs,
  ]);

  useEffect(() => {
    if (!schoolAcademicYearBs) return;
    if (!academicYearBs) {
      setAcademicYearBs(schoolAcademicYearBs);
    }
  }, [schoolAcademicYearBs, academicYearBs]);

  useEffect(() => {
    setAppliedFilters((current) => ({
      ...current,
      academicYearBs: resolvedYear,
    }));
  }, [resolvedYear]);

  useEffect(() => {
    if (!selectedDateBs) {
      setSelectedEvents([]);
      return;
    }
    setSelectedEvents(eventsByDate.get(selectedDateBs) ?? []);
  }, [eventsByDate, selectedDateBs]);

  useEffect(() => {
    setSelectedDateBs("");
    setSelectedEvents([]);
    setDetailOpen(false);
  }, [resolvedYear]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Academic Calendar ${formatAcademicYearLabel(resolvedYear)}`}
        description="Institution-wide Bikram Sambat calendar with date-range events, vacations, examinations, and automatic Saturday public holidays."
        action={
          <div className="flex flex-wrap gap-2">
            {canManage ? (
              <Button type="button" onClick={openCreateForm}>
                <Plus className="mr-2 h-4 w-4" />
                Add Event
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button type="button" variant="outline" onClick={handleDownloadPdf}>
              <Download className="mr-2 h-4 w-4" />
              PDF
            </Button>
            <Button type="button" variant="outline" onClick={handleExportExcel}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Excel
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Academic Year
            </label>
            <Select
              value={resolvedYear}
              onChange={(event) => setAcademicYearBs(event.target.value)}
            >
              {(yearsQuery.data ?? [resolvedYear]).map((year) => (
                <option key={year} value={year}>
                  {formatAcademicYearLabel(year)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              BS Month
            </label>
            <Select
              value={draftFilters.monthBs ?? ""}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  monthBs: event.target.value,
                }))
              }
            >
              <option value="">All months</option>
              {allMonths.map((month) => (
                <option
                  key={formatMonthKey(month.year, month.month)}
                  value={formatMonthKey(month.year, month.month)}
                >
                  {month.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Event Category
            </label>
            <Select
              value={draftFilters.eventType ?? ""}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  eventType: (event.target.value ||
                    undefined) as AcademicCalendarFilters["eventType"],
                }))
              }
            >
              <option value="">All categories</option>
              {eventTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Search
            </label>
            <div className="flex gap-2">
              <Input
                value={draftFilters.keyword ?? ""}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    keyword: event.target.value,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleApplyFilters();
                  }
                }}
                placeholder="Name, category, date..."
              />
              <Button type="button" onClick={handleApplyFilters}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div id="academic-calendar-print" className="space-y-6">
        {eventsQuery.isPending ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 12 }).map((_, index) => (
              <div
                key={index}
                className="h-52 animate-pulse rounded-2xl border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {months.map((month) => (
              <AcademicCalendarMonth
                key={`${month.year}-${month.month}`}
                year={month.year}
                month={month.month}
                monthName={month.name}
                eventsByDate={eventsByDate}
                todayBs={todayBs}
                selectedDateBs={selectedDateBs}
                onDateClick={handleDateClick}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          <span className="w-full text-sm font-medium text-slate-800 sm:w-auto">
            Legend
          </span>
          {legendGroups.map((group) => (
            <span key={group.key} className="inline-flex items-center gap-1.5">
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              {group.label}
            </span>
          ))}
        </div>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>Event List</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                All created events with start/end dates. Saturday public holidays
                are automatic and not listed here.
              </p>
            </div>
            {canManage ? (
              <Button type="button" size="sm" onClick={openCreateForm}>
                <Plus className="mr-1 h-4 w-4" />
                Add Event
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {managedEvents.length === 0 ? (
              <EmptyState
                title="No events created yet"
                description={
                  canManage
                    ? "Add a single-day or multi-day event (vacation, exam week, festival, etc.) using Add Event."
                    : "No calendar events have been published for this academic year."
                }
              />
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <Th>Event Name</Th>
                    <Th>Category</Th>
                    <Th>Start Date (BS)</Th>
                    <Th>End Date (BS)</Th>
                    <Th>Total Days</Th>
                    <Th>Description</Th>
                    <Th>Created By</Th>
                    <Th>Status</Th>
                    <Th>Actions</Th>
                  </tr>
                </TableHead>
                <TableBody>
                  {managedEvents.map((event) => {
                    const start = event.startDateBs || event.dateBs;
                    const end = event.endDateBs || event.dateBs;
                    return (
                      <tr
                        key={event._id}
                        className="border-t border-slate-100 hover:bg-slate-50"
                      >
                        <Td className="font-medium text-slate-900">
                          {event.name}
                        </Td>
                        <Td>
                          <Badge
                            style={{
                              backgroundColor: `${getEventTypeColor(event.eventType)}22`,
                              color: getEventTypeColor(event.eventType),
                              borderColor: `${getEventTypeColor(event.eventType)}55`,
                            }}
                          >
                            {getEventTypeLabel(event.eventType)}
                          </Badge>
                        </Td>
                        <Td>{start}</Td>
                        <Td>{end}</Td>
                        <Td>{event.totalDays ?? 1}</Td>
                        <Td className="max-w-[200px] truncate">
                          {event.reason || "—"}
                        </Td>
                        <Td>{event.audit?.createdByName ?? "—"}</Td>
                        <Td>
                          <span
                            className={
                              event.status === "INACTIVE"
                                ? "text-slate-500"
                                : "font-medium text-emerald-700"
                            }
                          >
                            {event.status ?? "ACTIVE"}
                          </span>
                        </Td>
                        <Td>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              title="View"
                              onClick={() => {
                                setSelectedDateBs(start);
                                setSelectedEvents(
                                  eventsByDate.get(start) ?? [event],
                                );
                                setDetailOpen(true);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {canManage ? (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  title="Edit"
                                  onClick={() => {
                                    setEditingEvent(event);
                                    setFormOpen(true);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  title="Delete"
                                  disabled={deleteMutation.isPending}
                                  onClick={() => handleDelete(event)}
                                >
                                  <Trash2 className="h-4 w-4 text-red-600" />
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {selectedDateBs ? (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle>Events on {selectedDateBs}</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Including multi-day events that cover this date and automatic
                  Saturday holidays.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedDateBs("");
                  setSelectedEvents([]);
                  setDetailOpen(false);
                }}
              >
                Clear date
              </Button>
            </CardHeader>
            <CardContent>
              {dateScopedEvents.length === 0 ? (
                <EmptyState
                  title="No events on this date"
                  description={
                    canManage
                      ? "Click Add Event to schedule something for this day."
                      : "Nothing is scheduled for this date."
                  }
                />
              ) : (
                <ul className="space-y-2">
                  {dateScopedEvents.map((event) => (
                    <li
                      key={event._id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    >
                      <div>
                        <span
                          className={
                            event.isHoliday
                              ? "font-medium text-red-700"
                              : "font-medium text-slate-900"
                          }
                        >
                          {event.name}
                        </span>
                        <span className="ml-2 text-slate-500">
                          {getEventTypeLabel(event.eventType)}
                          {event.isSystemGenerated ? " · auto" : ""}
                        </span>
                      </div>
                      <span className="text-xs text-slate-500">
                        {(event.startDateBs || event.dateBs) ===
                        (event.endDateBs || event.dateBs)
                          ? event.dateBs
                          : `${event.startDateBs} → ${event.endDateBs}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <EventDetailDialog
        open={detailOpen}
        dateBs={selectedDateBs}
        events={selectedEvents}
        canManage={canManage}
        deleting={deleteMutation.isPending}
        onClose={() => setDetailOpen(false)}
        onEdit={(event) => {
          if (event.isSystemGenerated) {
            toast.message(
              "Saturday holidays are automatic. Add a Working Day override to hold classes.",
            );
            setEditingEvent(null);
            setFormOpen(true);
            setDetailOpen(false);
            return;
          }
          setEditingEvent(event);
          setFormOpen(true);
          setDetailOpen(false);
        }}
        onDelete={handleDelete}
        onAdd={() => {
          setEditingEvent(null);
          setFormOpen(true);
          setDetailOpen(false);
        }}
      />

      <EventFormDialog
        open={formOpen}
        academicYearBs={resolvedYear}
        dateBs={selectedDateBs || todayBs}
        editingEvent={editingEvent}
        saving={saveMutation.isPending}
        onClose={() => {
          setFormOpen(false);
          setEditingEvent(null);
        }}
        onSave={async (payload) => {
          await saveMutation.mutateAsync({
            payload,
            isEdit: Boolean(editingEvent),
          });
        }}
      />
    </div>
  );
};

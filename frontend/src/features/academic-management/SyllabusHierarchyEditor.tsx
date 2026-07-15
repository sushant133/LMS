import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { NumberInput } from "components/ui/number-input";
import { Select } from "components/ui/select";
import { Textarea } from "components/ui/textarea";
import { FormField } from "components/shared/FormField";
import { RichTextEditor } from "features/notices/RichTextEditor";
import { cn } from "lib/utils";
import { NEPALI_MONTHS } from "./academicManagementUtils";
import {
  type ChapterDraft,
  type SubUnitDraft,
  type UnitDraft,
  emptyChapter,
  emptySubUnit,
  emptyUnit,
  moveItem,
  renumberChapters,
} from "./syllabusFormUtils";

interface SyllabusHierarchyEditorProps {
  chapters: ChapterDraft[];
  onChange: (chapters: ChapterDraft[]) => void;
  readOnly?: boolean;
}

export const SyllabusHierarchyEditor = ({
  chapters,
  onChange,
  readOnly = false,
}: SyllabusHierarchyEditorProps) => {
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    () => new Set(chapters.map((c) => c.clientKey)),
  );
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(() => new Set());
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(() => new Set());
  const [dragChapterKey, setDragChapterKey] = useState<string | null>(null);

  const setChapters = (next: ChapterDraft[]) => onChange(renumberChapters(next));

  const allExpanded = useMemo(() => {
    if (chapters.length === 0) return false;
    return chapters.every((c) => expandedChapters.has(c.clientKey));
  }, [chapters, expandedChapters]);

  const expandAll = () => {
    setExpandedChapters(new Set(chapters.map((c) => c.clientKey)));
    setExpandedUnits(
      new Set(
        chapters.flatMap((c) =>
          (c.units as UnitDraft[]).map((u) => u.clientKey),
        ),
      ),
    );
    setExpandedSubs(
      new Set(
        chapters.flatMap((c) =>
          (c.units as UnitDraft[]).flatMap((u) =>
            (u.subUnits as SubUnitDraft[]).map((s) => s.clientKey),
          ),
        ),
      ),
    );
  };

  const collapseAll = () => {
    setExpandedChapters(new Set());
    setExpandedUnits(new Set());
    setExpandedSubs(new Set());
  };

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const updateChapter = (cIndex: number, patch: Partial<ChapterDraft>) => {
    setChapters(
      chapters.map((ch, i) => (i === cIndex ? { ...ch, ...patch } : ch)),
    );
  };

  const updateUnit = (cIndex: number, uIndex: number, patch: Partial<UnitDraft>) => {
    setChapters(
      chapters.map((ch, i) => {
        if (i !== cIndex) return ch;
        const units = (ch.units as UnitDraft[]).map((u, j) =>
          j === uIndex ? { ...u, ...patch } : u,
        );
        return { ...ch, units };
      }),
    );
  };

  const updateSub = (
    cIndex: number,
    uIndex: number,
    sIndex: number,
    patch: Partial<SubUnitDraft>,
  ) => {
    setChapters(
      chapters.map((ch, i) => {
        if (i !== cIndex) return ch;
        const units = (ch.units as UnitDraft[]).map((u, j) => {
          if (j !== uIndex) return u;
          const subUnits = (u.subUnits as SubUnitDraft[]).map((s, k) =>
            k === sIndex ? { ...s, ...patch } : s,
          );
          return { ...u, subUnits };
        });
        return { ...ch, units };
      }),
    );
  };

  if (readOnly) {
    return (
      <div className="space-y-3 text-sm text-slate-600">
        Hierarchy is read-only in this mode.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Syllabus hierarchy
          </p>
          <p className="text-xs text-slate-500">
            Subject → Chapter → Unit (Topic) → Sub Unit (Sub Topic). Numbers update
            automatically when reordered.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={allExpanded ? collapseAll : expandAll}>
            {allExpanded ? (
              <>
                <ChevronsDownUp className="mr-1.5 h-4 w-4" />
                Collapse All
              </>
            ) : (
              <>
                <ChevronsUpDown className="mr-1.5 h-4 w-4" />
                Expand All
              </>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setChapters([...chapters, emptyChapter(chapters.length + 1)])}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add Chapter
          </Button>
        </div>
      </div>

      {chapters.map((chapter, cIndex) => {
        const chOpen = expandedChapters.has(chapter.clientKey);
        const units = chapter.units as UnitDraft[];

        return (
          <div
            key={chapter.clientKey}
            className={cn(
              "rounded-2xl border border-slate-200 bg-white shadow-sm transition",
              dragChapterKey === chapter.clientKey && "opacity-60 ring-2 ring-brand-300",
            )}
            draggable
            onDragStart={() => setDragChapterKey(chapter.clientKey)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!dragChapterKey) return;
              const from = chapters.findIndex((c) => c.clientKey === dragChapterKey);
              if (from < 0) return;
              setChapters(moveItem(chapters, from, cIndex));
              setDragChapterKey(null);
            }}
            onDragEnd={() => setDragChapterKey(null)}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
              <button
                type="button"
                className="cursor-grab text-slate-400 hover:text-slate-600"
                title="Drag to reorder chapter"
                aria-label="Drag chapter"
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
                onClick={() =>
                  toggle(expandedChapters, chapter.clientKey, setExpandedChapters)
                }
              >
                {chOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">
                  Chapter {chapter.chapterNo || cIndex + 1}
                  {chapter.title ? (
                    <span className="font-normal text-slate-600">
                      {" "}
                      · {chapter.title}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-500">
                  {units.length} unit{units.length === 1 ? "" : "s"} ·{" "}
                  {units.reduce(
                    (n, u) => n + ((u.subUnits as SubUnitDraft[])?.length ?? 0),
                    0,
                  )}{" "}
                  sub-unit(s)
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const unitsList = chapter.units as UnitDraft[];
                    updateChapter(cIndex, {
                      units: [...unitsList, emptyUnit(unitsList.length + 1)],
                    });
                    setExpandedChapters((s) => new Set(s).add(chapter.clientKey));
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Unit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  title="Duplicate chapter"
                  onClick={() => {
                    const clone: ChapterDraft = {
                      ...structuredClone(chapter),
                      clientKey: emptyChapter().clientKey,
                      title: `${chapter.title || "Chapter"} (copy)`,
                      units: (chapter.units as UnitDraft[]).map((u) => ({
                        ...structuredClone(u),
                        clientKey: emptyUnit().clientKey,
                        subUnits: (u.subUnits as SubUnitDraft[]).map((s) => ({
                          ...structuredClone(s),
                          clientKey: emptySubUnit().clientKey,
                        })),
                      })),
                    };
                    const next = [...chapters];
                    next.splice(cIndex + 1, 0, clone);
                    setChapters(next);
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-rose-600 border-rose-200 hover:bg-rose-50"
                  disabled={chapters.length <= 1}
                  onClick={() => {
                    if (chapters.length <= 1) return;
                    setChapters(chapters.filter((_, i) => i !== cIndex));
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {chOpen ? (
              <div className="space-y-4 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label="Chapter title">
                    <Input
                      value={chapter.title}
                      onChange={(e) => updateChapter(cIndex, { title: e.target.value })}
                      placeholder="e.g. Fundamentals of Nursing"
                    />
                  </FormField>
                  <FormField label="Estimated hours">
                    <NumberInput
                      min={0}
                      value={chapter.estimatedHours ?? 0}
                      onChange={(e) =>
                        updateChapter(cIndex, {
                          estimatedHours: e.target.valueAsNumber || 0,
                        })
                      }
                    />
                  </FormField>
                  <FormField label="Weightage %">
                    <NumberInput
                      min={0}
                      max={100}
                      value={chapter.weightagePercent ?? 0}
                      onChange={(e) =>
                        updateChapter(cIndex, {
                          weightagePercent: e.target.valueAsNumber || 0,
                        })
                      }
                    />
                  </FormField>
                  <FormField label="Expected completion month">
                    <Select
                      value={chapter.tentativeCompletionMonth || ""}
                      onChange={(e) =>
                        updateChapter(cIndex, {
                          tentativeCompletionMonth: e.target.value,
                        })
                      }
                    >
                      <option value="">Optional</option>
                      {NEPALI_MONTHS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <div className="md:col-span-2">
                    <FormField label="Chapter description">
                      <Textarea
                        value={chapter.description || ""}
                        onChange={(e) =>
                          updateChapter(cIndex, { description: e.target.value })
                        }
                        placeholder="Brief chapter overview"
                      />
                    </FormField>
                  </div>
                  <FormField label="References">
                    <Textarea
                      value={chapter.references || ""}
                      onChange={(e) =>
                        updateChapter(cIndex, { references: e.target.value })
                      }
                    />
                  </FormField>
                  <FormField label="Remarks">
                    <Textarea
                      value={chapter.remarks || ""}
                      onChange={(e) =>
                        updateChapter(cIndex, { remarks: e.target.value })
                      }
                    />
                  </FormField>
                </div>

                <div className="space-y-3">
                  {units.map((unit, uIndex) => {
                    const uOpen = expandedUnits.has(unit.clientKey);
                    const subUnits = unit.subUnits as SubUnitDraft[];

                    return (
                      <div
                        key={unit.clientKey}
                        className="rounded-xl border border-slate-200 bg-slate-50/60"
                      >
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <button
                            type="button"
                            className="rounded p-1 text-slate-500 hover:bg-white"
                            onClick={() =>
                              toggle(expandedUnits, unit.clientKey, setExpandedUnits)
                            }
                          >
                            {uOpen ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <p className="min-w-0 flex-1 text-sm font-medium text-slate-800">
                            Unit {unit.unitNo || uIndex + 1}
                            {unit.title ? (
                              <span className="font-normal text-slate-600">
                                {" "}
                                · {unit.title}
                              </span>
                            ) : null}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => {
                              updateUnit(cIndex, uIndex, {
                                subUnits: [
                                  ...subUnits,
                                  emptySubUnit(subUnits.length + 1),
                                ],
                              });
                              setExpandedUnits((s) => new Set(s).add(unit.clientKey));
                            }}
                          >
                            <Plus className="mr-1 h-3.5 w-3.5" />
                            Sub Unit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8"
                            title="Duplicate unit"
                            onClick={() => {
                              const clone: UnitDraft = {
                                ...structuredClone(unit),
                                clientKey: emptyUnit().clientKey,
                                title: `${unit.title || "Unit"} (copy)`,
                                subUnits: subUnits.map((s) => ({
                                  ...structuredClone(s),
                                  clientKey: emptySubUnit().clientKey,
                                })),
                              };
                              const next = [...units];
                              next.splice(uIndex + 1, 0, clone);
                              updateChapter(cIndex, { units: next });
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-rose-600 border-rose-200"
                            disabled={units.length <= 1}
                            onClick={() => {
                              if (units.length <= 1) return;
                              updateChapter(cIndex, {
                                units: units.filter((_, i) => i !== uIndex),
                              });
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            disabled={uIndex === 0}
                            onClick={() =>
                              updateChapter(cIndex, {
                                units: moveItem(units, uIndex, uIndex - 1),
                              })
                            }
                            title="Move up"
                          >
                            ↑
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2"
                            disabled={uIndex >= units.length - 1}
                            onClick={() =>
                              updateChapter(cIndex, {
                                units: moveItem(units, uIndex, uIndex + 1),
                              })
                            }
                            title="Move down"
                          >
                            ↓
                          </Button>
                        </div>

                        {uOpen ? (
                          <div className="space-y-3 border-t border-slate-200 p-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <FormField label="Unit title">
                                <Input
                                  value={unit.title}
                                  onChange={(e) =>
                                    updateUnit(cIndex, uIndex, {
                                      title: e.target.value,
                                    })
                                  }
                                  placeholder="Topic title"
                                />
                              </FormField>
                              <FormField label="Teaching hours">
                                <NumberInput
                                  min={0}
                                  value={unit.teachingHours ?? 0}
                                  onChange={(e) =>
                                    updateUnit(cIndex, uIndex, {
                                      teachingHours: e.target.valueAsNumber || 0,
                                    })
                                  }
                                />
                              </FormField>
                              <div className="md:col-span-2">
                                <FormField label="Description">
                                  <Textarea
                                    value={unit.description || ""}
                                    onChange={(e) =>
                                      updateUnit(cIndex, uIndex, {
                                        description: e.target.value,
                                      })
                                    }
                                  />
                                </FormField>
                              </div>
                              <FormField label="Learning objective">
                                <Textarea
                                  value={unit.learningObjective || ""}
                                  onChange={(e) =>
                                    updateUnit(cIndex, uIndex, {
                                      learningObjective: e.target.value,
                                    })
                                  }
                                />
                              </FormField>
                              <FormField label="References">
                                <Textarea
                                  value={unit.references || ""}
                                  onChange={(e) =>
                                    updateUnit(cIndex, uIndex, {
                                      references: e.target.value,
                                    })
                                  }
                                />
                              </FormField>
                            </div>

                            <div className="space-y-2">
                              {subUnits.map((sub, sIndex) => {
                                const sOpen = expandedSubs.has(sub.clientKey);
                                const displayNo = `${unit.unitNo || uIndex + 1}.${sub.subUnitNo || sIndex + 1}`;

                                return (
                                  <div
                                    key={sub.clientKey}
                                    className="rounded-lg border border-slate-200 bg-white"
                                  >
                                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                                      <button
                                        type="button"
                                        className="rounded p-1 text-slate-500 hover:bg-slate-50"
                                        onClick={() =>
                                          toggle(
                                            expandedSubs,
                                            sub.clientKey,
                                            setExpandedSubs,
                                          )
                                        }
                                      >
                                        {sOpen ? (
                                          <ChevronDown className="h-4 w-4" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4" />
                                        )}
                                      </button>
                                      <span className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">
                                        {displayNo}
                                      </span>
                                      <p className="min-w-0 flex-1 truncate text-sm text-slate-800">
                                        {sub.heading || "Untitled sub unit"}
                                      </p>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 text-rose-600 border-rose-200"
                                        disabled={subUnits.length <= 1}
                                        onClick={() => {
                                          if (subUnits.length <= 1) return;
                                          updateUnit(cIndex, uIndex, {
                                            subUnits: subUnits.filter(
                                              (_, i) => i !== sIndex,
                                            ),
                                          });
                                        }}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2"
                                        disabled={sIndex === 0}
                                        onClick={() =>
                                          updateUnit(cIndex, uIndex, {
                                            subUnits: moveItem(
                                              subUnits,
                                              sIndex,
                                              sIndex - 1,
                                            ),
                                          })
                                        }
                                      >
                                        ↑
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2"
                                        disabled={sIndex >= subUnits.length - 1}
                                        onClick={() =>
                                          updateUnit(cIndex, uIndex, {
                                            subUnits: moveItem(
                                              subUnits,
                                              sIndex,
                                              sIndex + 1,
                                            ),
                                          })
                                        }
                                      >
                                        ↓
                                      </Button>
                                    </div>

                                    {sOpen ? (
                                      <div className="space-y-3 border-t border-slate-100 p-3">
                                        <FormField label="Heading">
                                          <Input
                                            value={sub.heading}
                                            onChange={(e) =>
                                              updateSub(cIndex, uIndex, sIndex, {
                                                heading: e.target.value,
                                              })
                                            }
                                            placeholder="e.g. Measuring Blood Pressure"
                                          />
                                        </FormField>
                                        <FormField label="Description (rich text)">
                                          <RichTextEditor
                                            value={sub.description || ""}
                                            onChange={(html) =>
                                              updateSub(cIndex, uIndex, sIndex, {
                                                description: html,
                                              })
                                            }
                                            placeholder="Detailed sub-topic content…"
                                          />
                                        </FormField>
                                        <FormField label="Learning outcomes">
                                          <Textarea
                                            value={sub.learningOutcomes || ""}
                                            onChange={(e) =>
                                              updateSub(cIndex, uIndex, sIndex, {
                                                learningOutcomes: e.target.value,
                                              })
                                            }
                                            placeholder={"Students will be able to\n• Measure Pulse\n• Measure Temperature"}
                                          />
                                        </FormField>
                                        <div className="grid gap-3 md:grid-cols-2">
                                          <FormField label="Internal assessment (optional)">
                                            <Input
                                              value={sub.internalAssessment || ""}
                                              onChange={(e) =>
                                                updateSub(cIndex, uIndex, sIndex, {
                                                  internalAssessment: e.target.value,
                                                })
                                              }
                                            />
                                          </FormField>
                                          <FormField label="Estimated teaching hours">
                                            <NumberInput
                                              min={0}
                                              value={sub.teachingHours ?? 0}
                                              onChange={(e) =>
                                                updateSub(cIndex, uIndex, sIndex, {
                                                  teachingHours:
                                                    e.target.valueAsNumber || 0,
                                                })
                                              }
                                            />
                                          </FormField>
                                        </div>
                                        <label className="flex items-center gap-2 text-sm text-slate-700">
                                          <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-slate-300"
                                            checked={Boolean(sub.practicalRequired)}
                                            onChange={(e) =>
                                              updateSub(cIndex, uIndex, sIndex, {
                                                practicalRequired: e.target.checked,
                                              })
                                            }
                                          />
                                          Practical required
                                        </label>
                                        {sub.practicalRequired ? (
                                          <div className="grid gap-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 md:grid-cols-2">
                                            <FormField label="Lab name">
                                              <Input
                                                value={sub.labName || ""}
                                                onChange={(e) =>
                                                  updateSub(cIndex, uIndex, sIndex, {
                                                    labName: e.target.value,
                                                  })
                                                }
                                              />
                                            </FormField>
                                            <FormField label="Required equipment">
                                              <Input
                                                value={sub.requiredEquipment || ""}
                                                onChange={(e) =>
                                                  updateSub(cIndex, uIndex, sIndex, {
                                                    requiredEquipment: e.target.value,
                                                  })
                                                }
                                              />
                                            </FormField>
                                            <FormField label="Hospital posting">
                                              <Input
                                                value={sub.hospitalPosting || ""}
                                                onChange={(e) =>
                                                  updateSub(cIndex, uIndex, sIndex, {
                                                    hospitalPosting: e.target.value,
                                                  })
                                                }
                                              />
                                            </FormField>
                                            <FormField label="Clinical hours">
                                              <NumberInput
                                                min={0}
                                                value={sub.clinicalHours ?? 0}
                                                onChange={(e) =>
                                                  updateSub(cIndex, uIndex, sIndex, {
                                                    clinicalHours:
                                                      e.target.valueAsNumber || 0,
                                                  })
                                                }
                                              />
                                            </FormField>
                                          </div>
                                        ) : null}
                                        <div className="grid gap-3 md:grid-cols-2">
                                          <FormField label="Textbooks">
                                            <Textarea
                                              value={sub.references?.textbooks || ""}
                                              onChange={(e) =>
                                                updateSub(cIndex, uIndex, sIndex, {
                                                  references: {
                                                    ...sub.references!,
                                                    textbooks: e.target.value,
                                                  },
                                                })
                                              }
                                            />
                                          </FormField>
                                          <FormField label="Journal">
                                            <Textarea
                                              value={sub.references?.journal || ""}
                                              onChange={(e) =>
                                                updateSub(cIndex, uIndex, sIndex, {
                                                  references: {
                                                    ...sub.references!,
                                                    journal: e.target.value,
                                                  },
                                                })
                                              }
                                            />
                                          </FormField>
                                          <FormField label="WHO Guidelines">
                                            <Textarea
                                              value={
                                                sub.references?.whoGuidelines || ""
                                              }
                                              onChange={(e) =>
                                                updateSub(cIndex, uIndex, sIndex, {
                                                  references: {
                                                    ...sub.references!,
                                                    whoGuidelines: e.target.value,
                                                  },
                                                })
                                              }
                                            />
                                          </FormField>
                                          <FormField label="Internet resources">
                                            <Textarea
                                              value={
                                                sub.references?.internetResources ||
                                                ""
                                              }
                                              onChange={(e) =>
                                                updateSub(cIndex, uIndex, sIndex, {
                                                  references: {
                                                    ...sub.references!,
                                                    internetResources: e.target.value,
                                                  },
                                                })
                                              }
                                            />
                                          </FormField>
                                        </div>
                                        <FormField label="Attachment URL (PDF/Word/Excel/PPT/Image/Video)">
                                          <Input
                                            value={sub.attachments?.[0]?.url || ""}
                                            onChange={(e) =>
                                              updateSub(cIndex, uIndex, sIndex, {
                                                attachments: e.target.value
                                                  ? [
                                                      {
                                                        url: e.target.value,
                                                        name: "Attachment",
                                                      },
                                                    ]
                                                  : [],
                                              })
                                            }
                                            placeholder="https://… or /uploads/…"
                                          />
                                        </FormField>
                                        <FormField label="Remarks">
                                          <Textarea
                                            value={sub.remarks || ""}
                                            onChange={(e) =>
                                              updateSub(cIndex, uIndex, sIndex, {
                                                remarks: e.target.value,
                                              })
                                            }
                                          />
                                        </FormField>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

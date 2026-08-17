"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface GroupMultiSelectOption {
  id: string;
  label: string;
}

interface GroupMultiSelectSection {
  label: string;
  options: GroupMultiSelectOption[];
}

interface GroupMultiSelectProps {
  ariaLabel: string;
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  sections: GroupMultiSelectSection[];
  // A team takes one customer group, so picking replaces the current
  // selection rather than adding a second tick. Still an array either way —
  // callers keep one shape, and a legacy row that already holds several
  // groups can still show them until someone chooses which one stays.
  single?: boolean;
  // Shown in place of the placeholder when there is nothing to offer. The
  // trigger disables itself at zero options, and "Select group…" on a control
  // that cannot be opened reads as a bug rather than as an answer.
  emptyLabel?: string;
}

export default function GroupMultiSelect({
  ariaLabel,
  selectedIds,
  onChange,
  sections,
  single = false,
  emptyLabel,
}: GroupMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const totalOptions = sections.reduce(
    (sum, section) => sum + section.options.length,
    0,
  );

  // Labels are looked up from whichever section still lists the id, so a
  // selection keeps its display text even if the sections' contents shift
  // between renders (e.g. an option moves between "existing" and
  // "not yet grouped" as availability changes).
  const labelById = new Map<string, string>();
  sections.forEach((section) => {
    section.options.forEach((option) => {
      labelById.set(option.id, option.label);
    });
  });

  const summary =
    selectedIds.length === 0
      ? totalOptions === 0 && emptyLabel
        ? emptyLabel
        : single
          ? "Select group…"
          : "Select groups…"
      : selectedIds.length === 1
        ? (labelById.get(selectedIds[0]) ?? "1 selected")
        : // Only reachable in single mode for a row assigned before the
          // one-group rule; the count is the prompt to pick which one keeps.
          `${selectedIds.length} groups selected`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleOption(id: string) {
    if (single) {
      // Clicking the current pick clears it; anything else takes its place.
      // The panel closes either way — with one slot to fill there is nothing
      // left to tick, and leaving it open reads as "keep going".
      onChange(selectedIds.length === 1 && selectedIds[0] === id ? [] : [id]);
      setOpen(false);
      return;
    }

    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((selectedId) => selectedId !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  return (
    <div className="group-multiselect" ref={rootRef}>
      <button
        type="button"
        className="group-multiselect-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={totalOptions === 0}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{summary}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <div
          className="group-multiselect-panel"
          role="listbox"
          aria-label={ariaLabel}
          aria-multiselectable={!single}
        >
          {sections.map((section) =>
            section.options.length === 0 ? null : (
              <div className="group-multiselect-section" key={section.label}>
                <small>{section.label}</small>
                {section.options.map((option) => {
                  const selected = selectedIds.includes(option.id);
                  return (
                    <button
                      type="button"
                      key={option.id}
                      className={
                        selected
                          ? "group-multiselect-option selected"
                          : "group-multiselect-option"
                      }
                      role="option"
                      aria-selected={selected}
                      onClick={() => toggleOption(option.id)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

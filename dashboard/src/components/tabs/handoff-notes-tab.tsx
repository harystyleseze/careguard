"use client";

import { useEffect, useState, type FormEvent } from "react";
import { caregiverFetch } from "../../lib/caregiver-fetch";
import { HANDOFF_NOTE_MAX_LENGTH, HandoffNoteSchema, type HandoffNote } from "../../lib/types";
import { formatDateTime, getTranslations, type Locale } from "../../i18n";

const NOTES_PAGE_SIZE = 20;

export interface HandoffNotesTabProps {
  recipientId: string;
  /** Name attached to notes posted with the shared operator token. */
  authorName: string;
  locale?: Locale;
}

/**
 * Shift handoff notes (#1180): a timestamped feed co-caregivers use to leave
 * context for each other. The agent reads the latest notes via the
 * get_handoff_notes tool.
 */
export function HandoffNotesTab({ recipientId, authorName, locale = "en" }: HandoffNotesTabProps) {
  const t = getTranslations(locale).notes;
  const [notes, setNotes] = useState<HandoffNote[]>([]);
  const [text, setText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const notesPath = `/recipients/${encodeURIComponent(recipientId)}/handoff-notes`;

  useEffect(() => {
    let cancelled = false;
    caregiverFetch(`${notesPath}?limit=${NOTES_PAGE_SIZE}`)
      .then(async (res) => {
        const parsed = HandoffNoteSchema.array().safeParse(res.ok ? (await res.json())?.notes : null);
        if (cancelled) return;
        if (parsed.success) {
          setNotes(parsed.data);
          setLoadError(null);
        } else {
          setLoadError(t.loadFailed);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(t.loadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [notesPath, t.loadFailed]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) {
      setError(t.required);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await caregiverFetch(notesPath, {
        method: "POST",
        body: JSON.stringify({ text, author: authorName }),
      });
      if (!res.ok) {
        setError(res.status === 403 ? t.forbidden : t.saveFailed);
        return;
      }
      const created = HandoffNoteSchema.safeParse(await res.json());
      if (created.success) setNotes((prev) => [created.data, ...prev].slice(0, NOTES_PAGE_SIZE));
      setText("");
    } catch {
      setError(t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="tabpanel"
      id="tabpanel-notes"
      aria-labelledby="tab-notes"
      tabIndex={0}
      className="space-y-6 max-w-2xl"
    >
      <section aria-labelledby="handoff-notes-title" className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 id="handoff-notes-title" className="text-sm font-semibold text-slate-700 mb-1">
          {t.title}
        </h2>
        <p className="text-xs text-slate-500 mb-4">{t.description}</p>

        <form noValidate onSubmit={handleSubmit} className="space-y-2 mb-6">
          <label htmlFor="handoff-note-text" className="block text-xs font-medium text-slate-600">
            {t.label}
          </label>
          <textarea
            id="handoff-note-text"
            rows={3}
            maxLength={HANDOFF_NOTE_MAX_LENGTH}
            value={text}
            placeholder={t.placeholder}
            onChange={(e) => setText(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-400">
              {HANDOFF_NOTE_MAX_LENGTH - text.length} {t.charactersLeft}
            </span>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-sky-500 text-white hover:bg-sky-600 active:bg-sky-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t.submit}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-red-600">
              {error}
            </p>
          )}
        </form>

        {loadError ? (
          <p role="alert" className="text-xs text-red-600">
            {loadError}
          </p>
        ) : notes.length === 0 ? (
          <p className="text-xs text-slate-500">{t.empty}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {notes.map((note) => (
              <li key={note.id} className="py-3">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-slate-700">{note.author}</span>
                  <time dateTime={note.created_at} className="text-slate-400">
                    {formatDateTime(note.created_at, locale)}
                  </time>
                </div>
                <p className="text-sm text-slate-700 mt-1 break-words">{note.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

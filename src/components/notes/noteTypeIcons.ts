import {
  BookMarked,
  HelpCircle,
  Highlighter,
  Lightbulb,
  ListChecks,
  type LucideIcon,
  PenLine,
  ScrollText,
  Sparkles,
  Zap,
} from "lucide-react";
import type { NoteType } from "@/lib/types";

/** Icon per note type. Kept out of the UI-free `lib/notes.ts` catalog so that
 *  module carries no React/lucide dependency. */
export const NOTE_TYPE_ICON: Record<NoteType, LucideIcon> = {
  highlight: Highlighter,
  insight: Lightbulb,
  reflection: PenLine,
  question: HelpCircle,
  action: Zap,
  exercise: ListChecks,
  vocabulary: BookMarked,
  summary: ScrollText,
  meditation: Sparkles,
};

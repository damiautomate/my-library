import { BookAudioProvider } from "@/components/audio/BookAudioProvider";

/**
 * Layout shared by every `/book/[bookId]/*` route (detail, reader, notebook).
 * Next preserves a layout instance across navigation within the same segment,
 * so the audio engine mounted by BookAudioProvider keeps playing — and stays
 * in sync — as the member moves between the reader and the notebook.
 */
export default function BookLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { bookId: string };
}) {
  return <BookAudioProvider bookId={params.bookId}>{children}</BookAudioProvider>;
}

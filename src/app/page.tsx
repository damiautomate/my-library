import Link from "next/link";
import { Header } from "@/components/library/Header";

export default function LandingPage() {
  return (
    <>
      <Header />

      <main className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 sm:pb-24">
        {/* Hero */}
        <section className="grid grid-cols-1 gap-8 pb-12 pt-12 sm:gap-10 sm:pb-16 sm:pt-20 md:grid-cols-12">
          <div className="md:col-span-7">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.25em] text-oxblood-700">
              An invitation-only reading room
            </p>
            <h1 className="mt-5 font-display text-4xl leading-[0.95] tracking-tightest text-ink-900 sm:text-5xl md:text-7xl">
              The library
              <br />
              <span className="text-oxblood-700">that reads back.</span>
            </h1>
            <p className="ml-text-balance mt-6 max-w-xl text-base leading-relaxed text-ink-700">
              A small, deliberate compendium of books — chosen for the work of
              becoming, classified across twenty-six domains and seven stages
              of a serious life. No infinite scroll. No noise. Eleven rooms,
              and the books that belong in each.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3 sm:mt-10">
              <Link
                href="/login"
                className="rounded-sm border border-oxblood-700 bg-oxblood-600 px-6 py-3 text-sm font-medium text-parchment-50 transition-colors hover:bg-oxblood-700"
              >
                Enter the Library →
              </Link>
              <a
                href="mailto:damilare@example.com?subject=My Library — request access"
                className="px-4 py-3 text-sm text-ink-700 underline-offset-4 hover:underline"
              >
                Request access
              </a>
            </div>
          </div>

          {/* Decorative side: classical numbering */}
          <aside className="md:col-span-5">
            <div className="ml-card relative overflow-hidden p-6 sm:p-8">
              <div className="absolute -right-6 -top-10 font-display text-[8rem] leading-none text-parchment-200 select-none sm:text-[12rem]">
                I
              </div>
              <div className="relative">
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
                  Of the Library
                </p>
                <h2 className="mt-3 font-display text-2xl leading-tight tracking-tight sm:text-3xl">
                  What makes a library different from a bookshop?
                </h2>
                <p className="ml-dropcap mt-4 text-sm leading-relaxed text-ink-700">
                  Curation. A library is a person's mind, arranged in rooms.
                  Each book here exists because it answers a question a serious
                  reader is asking — about purpose, money, leadership, faith,
                  family, craft, or the long fight with one's own attention.
                </p>
              </div>
            </div>
          </aside>
        </section>

        <hr className="my-6" />

        {/* Editorial three-column principles */}
        <section className="grid grid-cols-1 gap-6 py-10 sm:gap-8 sm:py-12 md:grid-cols-3">
          {[
            {
              n: "II",
              title: "Curated, not crowdsourced",
              body:
                "Books are added one at a time, by hand, with a note explaining why each one matters.",
            },
            {
              n: "III",
              title: "Eleven rooms",
              body:
                "The Workshop, the Counting Room, the Chapel — every book lives somewhere, and the architecture is the index.",
            },
            {
              n: "IV",
              title: "Built for the long fight",
              body:
                "Progress is private. There are no points, no leaderboards. Reading is the reward.",
            },
          ].map((it) => (
            <article key={it.n} className="flex flex-col gap-3">
              <span className="font-display text-3xl text-oxblood-700">
                {it.n}.
              </span>
              <h3 className="font-display text-xl tracking-tight">{it.title}</h3>
              <p className="text-sm leading-relaxed text-ink-700">{it.body}</p>
            </article>
          ))}
        </section>

        <hr className="my-6" />

        {/* Footer note */}
        <footer className="pt-10 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
          My Library · A private reading room · Est. 2026
        </footer>
      </main>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Library, Users, MailPlus, BookOpen, Plus, Layers } from "lucide-react";
import { collection, getCountFromServer, query, where } from "firebase/firestore";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { db } from "@/lib/firebase/client";

export default function AdminPage() {
  return (
    <AuthGuard requireAdmin>
      <Header />
      <AdminDashboard />
    </AuthGuard>
  );
}

function AdminDashboard() {
  const [stats, setStats] = useState<{
    books: number;
    published: number;
    drafts: number;
    users: number;
    pendingInvites: number;
  }>({ books: 0, published: 0, drafts: 0, users: 0, pendingInvites: 0 });

  useEffect(() => {
    (async () => {
      const [b, pub, draft, u, inv] = await Promise.all([
        getCountFromServer(collection(db, "books")),
        getCountFromServer(query(collection(db, "books"), where("status", "==", "published"))),
        getCountFromServer(query(collection(db, "books"), where("status", "==", "draft"))),
        getCountFromServer(collection(db, "users")),
        getCountFromServer(
          query(collection(db, "invitations"), where("status", "==", "pending")),
        ),
      ]);
      setStats({
        books: b.data().count,
        published: pub.data().count,
        drafts: draft.data().count,
        users: u.data().count,
        pendingInvites: inv.data().count,
      });
    })().catch(() => {
      /* fail open — counts will stay zero */
    });
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6 sm:pb-24 sm:pt-12">
      <header className="mb-10 flex flex-col gap-3 border-b ml-hairline pb-4 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
            Admin
          </p>
          <h1 className="mt-2 font-display text-3xl tracking-tightest sm:text-4xl">
            The Librarian's desk
          </h1>
        </div>
        <Link
          href="/admin/books/new"
          className="inline-flex items-center gap-2 rounded-sm border border-oxblood-700 bg-oxblood-600 px-4 py-2 text-sm text-parchment-50 hover:bg-oxblood-700"
        >
          <Plus size={14} /> Add book
        </Link>
      </header>

      {/* Stats grid */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Books" value={stats.books} sub={`${stats.published} published · ${stats.drafts} draft`} />
        <Stat label="Members" value={stats.users} />
        <Stat label="Pending invites" value={stats.pendingInvites} />
        <Stat label="App phase" value="I" sub="Foundation" />
      </section>

      {/* Quick links */}
      <section className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <QuickLink
          href="/admin/books"
          icon={<Library size={18} />}
          title="Manage books"
          body="Browse the full catalogue, edit any entry, change status."
        />
        <QuickLink
          href="/admin/books/bulk"
          icon={<Layers size={18} />}
          title="Bulk import"
          body="Add many books at once — by titles, PDFs, or public-domain sources."
        />
        <QuickLink
          href="/admin/invitations"
          icon={<MailPlus size={18} />}
          title="Invitations"
          body="Add an email to the allowlist or revoke an outstanding invite."
        />
        <QuickLink
          href="/admin/users"
          icon={<Users size={18} />}
          title="Members"
          body="See who's in the library and what role they hold."
        />
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="ml-card p-5">
      <p className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-500">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl tracking-tightest sm:text-4xl text-ink-900">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-ink-600">{sub}</p>}
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-sm border ml-hairline bg-parchment-50 p-5 shadow-paper transition-all hover:shadow-paper-lg"
    >
      <div className="inline-flex w-fit rounded-full border ml-hairline bg-parchment-100 p-2.5 text-oxblood-700 transition-colors group-hover:bg-oxblood-50">
        {icon}
      </div>
      <h3 className="font-display text-xl tracking-tight">{title}</h3>
      <p className="text-sm text-ink-700">{body}</p>
    </Link>
  );
}

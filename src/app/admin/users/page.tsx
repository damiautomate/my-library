"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { db } from "@/lib/firebase/client";
import type { UserDoc } from "@/lib/types";

export default function AdminUsersPage() {
  return (
    <AuthGuard requireAdmin>
      <Header />
      <UsersContent />
    </AuthGuard>
  );
}

function UsersContent() {
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const snap = await getDocs(
        query(collection(db, "users"), orderBy("joined_at", "desc")),
      );
      setUsers(snap.docs.map((d) => d.data() as UserDoc));
      setLoading(false);
    })();
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-6 pb-24 pt-12">
      <header className="mb-8 border-b ml-hairline pb-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          Admin · Members
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tightest">
          The Roll
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-600">
          Everyone with a key to the library.
        </p>
      </header>

      <section className="ml-card overflow-hidden">
        {loading ? (
          <p className="px-5 py-8 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
            Loading members…
          </p>
        ) : users.length === 0 ? (
          <p className="px-5 py-10 text-center text-ink-600">
            No members yet. Send the first invitation.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b ml-hairline bg-parchment-100 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-ink-600">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.uid}
                  className="border-b ml-hairline last:border-b-0 hover:bg-parchment-100/60"
                >
                  <td className="px-4 py-3 font-display text-base">
                    {u.display_name || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-700">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.role === "admin"
                          ? "ml-chip ml-chip--accent"
                          : "ml-chip"
                      }
                    >
                      {u.role}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="mt-6 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
        Role changes and suspension arrive in Phase 4.
      </p>
    </main>
  );
}

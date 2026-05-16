"use client";

import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { Shield, ShieldCheck, UserX, UserCheck, Loader2 } from "lucide-react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { auth, db } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";
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
  const { firebaseUser } = useAuth();
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const snap = await getDocs(
      query(collection(db, "users"), orderBy("joined_at", "desc")),
    );
    setUsers(snap.docs.map((d) => d.data() as UserDoc));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function update(
    targetUid: string,
    body: { role?: "admin" | "member"; disabled?: boolean },
    confirmMsg?: string,
  ) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setError(null);
    setBusyUid(targetUid);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      const res = await fetch("/api/users/role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ uid: targetUid, ...body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Update failed");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 pb-24 pt-12">
      <header className="mb-8 border-b ml-hairline pb-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          Admin · Members
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tightest">
          The Roll
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-600">
          Promote, demote, or suspend members. The last active admin can't
          remove their own admin role — promote someone else first.
        </p>
      </header>

      {error && (
        <div className="mb-5 rounded-sm border border-oxblood-600/40 bg-oxblood-50 px-4 py-3 text-sm text-oxblood-700">
          {error}
        </div>
      )}

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
                <th className="hidden px-4 py-3 text-left md:table-cell">Email</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.uid === firebaseUser?.uid;
                const isBusy = busyUid === u.uid;
                return (
                  <tr
                    key={u.uid}
                    className="border-b ml-hairline last:border-b-0 hover:bg-parchment-100/60"
                  >
                    <td className="px-4 py-3">
                      <div className="font-display text-base">
                        {u.display_name || "—"}
                        {isSelf && (
                          <span className="ml-2 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500">
                            (you)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-600 md:hidden">
                        {u.email}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-ink-700 md:table-cell">
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
                    <td className="px-4 py-3">
                      {u.disabled ? (
                        <span className="ml-chip ml-chip--accent">suspended</span>
                      ) : (
                        <span className="ml-chip ml-chip--forest">active</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {isBusy ? (
                          <Loader2
                            size={14}
                            className="animate-spin text-ink-500"
                          />
                        ) : isSelf ? (
                          <span className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-500">
                            Use another admin
                          </span>
                        ) : (
                          <>
                            {u.role === "member" ? (
                              <button
                                onClick={() =>
                                  void update(
                                    u.uid,
                                    { role: "admin" },
                                    `Promote ${u.display_name || u.email} to admin?`,
                                  )
                                }
                                className="inline-flex items-center gap-1.5 rounded-sm border border-oxblood-600/40 bg-oxblood-50 px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.15em] text-oxblood-700 hover:bg-oxblood-50/80"
                              >
                                <ShieldCheck size={11} />
                                Promote
                              </button>
                            ) : (
                              <button
                                onClick={() =>
                                  void update(
                                    u.uid,
                                    { role: "member" },
                                    `Demote ${u.display_name || u.email} to member?`,
                                  )
                                }
                                className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/25 bg-parchment-50 px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.15em] text-ink-700 hover:bg-parchment-100"
                              >
                                <Shield size={11} />
                                Demote
                              </button>
                            )}
                            {u.disabled ? (
                              <button
                                onClick={() =>
                                  void update(u.uid, { disabled: false })
                                }
                                className="inline-flex items-center gap-1.5 rounded-sm border border-forest-600/40 bg-forest-50 px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.15em] text-forest-600 hover:bg-forest-50/80"
                              >
                                <UserCheck size={11} />
                                Restore
                              </button>
                            ) : (
                              <button
                                onClick={() =>
                                  void update(
                                    u.uid,
                                    { disabled: true },
                                    `Suspend ${u.display_name || u.email}? They'll be signed out and unable to sign back in until restored.`,
                                  )
                                }
                                className="inline-flex items-center gap-1.5 rounded-sm border border-ink-500/25 bg-parchment-50 px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.15em] text-oxblood-700 hover:bg-oxblood-50"
                              >
                                <UserX size={11} />
                                Suspend
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

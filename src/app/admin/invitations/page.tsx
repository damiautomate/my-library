"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/library/Header";
import { AuthGuard } from "@/components/library/AuthGuard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { auth } from "@/lib/firebase/client";

interface InvitationItem {
  id: string;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "revoked";
  created_at?: { _seconds: number } | null;
}

export default function InvitationsPage() {
  return (
    <AuthGuard requireAdmin>
      <Header />
      <InvitationsContent />
    </AuthGuard>
  );
}

function InvitationsContent() {
  const [items, setItems] = useState<InvitationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      const res = await fetch("/api/invitations", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load");
      }
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    setError(null);
    if (!email.trim()) {
      setError("Email required");
      return;
    }
    setBusy(true);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Create failed");
      }
      setEmail("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this invitation? The recipient won't be able to sign up.")) return;
    setBusy(true);
    try {
      const u = auth.currentUser;
      if (!u) throw new Error("Not signed in");
      const token = await u.getIdToken();
      const res = await fetch(`/api/invitations?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Revoke failed");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-20 pt-8 sm:px-6 sm:pb-24 sm:pt-12">
      <header className="mb-8 border-b ml-hairline pb-4">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
          Admin · Invitations
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tightest sm:text-4xl">
          The Allowlist
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-600">
          Add an email here, then share the login URL with that person manually.
          They can only sign up once their email matches a pending invitation.
        </p>
      </header>

      {/* New invite form */}
      <section className="ml-card mb-10 p-6">
        <h2 className="mb-4 font-display text-xl">Invite someone</h2>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="reader@example.com"
            />
          </div>
          <div className="w-full md:w-44">
            <Select
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "member")}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          <Button onClick={handleCreate} disabled={busy}>
            {busy ? "…" : "Invite"}
          </Button>
        </div>
        {error && (
          <p className="mt-3 text-xs text-oxblood-700">{error}</p>
        )}
      </section>

      {/* List */}
      <section className="ml-card overflow-hidden">
        {loading ? (
          <p className="px-5 py-8 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="px-5 py-10 text-center text-ink-600">No invitations yet.</p>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm">
            <thead className="border-b ml-hairline bg-parchment-100 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-ink-600">
              <tr>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  className="border-b ml-hairline last:border-b-0 hover:bg-parchment-100/60"
                >
                  <td className="px-4 py-3 font-mono text-xs">{it.email}</td>
                  <td className="px-4 py-3 capitalize text-ink-700">{it.role}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={it.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {it.status === "pending" && (
                      <button
                        onClick={() => handleRevoke(it.id)}
                        className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-oxblood-700 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </main>
  );
}

function StatusPill({ status }: { status: InvitationItem["status"] }) {
  const cls =
    status === "accepted"
      ? "ml-chip ml-chip--forest"
      : status === "pending"
        ? "ml-chip ml-chip--gold"
        : "ml-chip";
  return <span className={cls}>{status}</span>;
}

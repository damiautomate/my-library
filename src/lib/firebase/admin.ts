import "server-only";
import { cert, getApps, initializeApp, App } from "firebase-admin/app";
import { getAuth, Auth } from "firebase-admin/auth";
import { getFirestore, Firestore } from "firebase-admin/firestore";

const ADMIN_APP_NAME = "my-library-admin";

let _app: App | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

function getAdminApp(): App {
  if (_app) return _app;

  const existing = getApps().find((a) => a.name === ADMIN_APP_NAME);
  if (existing) {
    _app = existing;
    return _app;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? "").replace(
    /\\n/g,
    "\n",
  );

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials missing. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY in .env.local.",
    );
  }

  _app = initializeApp(
    { credential: cert({ projectId, clientEmail, privateKey }) },
    ADMIN_APP_NAME,
  );
  return _app;
}

/** Lazy accessor — only initializes when first used (at request time). */
export function getAdminAuth(): Auth {
  if (!_auth) _auth = getAuth(getAdminApp());
  return _auth;
}

/** Lazy accessor — only initializes when first used (at request time). */
export function getAdminDb(): Firestore {
  if (!_db) _db = getFirestore(getAdminApp());
  return _db;
}

// Proxy exports preserve `adminAuth.foo()` / `adminDb.collection(...)` call
// sites without eagerly initializing the Admin SDK at module-load time.
// Methods are resolved against a freshly-fetched real instance on each access.
export const adminAuth: Auth = new Proxy({} as Auth, {
  get(_t, prop) {
    const real = getAdminAuth() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export const adminDb: Firestore = new Proxy({} as Firestore, {
  get(_t, prop) {
    const real = getAdminDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

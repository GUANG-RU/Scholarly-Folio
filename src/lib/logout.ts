import { signOut } from 'firebase/auth';
import { auth, setMemoryDriveAccessToken } from './firebase.ts';

export async function performZeroResidueLogout(redirectToHome = true): Promise<void> {
  try {
    const currentUser = auth.currentUser;
    const token = currentUser ? await currentUser.getIdToken().catch(() => null) : null;
    await fetch('/api/auth/logout', {
      method: 'POST',
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch {
    // Continue client cleanup even if network fails
  }

  setMemoryDriveAccessToken(null);

  try {
    await signOut(auth);
  } catch {
    // Continue storage cleanup
  }

  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // Ignore restricted storage access
  }

  try {
    if (typeof window.indexedDB !== 'undefined' && typeof window.indexedDB.databases === 'function') {
      const dbs = await window.indexedDB.databases();
      await Promise.all(
        dbs
          .map((db) => db.name)
          .filter((name): name is string => Boolean(name))
          .map(
            (name) =>
              new Promise<void>((resolve) => {
                const req = window.indexedDB.deleteDatabase(name);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              }),
          ),
      );
    }
  } catch {
    // Ignore IndexedDB cleanup errors
  }

  try {
    if ('caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key)));
    }
  } catch {
    // Ignore Cache Storage errors
  }

  if (redirectToHome) {
    window.location.replace('/');
  }
}

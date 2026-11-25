import { initializeApp } from 'firebase/app';
import {
  browserSessionPersistence,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Keep session scoped to the active browser tab session (never localStorage)
void setPersistence(auth, browserSessionPersistence);

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.addScope('https://www.googleapis.com/auth/drive');
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

// Keep Google Workspace OAuth access token strictly in memory (never localStorage/sessionStorage)
let cachedDriveAccessToken: string | null = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    cachedDriveAccessToken = null;
  }
});

export function setMemoryDriveAccessToken(token: string | null): void {
  cachedDriveAccessToken = token;
}

export function getMemoryDriveAccessToken(): string | null {
  return cachedDriveAccessToken;
}

export async function requestGoogleDriveAccessToken(): Promise<string> {
  const driveConsentProvider = new GoogleAuthProvider();
  driveConsentProvider.addScope('https://www.googleapis.com/auth/drive');
  driveConsentProvider.setCustomParameters({
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
  });
  const result = await signInWithPopup(auth, driveConsentProvider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('未能取得 Google Drive 存取授權，請再試一次。');
  }
  cachedDriveAccessToken = credential.accessToken;
  return credential.accessToken;
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined') {
  void testConnection();
}

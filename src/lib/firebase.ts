import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, FirestoreError } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Use the default Firestore database that is configured in Firebase Console.
export const db = getFirestore(app);

/**
 * Enhanced Firestore error handler for security auditing.
 */
export function handleFirestoreError(error: any, operation: string, path: string | null = null): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied') {
    const errorInfo = {
      error: 'Missing or insufficient permissions',
      operationType: operation,
      path: path,
      authInfo: {
        userId: auth.currentUser?.uid || 'anonymous',
        email: auth.currentUser?.email || 'N/A',
        emailVerified: auth.currentUser?.emailVerified || false,
        isAnonymous: auth.currentUser?.isAnonymous || true,
        providerInfo: auth.currentUser?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName || '',
          email: p.email || '',
        })) || []
      }
    };
    throw new Error(JSON.stringify(errorInfo));
  }
  throw error;
}

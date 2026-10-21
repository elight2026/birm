import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  collection,
  query,
  orderBy,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App & Services
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Operation Types & Error Handler conforming strictly to Firebase Skill requirements
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((p) => ({
        providerId: p.providerId,
        email: p.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Test connection on boot
export async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline or initializing.');
    }
  }
}
testFirestoreConnection();

// Authentication helpers
export async function loginWithGoogle(): Promise<User> {
  try {
    const res = await signInWithPopup(auth, googleProvider);
    // Sync user profile to Firestore
    if (res.user) {
      const userDocRef = doc(db, 'users', res.user.uid);
      await setDoc(
        userDocRef,
        {
          id: res.user.uid,
          email: res.user.email || '',
          displayName: res.user.displayName || 'BIRS User',
          photoURL: res.user.photoURL || '',
          lastLoginAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }
    return res.user;
  } catch (err: any) {
    console.error('Login error:', err);
    throw err;
  }
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

export { onAuthStateChanged, type User };

// Cloud Synchronization: Save Verification Batch
export async function saveBatchToCloud(userId: string, batchData: {
  id: string;
  name: string;
  totalNins: number;
  successCount: number;
  failedCount: number;
  status: 'completed' | 'running' | 'paused' | 'stopped';
  nins: string[];
  createdAt: string;
  updatedAt?: string;
}) {
  const path = `users/${userId}/batches/${batchData.id}`;
  try {
    const batchRef = doc(db, 'users', userId, 'batches', batchData.id);
    await setDoc(batchRef, {
      ...batchData,
      userId,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// Cloud Synchronization: Fetch User Batches
export async function fetchUserBatchesFromCloud(userId: string) {
  const path = `users/${userId}/batches`;
  try {
    const batchesCol = collection(db, 'users', userId, 'batches');
    const q = query(batchesCol, orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => docSnap.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// Cloud Synchronization: Save Verified Taxpayer Record
export async function saveTaxpayerToCloud(userId: string, taxpayer: {
  nin: string;
  fullName: string;
  firstName?: string;
  surname?: string;
  middleName?: string;
  state?: string;
  lga?: string;
  phone?: string;
  dob?: string;
  gender?: string;
  tin?: string;
  trackingId?: string;
  address?: string;
  status: string;
  verifiedAt: string;
  details?: Record<string, any>;
}) {
  const docId = `${taxpayer.nin}`;
  const path = `users/${userId}/taxpayers/${docId}`;
  try {
    const taxpayerRef = doc(db, 'users', userId, 'taxpayers', docId);
    await setDoc(taxpayerRef, {
      id: docId,
      userId,
      ...taxpayer,
    }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// Cloud Synchronization: Fetch User Verified Taxpayers
export async function fetchUserTaxpayersFromCloud(userId: string) {
  const path = `users/${userId}/taxpayers`;
  try {
    const taxpayersCol = collection(db, 'users', userId, 'taxpayers');
    const q = query(taxpayersCol, orderBy('verifiedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => docSnap.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// Cloud Synchronization: Delete Batch
export async function deleteBatchFromCloud(userId: string, batchId: string) {
  const path = `users/${userId}/batches/${batchId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'batches', batchId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

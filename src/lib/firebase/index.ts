import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { collection, getFirestore } from "firebase/firestore";

export const app =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(app);
export const firestore = getFirestore(app);
export const fireStorage = getStorage(app);

export const firestoreCollections = {
  usersCol: collection(firestore, "users"),
  previousSchedules :collection(firestore,"previousSchedules"),
};

///
/// firebase storage
///
import { getDownloadURL, getStorage, ref, uploadBytes } from "firebase/storage";
import { v4 as uuidv4 } from "uuid";
import { firebaseConfig } from "./config";

export async function uploadBlobToFirestore(
  blob: Blob,
  destinationBlobName?: string
): Promise<string> {
  // Create a reference to the destination blob
  const storageRef = ref(
    fireStorage,
    `images/${destinationBlobName || uuidv4()}`
  );
  // Upload the blob to Firebase Storage
  await uploadBytes(storageRef, blob);
  // Get the URL of the uploaded file
  const url = await getDownloadURL(storageRef);
  return url;
}

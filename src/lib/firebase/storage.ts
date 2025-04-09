import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { v4 as uuidv4 } from "uuid";
import { fireStorage } from "./index";

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
type RunObjectStore = {
  delete(key: string): Promise<void>;
};

export async function deleteRunBodyBestEffort(
  bucket: RunObjectStore,
  blobKey: string | null | undefined,
  onFailure: (error: unknown) => void = () => {},
) {
  if (!blobKey) return true;
  try {
    await bucket.delete(blobKey);
    return true;
  } catch (error) {
    onFailure(error);
    return false;
  }
}

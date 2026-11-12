// The public preview is fetched on the server, before any session exists.
// A backend that is down, replies with an error, or answers something that is
// not a JSON array must look exactly like a preview that does not exist — the
// page then renders its "Post not found" fallback instead of throwing.
export type PublicPreviewRequest = () => Promise<Response>;

export const loadPublicPreview = async <T = any>(
  request: PublicPreviewRequest
): Promise<T[]> => {
  try {
    const response = await request();
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
};

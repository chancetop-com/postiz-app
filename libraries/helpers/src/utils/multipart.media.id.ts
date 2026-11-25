import { v5 } from 'uuid';

// The R2 key identifies the object and the upload ID identifies this multipart
// session. The Media ID stays valid if the normalizer changes the object's name.
export function multipartMediaId(key: string, uploadId: string) {
  return v5(JSON.stringify(['postiz:r2:multipart', key, uploadId]), v5.URL);
}

// Lazy preview из IndexedDB-кеша фото.
//
// Принимает photoId и возвращает blob: URL, созданный из сохранённого blob'а.
// При смене id / размонтировании компонента URL.revokeObjectURL вызывается
// автоматически — иначе бы текли (в Safari blob URLs не GC'атся).

import { useEffect, useState } from "react";
import { getPhoto } from "@/lib/carreports/photoCache";

export function usePhotoObjectUrl(photoId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    if (!photoId) {
      setUrl(null);
      return;
    }
    void (async () => {
      const blob = await getPhoto(photoId);
      if (cancelled) return;
      if (!blob) {
        setUrl(null);
        return;
      }
      createdUrl = URL.createObjectURL(blob);
      setUrl(createdUrl);
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [photoId]);

  return url;
}

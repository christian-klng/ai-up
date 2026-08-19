"use client";

export type UploadedMedia = {
  id: string;
  kind: "image" | "video" | "audio" | "file";
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  originalName: string;
  url: string;
  thumbUrl: string | null;
};

export type UploadError = { code: "too_large" | "unsupported_type" | "unauthorized" | "upload_failed" | "network"; maxBytes?: number };

/** Uploads a file via PUT /api/upload with progress callback (XHR because fetch has no upload progress). */
export function uploadFile(file: File, purpose: "content" | "message", onProgress?: (fraction: number) => void): Promise<UploadedMedia> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `/api/upload?purpose=${encodeURIComponent(purpose)}&name=${encodeURIComponent(file.name)}`;
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject({ code: "network" } satisfies UploadError);
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as UploadedMedia);
      else {
        const err = (data ?? {}) as { error?: UploadError["code"]; maxBytes?: number };
        reject({ code: err.error ?? "upload_failed", maxBytes: err.maxBytes } satisfies UploadError);
      }
    };
    xhr.send(file);
  });
}

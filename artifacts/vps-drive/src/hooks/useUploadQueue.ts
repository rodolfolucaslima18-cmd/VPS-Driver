import { useReducer, useCallback, useRef, useEffect } from "react";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");
const CONCURRENCY = 3;

export type UploadStatus = "pending" | "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  file: File;
  relativePath: string;
  targetPath: string;
  status: UploadStatus;
  progress: number;
  error?: string;
}

type Action =
  | { type: "ENQUEUE"; items: UploadItem[] }
  | { type: "START"; id: string }
  | { type: "PROGRESS"; id: string; progress: number }
  | { type: "DONE"; id: string }
  | { type: "ERROR"; id: string; error: string }
  | { type: "RETRY"; id: string }
  | { type: "CLEAR_DONE" }
  | { type: "CLEAR_ALL" };

function reducer(state: UploadItem[], action: Action): UploadItem[] {
  switch (action.type) {
    case "ENQUEUE":
      return [...state, ...action.items];
    case "START":
      return state.map((i) =>
        i.id === action.id ? { ...i, status: "uploading" as const, progress: 0 } : i
      );
    case "PROGRESS":
      return state.map((i) =>
        i.id === action.id ? { ...i, progress: action.progress } : i
      );
    case "DONE":
      return state.map((i) =>
        i.id === action.id ? { ...i, status: "done" as const, progress: 100 } : i
      );
    case "ERROR":
      return state.map((i) =>
        i.id === action.id ? { ...i, status: "error" as const, error: action.error } : i
      );
    case "RETRY":
      return state.map((i) =>
        i.id === action.id
          ? { ...i, status: "pending" as const, progress: 0, error: undefined }
          : i
      );
    case "CLEAR_DONE":
      return state.filter((i) => i.status !== "done");
    case "CLEAR_ALL":
      return [];
    default:
      return state;
  }
}

interface UseUploadQueueOptions {
  onBatchComplete?: () => void;
}

export function useUploadQueue({ onBatchComplete }: UseUploadQueueOptions = {}) {
  const [items, dispatch] = useReducer(reducer, []);

  // pendingQueue is the source of truth for what still needs to start.
  // Mutated directly so startFromQueue always sees the latest state
  // without depending on React render cycles.
  const pendingQueueRef = useRef<UploadItem[]>([]);
  const runningRef = useRef(0);
  const onBatchCompleteRef = useRef(onBatchComplete);
  useEffect(() => { onBatchCompleteRef.current = onBatchComplete; }, [onBatchComplete]);

  // Preserves original file/path data for retries even after status changes in reducer
  const itemDataMapRef = useRef<Map<string, { file: File; relativePath: string; targetPath: string }>>(new Map());

  const startFromQueue = useCallback(() => {
    while (runningRef.current < CONCURRENCY && pendingQueueRef.current.length > 0) {
      const item = pendingQueueRef.current.shift()!;
      runningRef.current++;
      dispatch({ type: "START", id: item.id });

      const formData = new FormData();
      if (item.targetPath) formData.append("path", item.targetPath);
      formData.append("files", item.file);
      formData.append("relativePaths", JSON.stringify([item.relativePath]));

      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          dispatch({
            type: "PROGRESS",
            id: item.id,
            progress: Math.round((e.loaded / e.total) * 100),
          });
        }
      };

      const finish = (success: boolean, errorMsg?: string) => {
        runningRef.current--;
        if (success) {
          dispatch({ type: "DONE", id: item.id });
        } else {
          dispatch({ type: "ERROR", id: item.id, error: errorMsg ?? "Erro desconhecido" });
        }
        startFromQueue();
        // When queue drains completely, refresh the file listing once
        if (pendingQueueRef.current.length === 0 && runningRef.current === 0) {
          onBatchCompleteRef.current?.();
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          finish(true);
        } else {
          let msg = `HTTP ${xhr.status}`;
          try {
            const data = JSON.parse(xhr.responseText) as { error?: string };
            if (data.error) msg = data.error;
          } catch {}
          finish(false, msg);
        }
      };
      xhr.onerror = () => finish(false, "Falha na conexão");
      xhr.ontimeout = () => finish(false, "Tempo esgotado");

      xhr.withCredentials = true;
      xhr.open("POST", `${BASE_URL}/api/files/upload`);
      xhr.send(formData);
    }
  }, []);

  const enqueue = useCallback(
    (entries: Array<{ file: File; relativePath: string }>, targetPath: string) => {
      if (entries.length === 0) return;
      const newItems: UploadItem[] = entries.map(({ file, relativePath }) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        itemDataMapRef.current.set(id, { file, relativePath, targetPath });
        return { id, file, relativePath, targetPath, status: "pending" as const, progress: 0 };
      });
      dispatch({ type: "ENQUEUE", items: newItems });
      pendingQueueRef.current.push(...newItems);
      startFromQueue();
    },
    [startFromQueue]
  );

  const retryItem = useCallback(
    (id: string) => {
      const data = itemDataMapRef.current.get(id);
      if (!data) return;
      dispatch({ type: "RETRY", id });
      pendingQueueRef.current.push({
        id,
        file: data.file,
        relativePath: data.relativePath,
        targetPath: data.targetPath,
        status: "pending",
        progress: 0,
      });
      startFromQueue();
    },
    [startFromQueue]
  );

  const clearDone = useCallback(() => {
    dispatch({ type: "CLEAR_DONE" });
    // itemDataMapRef pruning happens in the useEffect below
  }, []);

  const clearAll = useCallback(() => {
    dispatch({ type: "CLEAR_ALL" });
    itemDataMapRef.current.clear();
  }, []);

  // Prune itemDataMapRef whenever items are removed (done items after clearDone)
  useEffect(() => {
    const currentIds = new Set(items.map((i) => i.id));
    itemDataMapRef.current.forEach((_, id) => {
      if (!currentIds.has(id)) itemDataMapRef.current.delete(id);
    });
  }, [items]);

  return { items, enqueue, retryItem, clearDone, clearAll };
}

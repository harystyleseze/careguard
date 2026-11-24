import { fileURLToPath } from "url";
import path from "path";

/**
 * Returns the resolved path to the shared data directory, respecting process.env.DATA_DIR.
 * Safe for Windows drive-letter paths (unlike new URL().pathname which retains a leading slash).
 */
export function getDataDir(): string {
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }
  return fileURLToPath(new URL("../data", import.meta.url));
}

/**
 * Converts a file URL or URL string to a file path safely on both POSIX and Windows,
 * ensuring no leading slash before drive letters on Windows paths.
 */
export function urlToFilePath(url: URL | string): string {
  if (typeof url === "string" && !url.startsWith("file:")) {
    return path.resolve(url);
  }
  return fileURLToPath(url);
}

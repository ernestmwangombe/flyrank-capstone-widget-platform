// ==============================================================================
// File: src/widget/bundleLoader.js
// Description: Reads a widget loader source file from disk and prepares it for public delivery.
// ==============================================================================

// Import Node's file reader
import fs from 'node:fs';

// The folder this module lives in, so file names are resolved next to it (not relative to wherever the server was started)
const BUNDLE_DIRECTORY = new URL('./', import.meta.url);

/**
 * Reads the source file with the given name (for example "widget.v2.js") and returns the text ready to serve.
 * Preparation = remove comment-only lines, blank lines and indentation, so the public file is small.
 * This is safe because the source file puts every comment on its own line starting with // (rule stated at the top of that file).
 */
export function loadBundleSource(fileName) {
  // Read the whole file as text
  const raw = fs.readFileSync(new URL(fileName, BUNDLE_DIRECTORY), 'utf8');
  // Split into lines; the pattern also handles Windows line endings (carriage return + line feed)
  const lines = raw.split(/\r?\n/);
  // Trim every line, then keep only lines that are not empty and do not start with //
  const kept = lines.map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('//'));
  // Join the remaining lines and end with one newline
  return kept.join('\n') + '\n';
}

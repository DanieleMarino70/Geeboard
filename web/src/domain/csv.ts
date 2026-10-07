/* One cell of a CSV file the panel writes, for a person to open in a spreadsheet.

   The audit log carries text people typed (a server's name, a reason, a console command's first word), and a spreadsheet
   treats a cell that starts with =, +, - or @ as a formula, and so does one that starts with a tab or a carriage return
   (OWASP's list). The cell is made text by a leading apostrophe, which a spreadsheet shows as nothing. A tab or carriage
   return ahead of the formula was not on the panel's list: it is now. And a carriage return anywhere is a line break to a
   reader of the file, so a cell with one is quoted like one with a newline; it was not, and a value could end a row. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

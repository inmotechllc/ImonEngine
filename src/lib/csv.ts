import { parse } from "csv-parse/sync";
import type { ProspectImportRecord } from "../domain/contracts.js";

export function parseProspectCsv(input: string): ProspectImportRecord[] {
  return parse(input, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as ProspectImportRecord[];
}

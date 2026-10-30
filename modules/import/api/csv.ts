/** RFC 4180: quotes, `""` inside, line breaks inside quotes; BOM is stripped; delimiter — comma, semicolon or TAB from the header. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let any = false; // something was in the current record (distinguishes an empty line from the end of the file)
  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
      continue;
    }
    any = true;
    if (c === '"' && cell === '') quoted = true;
    else if (c === delim) endCell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endCell();
      rows.push(row);
      row = [];
      any = false;
    } else cell += c;
  }
  if (any || cell !== '' || row.length) {
    endCell();
    rows.push(row);
  }
  // completely empty lines (including the file tail) are not data
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === '\n' || c === '\r')) break;
    else if (!quoted && c in counts) counts[c]!++;
  }
  // on a tie (including all zeros) — comma
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0] as [string, number])[0];
}

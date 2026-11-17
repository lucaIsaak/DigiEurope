export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Draw a thin rule under the line (used for signature lines). */
  rule?: boolean;
  /** Extra space before the line. */
  gap?: number;
}

/** Escapes a string for a PDF literal using WinAnsi octal codes, so umlauts and the euro sign survive. */
export function pdfEscape(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "(" || ch === ")") out += `\\${ch}`;
    else if (c >= 32 && c <= 126) out += ch;
    else if (c === 0x20ac) out += "\\200";
    else if (c >= 160 && c <= 255) out += `\\${c.toString(8)}`;
    else out += "?";
  }
  return out;
}

/** Builds a one-page PDF. Each line is one text-showing operation, so a reader can recover lines in order. */
export function buildPdf(lines: PdfLine[]): Buffer {
  let y = 790;
  const ops: string[] = [];
  for (const l of lines) {
    const size = l.size ?? 11;
    y -= (l.gap ?? 0) + size * 1.9;
    ops.push(`BT /${l.bold ? "F2" : "F1"} ${size} Tf 56 ${y.toFixed(1)} Td (${pdfEscape(l.text)}) Tj ET`);
    if (l.rule) ops.push(`0.6 w 56 ${(y - 4).toFixed(1)} m 539 ${(y - 4).toFixed(1)} l S`);
  }
  const text = ops.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Reads the text lines back out of a PDF made by buildPdf (uncompressed content streams only). */
export function readPdfLines(buf: Buffer): string[] {
  const src = buf.toString("latin1");
  const lines: string[] = [];
  const re = /\((?:\\[\s\S]|[^\\)])*\)\s*Tj/g;
  for (const m of src.matchAll(re)) {
    const body = m[0].slice(1, m[0].lastIndexOf(")"));
    lines.push(
      body.replace(/\\([0-7]{1,3}|[\s\S])/g, (_, e: string) => {
        if (/^[0-7]+$/.test(e)) {
          const code = parseInt(e, 8);
          return code === 0x80 ? "€" : String.fromCharCode(code);
        }
        return e;
      }),
    );
  }
  return lines;
}

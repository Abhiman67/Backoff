import JSZip from "jszip";
import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import type { PDFDocumentProxy } from "pdfjs-dist";
import path from "node:path";

let ocrWorker: ReturnType<typeof createWorker> | undefined;

async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = createWorker("eng", 1, {
      langPath: path.join(process.cwd(), "node_modules/@tesseract.js-data/eng/4.0.0"),
      gzip: true,
    }).catch((error: unknown) => {
      ocrWorker = undefined;
      throw error;
    });
  }
  return ocrWorker;
}

async function extractPdfOcr(document: PDFDocumentProxy): Promise<string> {
  const worker = await getOcrWorker();
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, 30); pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    // PDF.js accepts the Node canvas context at runtime; its type only declares DOM canvas contexts.
    await page.render({ canvas: null, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
    const { data } = await worker.recognize(await canvas.encode("png"));
    if (data.text.trim()) pages.push(data.text.trim());
  }
  return pages.join("\n\n").slice(0, 20_000);
}

/**
 * Extracts raw textual content from an uploaded DOCX file (ZIP containing word/document.xml).
 */
export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docXml = await zip.file("word/document.xml")?.async("string");
    if (!docXml) return "";
    return docXml
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.warn("DOCX parse error:", err);
    return "";
  }
}

/** Extracts page text from a PDF without treating compressed PDF bytes as text. */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = pdfjs.getDocument({ data: new Uint8Array(buffer) });
    try {
      const document = await loading.promise;
      const pages = await Promise.all(
        Array.from({ length: document.numPages }, async (_, index) => {
          const page = await document.getPage(index + 1);
          const content = await page.getTextContent();
          return content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        })
      );
      const extracted = pages.filter(Boolean).join("\n\n").slice(0, 20_000);
      return extracted || await extractPdfOcr(document);
    } finally {
      await loading.destroy();
    }
  } catch (err) {
    if (process.env.NODE_ENV !== "production") console.warn("PDF parse error:", err);
    return "";
  }
}

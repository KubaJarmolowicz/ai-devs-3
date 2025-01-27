import { createWorker, PSM } from "tesseract.js";
// import pdf from "pdf-parse";
import * as fs from "fs/promises";
import * as path from "path";
import sharp from "sharp"; // For image processing
import { OpenAIService } from "./OpenAIService";

interface ContentChunk {
  content: string;
  metadata: Record<string, string | number | boolean> & {
    pageNumber: number;
    source: "pdf" | "image" | "binary";
  };
}

interface ValidationResult {
  isValid: boolean;
  issues?: string[];
}

class PDFProcessingError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PDFProcessingError";
  }
}

class OCRProcessingError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "OCRProcessingError";
  }
}

export class PDFService {
  private pdfjs: any; // We'll initialize this in the constructor
  private openai: OpenAIService;

  constructor(openai: OpenAIService) {
    this.initPdfjs();
    this.openai = openai;
  }

  private async initPdfjs() {
    const pdfjs = await import("pdfjs-dist");
    this.pdfjs = pdfjs;
  }

  private async validateContent(
    chunk: ContentChunk
  ): Promise<ValidationResult> {
    const issues: string[] = [];

    if (!chunk.content.trim()) {
      issues.push("Content is empty");
    }

    if (chunk.content.length < 10) {
      issues.push("Content suspiciously short");
    }

    // Check for common OCR artifacts
    if (
      chunk.metadata.source === "image" &&
      /[^a-zA-Z0-9\s.,!?-]/.test(chunk.content)
    ) {
      issues.push("Contains possible OCR artifacts");
    }

    return {
      isValid: issues.length === 0,
      issues: issues.length ? issues : undefined,
    };
  }

  private async extractPageText(
    pdfPath: string,
    pageNum: number
  ): Promise<string> {
    try {
      const data = new Uint8Array(await fs.readFile(pdfPath));
      const pdfDocument = await this.pdfjs.getDocument({ data }).promise;
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Properly concatenate text items with proper spacing
      const text = textContent.items
        .map((item: { str?: string }) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      return text;
    } catch (error) {
      throw new PDFProcessingError(
        `Failed to extract text from page ${pageNum}`,
        error
      );
    }
  }

  private async extractTextFromPDF(pdfPath: string): Promise<ContentChunk[]> {
    try {
      const data = new Uint8Array(await fs.readFile(pdfPath));
      const pdfDocument = await this.pdfjs.getDocument({ data }).promise;
      const numPages = pdfDocument.numPages;

      const chunks: ContentChunk[] = [];

      for (let i = 1; i < numPages; i++) {
        const pageText = await this.extractPageText(pdfPath, i);
        const chunk: ContentChunk = {
          content: pageText,
          metadata: {
            pageNumber: i,
            author: "Rafał",
            source: "pdf",
            characterCount: pageText.length,
            timestamp: Date.now(),
          },
        };

        // Validate content before adding
        const validation = await this.validateContent(chunk);
        if (!validation.isValid) {
          console.warn(`Page ${i} validation issues:`, validation.issues);
        }

        chunks.push(chunk);
      }

      return chunks;
    } catch (error) {
      throw new PDFProcessingError("Failed to extract text from PDF", error);
    }
  }

  private async extractTextFromImage(
    imagePaths: string[],
    pageNumber: number
  ): Promise<ContentChunk> {
    try {
      // Use OpenAI Vision to extract text
      const text = await this.openai.analyzeImages(
        imagePaths,
        "Extract and transcribe all text from this image. The text appears to be handwritten in Polish. Answer with just the text, no other comments."
      );

      // Don't delete the preprocessed image so we can inspect it
      // await fs.unlink(preprocessedPath).catch(console.error);

      return {
        content: text,
        metadata: {
          source: "image",
          author: "Rafał",
          pageNumber: pageNumber,
          characterCount: text.length,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      throw new OCRProcessingError("Failed to extract text from image", error);
    }
  }

  async updateMetadata(
    chunk: ContentChunk,
    updates: Partial<Record<string, string | number>>
  ): Promise<ContentChunk> {
    return {
      ...chunk,
      metadata: {
        ...chunk.metadata,
        ...updates,
        lastModified: Date.now(),
      },
    };
  }

  async batchUpdateMetadata(
    chunks: ContentChunk[],
    updateFn: (
      chunk: ContentChunk
    ) => Promise<Partial<Record<string, string | number>>>
  ): Promise<ContentChunk[]> {
    return Promise.all(
      chunks.map(async (chunk) => {
        const updates = await updateFn(chunk);
        return this.updateMetadata(chunk, updates);
      })
    );
  }

  async processDocument(
    pdfPath: string,
    tempDir: string = "./temp"
  ): Promise<ContentChunk[]> {
    try {
      await fs.mkdir(tempDir, { recursive: true });

      // Get regular PDF chunks first
      const pdfChunks = await this.extractTextFromPDF(pdfPath);

      const imagePaths = (
        await fs.readdir(path.join(__dirname, "../resources/scraps"))
      ).map((file) => path.join(__dirname, "../resources/scraps", file));
      const imageChunk = await this.extractTextFromImage(
        imagePaths,
        pdfChunks.length + 1
      );

      //       const refinedImageText = await this.openai.getAnswer(
      //Masz rozległą wiedzę o geografii Polski. Twoim zadaniem nie odpowiedzieć na pytania na podstawie kontekstu oraz swojej wiedzy. Kontekst powstał na podstawie analizy OCR i może zawierać błędy. Zanim odpowiedz, proszę zweryfikuj, czy odpowiedź ma sens zgodnie ze stanem twojej wiedzy. Jeżeli jakaś nazwa została źle odczytana, popraw ją.
      //         </rules>
      //         <examples>
      //  User: "Niedawno odwiedziłem Stragard koło Szczecina"
      //  Assistant: <thinking>Czy znam miejscowość Stragard w poblizu miasta Szczecin? Nie! Ale znam miejscowość Stargard w poblizu miasta Szczecin! </thinking>
      //  reply: "Niedawno odwiedziłem Stargard koło Szczecina"
      //  User: "We Wrankach pod Warszawą znajduje się więzienie."
      //  Assistant: <thinking>Czy znam miejscowość Wranki w pobliżu Warszawy? Nie! Ale znam miejscowość Wronki w pobliżu Warszawy! </thinking>
      //  reply: "We Wronkach pod Warszawą znajduje się więzienie."
      //         </examples>
      //         `
      //       );

      //       imageChunk.content = refinedImageText;

      return [...pdfChunks, imageChunk];
    } catch (error) {
      if (
        error instanceof PDFProcessingError ||
        error instanceof OCRProcessingError
      ) {
        throw error;
      }
      throw new Error(`Unexpected error during document processing: ${error}`);
    }
  }
}

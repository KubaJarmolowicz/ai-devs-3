import { PDFService } from "../services/PDFService";
import { OpenAIService } from "../services/OpenAIService";
import path from "path";

export async function runNotes() {
  const pdfService = new PDFService(new OpenAIService());
  const chunks = await pdfService.processDocument(
    path.join(__dirname, "../resources/notatnik-rafala.pdf")
  );
  console.log("Chunks: ", chunks);
}

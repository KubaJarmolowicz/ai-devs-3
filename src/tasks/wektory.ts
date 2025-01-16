import * as fs from "fs/promises";
import path from "path";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

import { OpenAIService } from "../services/OpenAIService";
import { QdrantService } from "../services/QdrantService";

const COLLECTION_NAME = "reports";
const VECTOR_SIZE = 1536; // size for text-embedding-3-small

async function readReports(): Promise<Array<{ text: string; date: string }>> {
  const reportsDir = path.join(__dirname, "../resources/do-not-share");
  const files = await fs.readdir(reportsDir);

  const reports = await Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(path.join(reportsDir, file), "utf-8");
      // Extract date from filename (YYYY_MM_DD.txt)
      const date = file.split(".")[0].replace(/_/g, "-");
      return { text: content, date };
    })
  );

  return reports;
}

export async function runWektory() {
  const openai = new OpenAIService();
  const qdrant = new QdrantService();

  try {
    // 1. Create collection and store documents
    await qdrant.createCollectionIfNotExists(COLLECTION_NAME, VECTOR_SIZE);

    const reports = await readReports();
    const embeddings = await openai.createEmbeddings(
      reports.map((r) => r.text)
    );

    // Store documents with their embeddings and metadata
    await qdrant.upsertVectors(
      COLLECTION_NAME,
      embeddings.map((embedding, index) => ({
        id: index + 1,
        vector: embedding,
        payload: {
          text: reports[index].text,
          report_date: reports[index].date,
        },
      }))
    );

    // 2. Embed the question
    const question =
      "W raporcie, z którego dnia znajduje się wzmianka o kradzieży prototypu broni?";
    const questionEmbedding = await openai.createEmbedding(question);

    // 3. Search for most similar document
    const searchResult = await qdrant.search(
      COLLECTION_NAME,
      questionEmbedding,
      1
    );

    if (!searchResult.length) {
      throw new Error("No matching documents found");
    }

    // 4. Return the date from the most relevant document
    const answer = searchResult[0].payload?.report_date || "";

    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "wektory",
        apikey: process.env.API_KEY,
        answer,
      }
    );

    console.log("Verification:", verifyResponse.data);
  } catch (error) {
    console.error("Error in searchReportDate:", error);
    throw error;
  }
}

import path from "path";
import fsPromises from "fs/promises";
import axios from "axios";
import { OpenAIService } from "../services/OpenAIService";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.API_KEY;

interface KategorieResult {
  people: string[];
  hardware: string[];
}

export const runKategorie = async (): Promise<void> => {
  try {
    console.log("Starting kategorie task...");
    const openAIService = new OpenAIService();
    const result: KategorieResult = { people: [], hardware: [] };

    // 1. Read all files from the directory
    const resourceDir = path.join(__dirname, "../resources/files");
    const files = await fsPromises.readdir(resourceDir);
    console.log(`Found ${files.length} files to analyze`);

    // 2. Process each file based on its type
    for (const file of files) {
      console.log(`Processing file: ${file}`);
      const filePath = path.join(resourceDir, file);
      const fileExt = path.extname(file).toLowerCase();

      let analysis: { people: boolean; hardware: boolean };

      try {
        switch (fileExt) {
          case ".txt":
            const content = await fsPromises.readFile(filePath, "utf-8");
            analysis = await openAIService.analyzeForCategories({
              fileType: "text",
              content,
            });
            break;

          case ".png":
            analysis = await openAIService.analyzeForCategories({
              fileType: "image",
              filePath,
            });
            break;

          case ".mp3":
            analysis = await openAIService.analyzeForCategories({
              fileType: "audio",
              filePath,
            });
            break;

          default:
            console.log(`Skipping unsupported file type: ${file}`);
            continue;
        }

        console.log(`Analysis for ${file}:`, analysis);

        if (analysis.people) result.people.push(file);
        if (analysis.hardware) result.hardware.push(file);
      } catch (error) {
        console.error(`Error analyzing ${file}:`, error);
        continue;
      }
    }

    console.log("Final categorization:", result);

    // 3. Send results to the API
    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "kategorie",
        apikey: API_KEY,
        answer: result,
      }
    );

    console.log("Verification response:", verifyResponse.data);
  } catch (error) {
    console.error("Error in kategorie task:", error);
    throw error;
  }
};

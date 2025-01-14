import path from "path";
import fs from "fs/promises";
import { OpenAIService } from "../services/OpenAIService";

export const runMap = async () => {
  try {
    const mapsDir = path.join(__dirname, "..", "resources", "maps");
    const files = await fs.readdir(mapsDir);
    const pngFiles = files.filter((f) => f.toLowerCase().endsWith(".png"));
    const fullPaths = pngFiles.map((f) => path.join(mapsDir, f));

    const openAIService = new OpenAIService();
    const analysis = await openAIService.analyzeImages(fullPaths);

    console.log("Map Analysis Result:", analysis);
    return analysis;
  } catch (error) {
    console.error("Error in map task:", error);
    throw error;
  }
};

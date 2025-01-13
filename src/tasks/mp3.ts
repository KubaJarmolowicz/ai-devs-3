import fsPromises from "fs/promises";
import dotenv from "dotenv";
import fs from "fs";
import axios from "axios";
import path from "path";
import { OpenAIService } from "../services/OpenAIService";

export interface Mp3TaskResult {
  transcriptions: string[];
  answer: string;
}

dotenv.config();

const API_KEY = process.env.API_KEY;

export const runMp3 = async () => {
  try {
    const openAIService = new OpenAIService();

    // 1. Read all m4a files from resources/mp3
    const mp3Dir = path.join(__dirname, "../resources/mp3");

    const files = await fsPromises.readdir(mp3Dir);
    const m4aFiles = files.filter((f) => f.endsWith(".m4a"));

    // 2. Transcribe each file
    const transcriptions = await Promise.all(
      m4aFiles.map(async (file) => {
        const filePath = path.join(mp3Dir, file);
        const fileBuffer = fs.createReadStream(filePath);
        return openAIService.transcribeAudio(fileBuffer);
      })
    );

    console.log("Transcriptions: ", transcriptions);

    // 3. Join transcriptions and analyze
    const context = transcriptions.join("\n\n");
    const answer = await openAIService.analyzeTranscriptions(context);

    console.log("Answer: ", answer);

    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "MP3",
        apikey: API_KEY,
        answer,
      }
    );

    console.log("Verification:", verifyResponse.data);
  } catch (error) {
    console.error("Error in mp3Task:", error);
    throw error;
  }
};

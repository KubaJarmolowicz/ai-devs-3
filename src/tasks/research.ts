import dotenv from "dotenv";
import axios from "axios";
import { OpenAIService } from "../services/OpenAIService";
import fs from "fs/promises";
import path from "path";

dotenv.config();

// Example usage
const service = new OpenAIService();

export async function runResearch() {
  try {
    if (!process.env.RESEARCH_MODEL_ID) {
      throw new Error("RESEARCH_MODEL_ID is not set");
    }

    // Read verify.txt
    const verifyData = await fs.readFile(
      path.join(__dirname, "../resources/research/verify.txt"),
      "utf-8"
    );

    const lines = verifyData.split("\n").filter((line) => line.trim());

    const answer = [];

    for (const line of lines) {
      const [id, numbers] = line.split("=");
      const isValid = await service.verifyPattern(
        numbers,
        process.env.RESEARCH_MODEL_ID
      );
      console.log(`Line ${id}: ${isValid ? "valid" : "invalid"} pattern`);
      if (isValid) {
        answer.push(id);
      }
    }

    const verifyResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      {
        task: "research",
        apikey: process.env.API_KEY,
        answer,
      }
    );
    console.log("Verification:", verifyResponse.data);
  } catch (error) {
    console.error("Error verifying patterns:", error);
  }
}

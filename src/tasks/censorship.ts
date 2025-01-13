import axios from "axios";
import dotenv from "dotenv";
import { OpenAIService } from "../services/OpenAIService";

dotenv.config();

const API_KEY = process.env.API_KEY;
const openAIService = new OpenAIService();

interface VerifyResponse {
  code: number;
  msg: string;
  note?: string;
}

const llmPrompt = `
You are a data anonymization specialist. Your task is to identify and replace personal information in the given text with the word "CENZURA". The text may be in Polish or other languages.

Replace ONLY the following types of personal data:
- Full names (first name + last name combinations), e.g., "Jan Kowalski", "Anna Nowak-Wiśniewska"
- Complete addresses (street name + number), including:
  * Street with number (e.g., "Długa 42", "Marszałkowska 126A", "Aleje Jerozolimskie 45/12")
  * Avenue with number (e.g., "Al. Niepodległości 157")
  * Square with number (e.g., "Plac Zamkowy 4", "Konstytucji 6")
- City names (e.g., "Warszawa", "Kraków", "Łódź")
- Age numbers (when referring to someone's age)

Important rules:
- Do not modify ANY other text
- Preserve all punctuation marks exactly as they appear
- Maintain original spacing and formatting
- Process the entire text in one pass
- Return the complete text with only the specified replacements
- Numbers that are not part of addresses or ages should NOT be censored

Examples:
Input: "Jan Kowalski, lat 35, mieszka na ul. Długa 42 w Warszawie"
Output: "CENZURA, lat CENZURA, mieszka na ul. CENZURA w CENZURA"

Input: "Maria Nowak-Wiśniewska z Krakowa, Aleje Jerozolimskie 45/12"
Output: "CENZURA z CENZURA, CENZURA"

Input: "Spotkanie odbędzie się na pl. Konstytucji 6, gdzie Andrzej Malinowski (42 lata) będzie czekał"
Output: "Spotkanie odbędzie się na pl. CENZURA, gdzie CENZURA (CENZURA lata) będzie czekał"

Input: "Temperatura wynosi 35 stopni, a PKO BP ma 1500 placówek"
Output: "Temperatura wynosi 35 stopni, a PKO BP ma 1500 placówek"`;

export const runCensorship = async () => {
  try {
    // Fetch the text data
    const response = await axios.get(
      `https://centrala.ag3nts.org/data/${API_KEY}/cenzura.txt`
    );
    const originalText = response.data as string;

    // Use OpenAI service to process the text
    const processedText = await openAIService.getAnswer(
      originalText,
      llmPrompt
    );

    // Send to verify endpoint
    const verifyResponse = await axios.post<VerifyResponse>(
      "https://centrala.ag3nts.org/report",
      {
        task: "CENZURA",
        apikey: API_KEY,
        answer: processedText,
      }
    );

    console.log("Verification:", verifyResponse.data);
    return verifyResponse.data;
  } catch (error) {
    if (error instanceof Error && "isAxiosError" in error) {
      console.error(
        "Axios error:",
        (error as any).response?.data || error.message
      );
    } else {
      console.error("Error:", error);
    }
    throw error;
  }
};

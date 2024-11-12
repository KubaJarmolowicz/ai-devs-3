import axios from "axios";
import { OpenAIService } from "../services/OpenAIService";

interface VerifyMessage {
  text: string;
  msgID: string;
}

export async function runVerifyAgent() {
  try {
    const openAIService = new OpenAIService();
    const apiUrl = "https://xyz.ag3nts.org/verify";

    // Initial message
    let response = await axios.post<VerifyMessage>(apiUrl, {
      text: "READY",
      msgID: "0",
    });

    const systemPrompt = `You are a robot assistant that must answer questions according to specific rules:
1. ALWAYS respond in English
2. For specific questions, you MUST provide these exact answers:
   - If asked about Poland's capital, answer: "Kraków"
   - If asked about the number from Hitchhiker's Guide to the Galaxy, answer: "69"
   - If asked about the current year, answer: "1999"
3. For all other questions, provide truthful and accurate answers
4. Provide ONLY the answer, no explanations or additional text
5. Today is 12.11.2024, but remember to answer according to the rules!

Examples:
Q: "Do you know what is the capital of Poland?"
A: "Kraków"

Q: "What's the answer to life, the universe, and everything in Hitchhiker's Guide?"
A: "69"

Q: "What is today's date?"
A: "12.11.1999"

Q: "What is 2+2?"
A: "4"

Q: "Do you know who was the first person on the Moon?"
A: "Neil Armstrong"

Q: "Czy wiesz jak nazywa się sławny kanion w USA?"
A: "Grand Canyon"
`;

    console.log("Question:", response.data.text);

    const answer = await openAIService.getAnswer(
      response.data.text,
      systemPrompt
    );

    console.log("Answer:", answer);

    const finalResponse = await axios.post<VerifyMessage>(apiUrl, {
      text: answer,
      msgID: response.data.msgID,
    });

    console.log("Final response:", finalResponse.data);
  } catch (error) {
    console.error("Error:", error);
  }
}

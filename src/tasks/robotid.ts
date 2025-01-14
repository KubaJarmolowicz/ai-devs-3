import axios from "axios";
import { OpenAIService } from "../services/OpenAIService";

interface RobotIdResponse {
  description: string;
}

export async function runRobotIdTask() {
  try {
    // Get the JSON data
    const apiKey = process.env.API_KEY;
    const response = await axios.get<RobotIdResponse>(
      `https://centrala.ag3nts.org/data/${apiKey}/robotid.json`
    );
    const { description } = response.data;

    console.log("Description:", description);

    // Generate image using DALL-E
    const openAI = new OpenAIService();
    const cleanDescription = await openAI.cleanRobotDescription(description);

    console.log("Clean Description:", cleanDescription);

    const imageUrl = await openAI.generateImage(cleanDescription);

    console.log("Image URL:", imageUrl);

    // Prepare and send the payload
    const payload = {
      task: "robotid",
      apikey: apiKey,
      answer: imageUrl,
    };

    const verificationResponse = await axios.post(
      "https://centrala.ag3nts.org/report",
      payload
    );
    console.log("Verification response:", verificationResponse.data);
  } catch (error) {
    console.error("Error in robotid task:", error);
  }
}

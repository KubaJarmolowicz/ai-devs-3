import dotenv from "dotenv";
import { runPoligon } from "./tasks/poligon";
import { runXYZChallenge } from "./tasks/xyz-challenge";
import { runVerifyAgent } from "./tasks/verify-agent";
import { runJsonChallenge } from "./tasks/json-challenge";
import { runCensorship } from "./tasks/censorship";
dotenv.config();

async function main() {
  try {
    console.log("AI Challenges App Started!");
    // await runPoligon();
    // await runXYZChallenge();
    // await runVerifyAgent();
    // await runJsonChallenge();
    await runCensorship();
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
